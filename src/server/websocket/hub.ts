import type { WebSocket } from "ws";
import {
  IDLE_STATE,
  MAX_FOLLOWERS,
  parseClientMessage,
  withHint,
  type ClientMessage,
  type Command,
  type PartyTv,
  type PartyView,
  type PlayHint,
  type ResolveStatus,
  type ServerMessage,
} from "../../shared";
import type { ResolveFn, ResolveResult } from "../resolvers";
import type { Controller, Device, Registry } from "../sessions/registry";

/** Close code sent to an older TV page when a newer page takes over the same device. */
export const CLOSE_REPLACED = 4000;

type Conn =
  | { role: "none"; socket: WebSocket }
  | { role: "tv"; socket: WebSocket; deviceId: string }
  | { role: "controller"; socket: WebSocket; controllerId: string };

export interface HubOptions {
  /** A socket that has sent nothing for this long is dropped (clients PING every 15 s). Default 60 s. */
  staleAfterMs?: number;
  /** How often to look for silent sockets. Default 20 s. */
  sweepEveryMs?: number;
  /** Wrong or expired codes tolerated across all phones in one window before pairing pauses. Default 20. */
  maxFailedPairings?: number;
  /** Length of that window. Default 60 s. */
  failedPairingWindowMs?: number;
}

/** Relays between phones and TVs. Holds no state of its own beyond who is connected right now. */
export class Hub {
  private readonly tvs = new Map<string, WebSocket>(); // deviceId -> socket
  private readonly controllers = new Map<string, WebSocket>(); // controllerId -> socket
  /** Latest PLAY_URL per device, so a slow resolve can't overwrite a newer choice (or a STOP). */
  private readonly resolveSeq = new Map<string, number>();
  /** When each open socket last said anything. A TV that lost power never sends a close frame. */
  private readonly lastSeen = new Map<WebSocket, number>();
  private readonly sweeper: ReturnType<typeof setInterval>;
  /** When recent wrong codes were tried. A code is only six digits, so guessing has to be slow once this is on the internet. */
  private failedPairings: number[] = [];
  private readonly maxFailedPairings: number;
  private readonly failedPairingWindowMs: number;

  constructor(
    private readonly registry: Registry,
    private readonly resolve: ResolveFn,
    options: HubOptions = {},
  ) {
    const staleAfterMs = options.staleAfterMs ?? 60_000;
    this.maxFailedPairings = options.maxFailedPairings ?? 20;
    this.failedPairingWindowMs = options.failedPairingWindowMs ?? 60_000;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [socket, seen] of this.lastSeen) if (now - seen > staleAfterMs) socket.terminate();
    }, options.sweepEveryMs ?? 20_000);
    this.sweeper.unref();
  }

  dispose(): void {
    clearInterval(this.sweeper);
  }

  handleConnection(socket: WebSocket): void {
    let conn: Conn = { role: "none", socket };
    this.lastSeen.set(socket, Date.now());

    socket.on("message", (data, isBinary) => {
      this.lastSeen.set(socket, Date.now());
      const message = isBinary ? null : parseClientMessage(data.toString());
      if (!message) return this.send(socket, { type: "ERROR", code: "BAD_MESSAGE", message: "Invalid message." });
      conn = this.dispatch(conn, message);
    });

    socket.on("close", () => {
      this.lastSeen.delete(socket);
      if (conn.role === "tv" && this.tvs.get(conn.deviceId) === socket) {
        this.tvs.delete(conn.deviceId);
        const device = this.registry.getDevice(conn.deviceId);
        if (device) this.toControllers(device, { type: "TV_STATUS", online: false });
        // The rest of its party sees it go offline.
        const host = device && (this.registry.leaderOf(device) ?? device);
        if (host && this.registry.inParty(host)) this.sendParty(host);
      }
      if (conn.role === "controller" && this.controllers.get(conn.controllerId) === socket) {
        this.controllers.delete(conn.controllerId);
      }
    });
    socket.on("error", () => {});
  }

  private dispatch(conn: Conn, message: ClientMessage): Conn {
    switch (message.type) {
      case "TV_HELLO":
        return this.tvHello(conn.socket, message.deviceId);
      case "CTL_HELLO":
        return this.controllerHello(conn.socket, message.controllerId);
      case "PING":
        this.send(conn.socket, { type: "PONG" });
        return conn;
    }

    if (conn.role === "tv") this.fromTv(conn.deviceId, message);
    else if (conn.role === "controller") this.fromController(conn.controllerId, message);
    else this.send(conn.socket, { type: "ERROR", code: "NOT_AUTHENTICATED", message: "Say hello first." });
    return conn;
  }

  /* ------------------------------ TV ------------------------------ */

  private tvHello(socket: WebSocket, deviceId?: string): Conn {
    const device = this.registry.tvHello(deviceId);

    // One live page per TV. The old page is told to stand down instead of fighting for the slot.
    const previous = this.tvs.get(device.id);
    this.tvs.set(device.id, socket);
    if (previous && previous !== socket) previous.close(CLOSE_REPLACED, "replaced");

    const leader = this.registry.leaderOf(device);
    this.send(socket, {
      type: "TV_WELCOME",
      deviceId: device.id,
      paired: device.controllerId !== null || leader !== undefined,
      pairing: this.registry.ensureCode(device),
      ...(leader ? { following: this.registry.displayName(leader) } : {}),
    });
    this.toControllers(device, { type: "TV_STATUS", online: true });
    if (leader) {
      this.catchUp(device, leader); // a page that was reloaded mid-film picks up where the others are
      this.sendParty(leader);
    } else if (this.registry.inParty(device)) {
      this.sendParty(device);
    }
    return { role: "tv", socket, deviceId: device.id };
  }

  private fromTv(deviceId: string, message: ClientMessage): void {
    const device = this.registry.getDevice(deviceId);
    if (!device) return;

    if (message.type === "TV_STATE") {
      const wasOn = device.state.state !== "idle";
      device.state = message.state;
      this.toControllers(device, { type: "STATE", state: message.state });
      this.syncFollowers(device);
      // A host that stops takes the video away from the guests too: they wait for the next one.
      if (wasOn && message.state.state === "idle" && device.followerIds.length > 0) {
        this.toFollowers(device, { type: "TV_CMD", command: { type: "STOP" } });
        this.applyCommand(device, { type: "STOP" });
      }
    } else if (message.type === "TV_NAME") {
      this.registry.setLabel(device, message.name);
      const host = this.registry.leaderOf(device) ?? device;
      if (this.registry.inParty(host)) this.sendParty(host);
    } else if (message.type === "TV_PARTY_OPEN") {
      if (device.leaderId) return; // a guest has no party of its own
      this.registry.ensurePartyCode(device);
      this.sendParty(device);
    } else if (message.type === "TV_PARTY_JOIN") {
      this.joinParty(device, message.code);
    } else if (message.type === "TV_PARTY_REMOVE") {
      const guest = this.registry.removeGuest(device, message.id);
      if (!guest) return;
      this.resetTv(guest);
      this.sendParty(device);
    } else if (message.type === "TV_PARTY_CLOSE") {
      if (device.leaderId) return;
      const guests = this.registry.closeParty(device);
      guests.forEach((guest) => this.resetTv(guest));
      this.sendParty(device);
    } else if (message.type === "TV_NEW_CODE") {
      // A free TV is given a pairing code. One that has a phone gets the code that lets another phone in; asking is what keeps
      // that one good, so a TV asks while it shows it and not otherwise.
      const hasPhone = device.controllerId !== null;
      const pairing = hasPhone ? this.registry.ensureControlCode(device) : this.registry.ensureCode(device);
      if (pairing) this.send(this.tvs.get(deviceId), { type: "TV_CODE", pairing, ...(hasPhone ? { control: true } : {}) });
    } else if (message.type === "TV_NEXT_EPISODE") {
      if (device.leaderId) return; // a TV that watches along follows; it doesn't choose
      if (device.media?.series?.next?.url) {
        // The next episode is the same show: it keeps the picture the first one had.
        void this.playUrlForDevice(device, device.media.series.next.url, undefined, undefined, { poster: device.media.poster, backdrop: device.media.backdrop, year: device.media.year });
      }
    } else if (message.type === "TV_PLAY_URL") {
      if (device.leaderId) return;
      void this.playUrlForDevice(device, message.url, undefined, message.startAt, message.hint);
    } else if (message.type === "TV_CANCEL") {
      if (device.leaderId) return; // a TV that watches along has no say in what plays; it can leave the party
      this.cancelLoad(device);
    } else if (message.type === "TV_UNPAIR") {
      const leader = this.registry.leaderOf(device);
      if (leader) {
        // One of the TVs watching along leaves the party; the others carry on.
        this.registry.detachFollower(device);
        this.resetTv(device);
        this.sendParty(leader);
        return;
      }
      const followers = this.registry.followersOf(device);
      const controllers = this.registry.controllersOf(device);
      this.registry.unpairDevice(device);
      this.resetTv(device);
      followers.forEach((follower) => this.resetTv(follower));
      controllers.forEach((c) => this.sendWelcome(c));
    }
  }

  /* ------------------------------ phone ------------------------------ */

  private controllerHello(socket: WebSocket, controllerId?: string): Conn {
    const controller = this.registry.controllerHello(controllerId);
    this.controllers.set(controller.id, socket);
    this.sendWelcome(controller);
    return { role: "controller", socket, controllerId: controller.id };
  }

  private sendWelcome(controller: Controller): void {
    const device = this.registry.deviceForController(controller);
    const controlCode = device ? this.registry.ensureControlCode(device) : null;
    this.toController(controller.id, {
      type: "CTL_WELCOME",
      controllerId: controller.id,
      tv: device
        ? {
            name: device.name,
            online: this.tvs.has(device.id),
            controlCode: controlCode?.code,
            controllerCount: device.controllerIds.length,
          }
        : null,
      media: device?.media ?? null,
      state: device?.state ?? IDLE_STATE,
      party: device ? this.partyOf(device) : [],
    });
  }

  private fromController(controllerId: string, message: ClientMessage): void {
    const controller = this.registry.controllerHello(controllerId);
    if (message.type === "PAIR") return this.pair(controller, message.code);
    if (message.type === "PLAY_URL") return void this.playUrl(controller, message.url, message.startAt, message.hint);
    if (message.type === "UNPAIR") return this.unpair(controller);
    if (message.type === "ADD_TV") return this.addTv(controller, message.code);
    if (message.type === "REMOVE_TV") return this.removeTv(controller, message.id);
    if (message.type === "OPEN_PARTY") return this.openParty(controller);
    if (message.type !== "CMD") return;

    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controllerId, "NOT_PAIRED", "Connect to a TV first.");
    if (!this.tvs.has(device.id)) return this.error(controllerId, "TV_OFFLINE", "The TV is offline.");

    if (message.command.type === "NEXT_EPISODE") {
      if (device.media?.series?.next?.url) {
        return void this.playUrlForDevice(device, device.media.series.next.url, controllerId);
      }
      return;
    }

    if (message.command.type === "LOAD" || message.command.type === "STOP") this.bumpResolveSeq(device.id);
    this.send(this.tvs.get(device.id), { type: "TV_CMD", command: message.command });
    // The TVs watching along load and stop with this one; play, pause and seeks reach them as the position it reports.
    if (message.command.type === "LOAD" || message.command.type === "STOP") {
      this.toFollowers(device, { type: "TV_CMD", command: message.command });
    }
    // The phone always renders what the TV reports; only LOAD/STOP need an immediate placeholder.
    if (message.command.type === "LOAD" || message.command.type === "STOP") {
      this.applyCommand(device, message.command);
      this.toControllers(device, { type: "STATE", state: device.state });
    }
  }

  private pair(controller: Controller, code: string): void {
    if (controller.deviceId) return this.error(controller.id, "ALREADY_PAIRED", "Already connected to a TV.");
    // While blocked the code is not even checked, so a right guess gets no answer different from a wrong one.
    if (this.pairingPaused()) return this.error(controller.id, "RATE_LIMITED", "Too many wrong codes. Try again in a minute.");

    let device = this.registry.pair(controller, code);
    let isNewPair = true;
    if (!device) {
      device = this.registry.joinController(controller, code);
      isNewPair = false;
    }
    if (!device) {
      this.failedPairings.push(Date.now());
      return this.error(controller.id, "INVALID_CODE", "Invalid or expired code.");
    }
    this.send(this.tvs.get(device.id), { type: "TV_PAIRED" }); // a later phone is news to the TV too
    this.sendWelcome(controller);
    if (!isNewPair) {
      for (const other of this.registry.controllersOf(device)) {
        if (other.id !== controller.id) this.sendWelcome(other);
      }
    }
  }

  /** Wrong codes only count against the limit for so long. True while too many were tried recently. */
  private pairingPaused(): boolean {
    const now = Date.now();
    this.failedPairings = this.failedPairings.filter((at) => now - at < this.failedPairingWindowMs);
    return this.failedPairings.length >= this.maxFailedPairings;
  }

  /** The phone forgets its TV: the TV stops, gets a fresh code, and the phone is sent back to the code screen. */
  private unpair(controller: Controller): void {
    const leader = this.registry.deviceForController(controller);
    const followers = leader ? this.registry.followersOf(leader) : [];
    const device = this.registry.unpair(controller);
    if (device) {
      this.resetTv(device);
      followers.forEach((follower) => this.resetTv(follower)); // the TVs watching along lose their party
    } else if (leader) {
      for (const other of this.registry.controllersOf(leader)) {
        this.sendWelcome(other);
      }
    }
    this.sendWelcome(controller);
  }

  /* ------------------------------ watching together ------------------------------ */

  /** Another TV's code, typed on the phone: that TV now watches along with the phone's TV. */
  private addTv(controller: Controller, code: string): void {
    if (this.pairingPaused()) return this.error(controller.id, "RATE_LIMITED", "Too many wrong codes. Try again in a minute.");
    const joined = this.registry.addFollower(controller, code);
    if (!joined.ok) {
      if (joined.reason === "INVALID_CODE") {
        this.failedPairings.push(Date.now());
        return this.error(controller.id, "INVALID_CODE", "Invalid or expired code.");
      }
      if (joined.reason === "PARTY_FULL") {
        return this.error(controller.id, "PARTY_FULL", `A party has room for ${MAX_FOLLOWERS + 1} TVs.`);
      }
      if (joined.reason === "TV_HOSTING") {
        return this.error(controller.id, "TV_HOSTING", "That TV hosts a party of its own. End it there first.");
      }
      return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    }
    const { leader, follower } = joined;
    this.send(this.tvs.get(follower.id), { type: "TV_FOLLOWING", leader: this.registry.displayName(leader) });
    this.catchUp(follower, leader);
    this.sendParty(leader);
  }

  private removeTv(controller: Controller, publicId: string): void {
    const removed = this.registry.removeFollower(controller, publicId);
    if (!removed) return;
    this.resetTv(removed.follower);
    this.sendParty(removed.leader);
  }

  /** The phone asks for the code others join its TV's party with (starting the party if there is none). */
  private openParty(controller: Controller): void {
    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    this.registry.ensurePartyCode(device);
    this.sendParty(device);
  }

  /** A TV types the code of a party: from then on it watches along with that party's host. */
  private joinParty(guest: Device, code: string): void {
    const tv = this.tvs.get(guest.id);
    const refuse = (errorCode: string, message: string) => this.send(tv, { type: "ERROR", code: errorCode, message });
    if (this.pairingPaused()) return refuse("RATE_LIMITED", "Too many wrong codes. Try again in a minute.");
    const joined = this.registry.joinParty(guest, code);
    if (!joined.ok) {
      switch (joined.reason) {
        case "INVALID_CODE":
          this.failedPairings.push(Date.now());
          return refuse("INVALID_CODE", "Invalid or expired code.");
        case "PARTY_FULL":
          return refuse("PARTY_FULL", `A party has room for ${MAX_FOLLOWERS + 1} TVs.`);
        case "HOSTING":
          return refuse("HOSTING", "End your own party before joining another.");
        case "HAS_PHONE":
          return refuse("HAS_PHONE", "Disconnect the phone from this TV before joining a party.");
        case "ALREADY_IN_PARTY":
          return refuse("ALREADY_IN_PARTY", "Leave this party before joining another.");
      }
    }
    this.bumpResolveSeq(guest.id); // a lookup this TV had going must not start something over the party's video
    this.send(tv, { type: "TV_FOLLOWING", leader: this.registry.displayName(joined.host) });
    this.catchUp(guest, joined.host);
    this.sendParty(joined.host);
  }

  private partyTv(device: Device): PartyTv {
    return { id: device.publicId, name: this.registry.displayName(device), online: this.tvs.has(device.id) };
  }

  private partyOf(host: Device): PartyTv[] {
    return this.registry.followersOf(host).map((guest) => this.partyTv(guest));
  }

  /** The party as one of its TVs sees it, or null when that TV is in none. Only the host is given the code to join with. */
  private viewOf(device: Device): PartyView | null {
    const host = this.registry.leaderOf(device) ?? device;
    if (!this.registry.inParty(host)) return null;
    const code = device === host ? this.registry.partyCodeOf(host) : null;
    return {
      role: device === host ? "host" : "guest",
      you: device.publicId,
      host: this.partyTv(host),
      guests: this.partyOf(host),
      ...(code ? { code } : {}),
    };
  }

  /** Everyone in a party hears when it changes: the phones of its host get the guests (and the code), every TV in it gets the whole picture. */
  private sendParty(host: Device): void {
    const code = this.registry.partyCodeOf(host);
    this.toControllers(host, { type: "PARTY", tvs: this.partyOf(host), ...(code ? { code } : {}) });
    for (const member of [host, ...this.registry.followersOf(host)]) {
      this.send(this.tvs.get(member.id), { type: "TV_PARTY", party: this.viewOf(member) });
    }
  }

  private toFollowers(leader: Device, message: ServerMessage): void {
    for (const follower of this.registry.followersOf(leader)) this.send(this.tvs.get(follower.id), message);
  }

  /** A TV that just joined (or came back) loads what the leader has on, at the place it has reached. */
  private catchUp(follower: Device, leader: Device): void {
    if (!leader.media) return;
    const at = leader.state.currentTime;
    this.send(this.tvs.get(follower.id), {
      type: "TV_CMD",
      command: { type: "LOAD", media: leader.media, ...(at > 5 ? { startAt: Math.floor(at) } : {}) },
    });
  }

  /** What the followers need from every report of the leader: is it playing, and where. They keep their own picture in step. */
  private syncFollowers(leader: Device): void {
    const { state } = leader;
    if (leader.followerIds.length === 0 || (state.state !== "playing" && state.state !== "paused")) return;
    this.toFollowers(leader, {
      type: "TV_SYNC",
      // A leader that is waiting for data holds the others too, so nobody runs ahead of it.
      playing: state.state === "playing" && !state.buffering,
      time: state.currentTime,
      rate: state.playbackRate ?? 1,
      ...(state.stream ? { stream: state.stream } : {}),
    });
  }

  /** After a pairing ended from either side: the TV stops and shows a fresh code. */
  private resetTv(device: Device): void {
    this.bumpResolveSeq(device.id); // a lookup still in flight must not start playing on an unpaired TV
    const tv = this.tvs.get(device.id);
    this.send(tv, { type: "TV_CMD", command: { type: "STOP" } });
    this.send(tv, { type: "TV_UNPAIRED", pairing: this.registry.ensureCode(device) });
    this.send(tv, { type: "TV_PARTY", party: null }); // whatever party it was in is over for it
  }

  /**
   * Whoever is at the TV stopped waiting for a video: a lookup still running is dropped (its answer must not start the film
   * later), what had begun loading is stopped on this TV and the ones watching along, and the phone is told there is nothing to wait for.
   */
  private cancelLoad(device: Device): void {
    this.bumpResolveSeq(device.id);
    const tv = this.tvs.get(device.id);
    this.send(tv, { type: "TV_RESOLVING", active: false });
    this.send(tv, { type: "TV_CMD", command: { type: "STOP" } });
    this.toFollowers(device, { type: "TV_RESOLVING", active: false });
    this.toFollowers(device, { type: "TV_CMD", command: { type: "STOP" } });
    this.applyCommand(device, { type: "STOP" });
    this.toControllers(device, { type: "RESOLVE_STATUS", status: { phase: "cancelled" } });
    this.toControllers(device, { type: "STATE", state: device.state });
  }

  private bumpResolveSeq(deviceId: string): number {
    const next = (this.resolveSeq.get(deviceId) ?? 0) + 1;
    this.resolveSeq.set(deviceId, next);
    return next;
  }

  /** Resolve a pasted URL to media, report progress to the phone, then have the TV load and play it. */
  private async playUrl(controller: Controller, url: string, startAt?: number, hint?: PlayHint): Promise<void> {
    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    return this.playUrlForDevice(device, url, controller.id, startAt, hint);
  }

  private async playUrlForDevice(device: Device, url: string, controllerId?: string, startAt?: number, hint?: PlayHint): Promise<void> {
    const status = (s: ResolveStatus) => {
      this.toControllers(device, { type: "RESOLVE_STATUS", status: s });
    };
    const tvOffline = () => status({ phase: "failed", reason: "tv_offline", message: "The TV is offline." });
    if (!this.tvs.has(device.id)) return tvOffline();

    const seq = this.bumpResolveSeq(device.id);
    status({ phase: "resolving" });
    this.send(this.tvs.get(device.id), { type: "TV_RESOLVING", active: true });
    this.toFollowers(device, { type: "TV_RESOLVING", active: true });

    let result: ResolveResult;
    try {
      result = await this.resolve(url);
    } catch {
      result = { status: "temporary_failure", reason: "Something went wrong while looking for the video." };
    }
    if (this.resolveSeq.get(device.id) !== seq) return; // superseded by a newer choice or a STOP

    this.send(this.tvs.get(device.id), { type: "TV_RESOLVING", active: false });
    this.toFollowers(device, { type: "TV_RESOLVING", active: false });
    if (result.status !== "success") return status(failureStatus(result));
    if (!this.tvs.has(device.id)) return tvOffline();

    const media = withHint(result.media, hint);
    status({ phase: "found", media });
    this.send(this.tvs.get(device.id), { type: "TV_CMD", command: { type: "LOAD", media, startAt } });
    this.send(this.tvs.get(device.id), { type: "TV_CMD", command: { type: "PLAY" } });
    this.toFollowers(device, { type: "TV_CMD", command: { type: "LOAD", media, startAt } });
    this.applyCommand(device, { type: "LOAD", media });
    this.toControllers(device, { type: "MEDIA", media });
    this.toControllers(device, { type: "STATE", state: device.state });
  }

  /** Keep the server's memory of the TV roughly right until the TV reports its real state. */
  private applyCommand(device: Device, command: Command): void {
    if (command.type === "LOAD") {
      device.media = command.media;
      device.state = { state: "loading", currentTime: 0, duration: 0 };
    } else if (command.type === "STOP") {
      device.media = null;
      device.state = IDLE_STATE;
    }
  }

  /* ------------------------------ sending ------------------------------ */

  private send(socket: WebSocket | undefined, message: ServerMessage): void {
    if (socket?.readyState === 1) socket.send(JSON.stringify(message));
  }

  private toControllers(device: Device, message: ServerMessage): void {
    for (const controller of this.registry.controllersOf(device)) {
      this.toController(controller.id, message);
    }
  }

  private toController(controllerId: string, message: ServerMessage): void {
    this.send(this.controllers.get(controllerId), message);
  }

  private error(controllerId: string, code: string, message: string): void {
    this.toController(controllerId, { type: "ERROR", code, message });
  }
}

function failureStatus(result: Exclude<ResolveResult, { status: "success" }>): ResolveStatus {
  if (result.status === "invalid_url") {
    return { phase: "failed", reason: "invalid_url", message: "That doesn't look like a link I can open." };
  }
  return { phase: "failed", reason: result.status, message: result.reason };
}
