import type { WebSocket } from "ws";
import {
  IDLE_STATE,
  MAX_FOLLOWERS,
  MAX_LAG_S,
  MAX_PHONE_TVS,
  PAIRING_CODE_TTL_MS,
  parseClientMessage,
  withHint,
  type ClientMessage,
  type Command,
  type PartyTv,
  type PartyView,
  type PhoneTv,
  type PlayHint,
  type PlayerState,
  type ResolveStatus,
  type ServerMessage,
} from "../../shared";
import { RateLimiter } from "../accounts/rateLimit";
import type { ScreenProfiles } from "../accounts/screens";
import type { ResolveFn, ResolveResult } from "../resolvers";
import { MAX_PHONES_PER_TV, type Controller, type Device, type Registry } from "../sessions/registry";
import { networkOf } from "../trust";

export const CLOSE_REPLACED = 4000;

export const FRAME_BURST = 100;
export const FRAME_RATE_PER_S = 30;

export const MAX_BUFFERED_BYTES = 1_000_000;

export const STEER_ATTRIBUTION_MS = 4000;

export const KEEP_UNPAIRED_MS = PAIRING_CODE_TTL_MS;

export const MAX_UNPAIRED = 5000;

export const MAX_FAILED_LINKS = 200;

interface Hold {
  playing: boolean;
  waiting: boolean;
  by: string;
}

type Conn =
  | { role: "none"; socket: WebSocket }
  | { role: "tv"; socket: WebSocket; deviceId: string }
  | { role: "controller"; socket: WebSocket; controllerId: string };

export interface HubOptions {
  staleAfterMs?: number;
  sweepEveryMs?: number;
  maxFailedPairings?: number;
  maxFailedPairingsInAll?: number;
  failedPairingWindowMs?: number;
  maxResolves?: number;
  resolveWindowMs?: number;
  maxResolvesByAddress?: number;
  profiles?: ScreenProfiles;
  keepUnpairedMs?: number;
  maxUnpaired?: number;
  maxFailedLinks?: number;
  log?: { info(object: Record<string, unknown>, message: string): void };
  helloWithinMs?: number;
  maxSocketsPerAddress?: number;
  maxSockets?: number;
  maxSocketsPerNetwork?: number;
  maxUnpairedPerAddress?: number;
  maxNewPairs?: number;
  hostGoneMs?: number;
}

const HOST_GONE_MS = 60_000;

export const MAX_SOCKETS_PER_ADDRESS = 100;
export const MAX_SOCKETS = 20_000;
export const MAX_SOCKETS_PER_NETWORK = 400;
export const MAX_UNPAIRED_PER_ADDRESS = 40;
export const MAX_NEW_PAIRS = 30;

export class Hub {
  private readonly tvs = new Map<string, WebSocket>();
  private readonly controllers = new Map<string, WebSocket>();
  private readonly phoneSockets = new Map<string, Set<WebSocket>>();
  connected(): { tvs: number; phones: number } {
    return { tvs: this.tvs.size, phones: this.controllers.size };
  }
  private readonly resolveSeq = new Map<string, number>();
  private readonly lastLookup = new Map<string, string>();
  private readonly startedFilm = new Map<string, string>();
  private readonly failedLinks = new Set<string>();
  private readonly log: HubOptions["log"];
  private readonly lastSeen = new Map<WebSocket, number>();
  private readonly opened = new Set<string>();
  private readonly roundTrips = new Map<string, number>();
  private readonly holds = new Map<string, Hold>();
  private readonly steered = new Map<string, { by: string; at: number }>();
  private readonly sweeper: ReturnType<typeof setInterval>;
  private readonly wrongByAddress: RateLimiter;
  private readonly wrongInAll: RateLimiter;
  private readonly resolvesByDevice: RateLimiter;
  private readonly resolvesByAddress: RateLimiter;
  private readonly addresses = new WeakMap<WebSocket, string>();
  private readonly profiles: ScreenProfiles | undefined;
  private goneSince = new Map<string, number>();
  private readonly awaySince = new Map<string, number>();
  private readonly startedAt = Date.now();
  private readonly keepUnpairedMs: number;
  private readonly maxUnpaired: number;
  private readonly maxFailedLinks: number;
  private readonly unnamed = new Map<WebSocket, number>();
  private readonly openByAddress = new Map<string, number>();
  private readonly openByNetwork = new Map<string, number>();
  private openInAll = 0;
  private readonly maxSocketsPerAddress: number;
  private readonly maxSockets: number;
  private readonly maxSocketsPerNetwork: number;
  private readonly maxUnpairedPerAddress: number;
  private readonly newPairs: RateLimiter;
  private readonly hostGoneMs: number;

  constructor(
    private readonly registry: Registry,
    private readonly resolve: ResolveFn,
    options: HubOptions = {},
  ) {
    const staleAfterMs = options.staleAfterMs ?? 60_000;
    this.profiles = options.profiles;
    this.keepUnpairedMs = options.keepUnpairedMs ?? KEEP_UNPAIRED_MS;
    this.maxUnpaired = options.maxUnpaired ?? MAX_UNPAIRED;
    this.maxFailedLinks = options.maxFailedLinks ?? MAX_FAILED_LINKS;
    this.log = options.log;
    const perAddress = options.maxFailedPairings ?? 20;
    const windowMs = options.failedPairingWindowMs ?? 60_000;
    this.wrongByAddress = new RateLimiter(perAddress, windowMs);
    this.wrongInAll = new RateLimiter(options.maxFailedPairingsInAll ?? perAddress * 5, windowMs);
    const resolveWindowMs = options.resolveWindowMs ?? 60_000;
    this.resolvesByDevice = new RateLimiter(options.maxResolves ?? 30, resolveWindowMs);
    this.resolvesByAddress = new RateLimiter(options.maxResolvesByAddress ?? 60, resolveWindowMs);
    this.maxSocketsPerAddress = options.maxSocketsPerAddress ?? MAX_SOCKETS_PER_ADDRESS;
    this.maxSockets = options.maxSockets ?? MAX_SOCKETS;
    this.maxSocketsPerNetwork = options.maxSocketsPerNetwork ?? MAX_SOCKETS_PER_NETWORK;
    this.maxUnpairedPerAddress = options.maxUnpairedPerAddress ?? MAX_UNPAIRED_PER_ADDRESS;
    this.newPairs = new RateLimiter(options.maxNewPairs ?? MAX_NEW_PAIRS, 3_600_000, undefined, "pairing.newPairs");
    this.hostGoneMs = options.hostGoneMs ?? HOST_GONE_MS;
    const helloWithinMs = options.helloWithinMs ?? 30_000;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [socket, seen] of this.lastSeen) if (now - seen > staleAfterMs) socket.terminate();
      for (const [socket, opened] of this.unnamed) if (now - opened > helloWithinMs) socket.close(1008, "say hello first");
      for (const [id, since] of this.awaySince) if (now - since > this.hostGoneMs) this.awaySince.delete(id);
      this.forgetAbandoned(now);
    }, options.sweepEveryMs ?? 20_000);
    this.sweeper.unref();
  }

  dispose(): void {
    clearInterval(this.sweeper);
  }

  handleConnection(socket: WebSocket, address?: string): void {
    const network = address === undefined ? undefined : networkOf(address);
    if (
      this.openInAll >= this.maxSockets ||
      (address !== undefined && (this.openByAddress.get(address) ?? 0) >= this.maxSocketsPerAddress) ||
      (network !== undefined && (this.openByNetwork.get(network) ?? 0) >= this.maxSocketsPerNetwork)
    ) {
      socket.close(1013, "busy");
      return;
    }
    this.openInAll += 1;
    if (address !== undefined) this.openByAddress.set(address, (this.openByAddress.get(address) ?? 0) + 1);
    if (network !== undefined) this.openByNetwork.set(network, (this.openByNetwork.get(network) ?? 0) + 1);
    let conn: Conn = { role: "none", socket };
    const now = Date.now();
    this.lastSeen.set(socket, now);
    this.unnamed.set(socket, now);
    if (address) this.addresses.set(socket, address);
    let load = 0;
    let loadAt = now;

    socket.on("message", (data, isBinary) => {
      const at = Date.now();
      load = Math.max(0, load - ((at - loadAt) / 1000) * FRAME_RATE_PER_S) + 1;
      loadAt = at;
      if (load > FRAME_BURST) {
        if (load > 2 * FRAME_BURST && socket.readyState === socket.OPEN) socket.close(1008, "too many messages");
        return;
      }
      this.lastSeen.set(socket, at);
      const message = isBinary ? null : parseClientMessage(data.toString());
      if (!message) return this.send(socket, { type: "ERROR", code: "BAD_MESSAGE", message: "Invalid message." });
      conn = this.dispatch(conn, message);
      if (conn.role !== "none") this.unnamed.delete(socket);
    });

    socket.on("close", () => {
      this.lastSeen.delete(socket);
      this.unnamed.delete(socket);
      this.openInAll -= 1;
      if (network !== undefined) {
        const left = (this.openByNetwork.get(network) ?? 1) - 1;
        if (left > 0) this.openByNetwork.set(network, left);
        else this.openByNetwork.delete(network);
      }
      if (address !== undefined) {
        const left = (this.openByAddress.get(address) ?? 1) - 1;
        if (left > 0) this.openByAddress.set(address, left);
        else this.openByAddress.delete(address);
      }
      if (conn.role === "tv" && this.tvs.get(conn.deviceId) === socket) {
        this.tvs.delete(conn.deviceId);
        this.awaySince.set(conn.deviceId, Date.now());
        this.opened.delete(conn.deviceId);
        this.roundTrips.delete(conn.deviceId);
        this.holds.delete(conn.deviceId);
        this.steered.delete(conn.deviceId);
        const device = this.registry.getDevice(conn.deviceId);
        if (device) this.registry.checkpoint(device);
        if (device) this.toControllers(device, { type: "TV_STATUS", online: false });
        if (device) this.tellPhones(device);
        const host = device && (this.registry.leaderOf(device) ?? device);
        if (host && this.registry.inParty(host)) this.sendParty(host);
      }
      if (conn.role === "controller") this.phoneClosed(conn.controllerId, socket);
    });
    socket.on("error", () => {});
  }

  private dispatch(conn: Conn, message: ClientMessage): Conn {
    switch (message.type) {
      case "TV_HELLO":
        return this.tvHello(conn, message.deviceId, message.opened === true);
      case "CTL_HELLO":
        return this.controllerHello(conn, message.controllerId);
      case "PING":
        if (conn.role !== "none") this.registry.markSeen(conn.role === "tv" ? conn.deviceId : conn.controllerId);
        if (conn.role === "tv" && message.rtt !== undefined) this.roundTrips.set(conn.deviceId, message.rtt);
        this.send(conn.socket, { type: "PONG" });
        return conn;
    }

    if (conn.role === "tv") this.fromTv(conn.deviceId, message);
    else if (conn.role === "controller") this.fromController(conn.controllerId, message);
    else this.send(conn.socket, { type: "ERROR", code: "NOT_AUTHENTICATED", message: "Say hello first." });
    return conn;
  }

  private forgetAbandoned(now: number): void {
    const waiting = new Map<string, number>();
    const look = (free: string[], connected: Map<string, WebSocket>): void => {
      for (const id of free) {
        if (connected.has(id)) continue;
        const since = this.goneSince.get(id) ?? now;
        if (now - since >= this.keepUnpairedMs) this.forget(id);
        else waiting.set(id, since);
      }
    };
    look(this.registry.freeTvs(), this.tvs);
    look(this.registry.freePhones(), this.controllers);
    this.goneSince = waiting;
  }

  private hasRoomFor(kind: "tv" | "phone", socket: WebSocket): boolean {
    const free = kind === "tv" ? this.registry.freeTvs() : this.registry.freePhones();
    const connected = kind === "tv" ? this.tvs : this.controllers;
    const address = this.addresses.get(socket);
    if (address !== undefined) {
      let here = 0;
      for (const id of free) {
        const open = connected.get(id);
        if (open && this.addresses.get(open) === address && ++here >= this.maxUnpairedPerAddress) return false;
      }
    }
    if (free.length < this.maxUnpaired) return true;
    const gone = free.find((id) => !connected.has(id));
    if (gone === undefined) return false;
    this.forget(gone);
    return true;
  }

  private forget(id: string): void {
    this.registry.forgetFree(id);
    this.resolveSeq.delete(id);
    this.lastLookup.delete(id);
    this.startedFilm.delete(id);
  }

  private noteStarted(device: Device, { lookupMs, loadMs, resumed, manifestMs, pieceMs, pieceS, pieceKB, height, metadataMs }: Omit<Extract<ClientMessage, { type: "TV_STARTED" }>, "type">): void {
    const link = this.lastLookup.get(device.id);
    const stream = device.media?.stream;
    if (!link || !stream || this.startedFilm.get(device.id) === stream.url) return;
    this.startedFilm.set(device.id, stream.url);
    let domain = "";
    try {
      domain = new URL(link).hostname;
    } catch {
    }
    const load = Object.fromEntries(Object.entries({ resumed, manifestMs, pieceMs, pieceS, pieceKB, height, metadataMs }).filter(([, value]) => value !== undefined));
    this.log?.info({ domain, type: stream.type, ...(stream.directUrl && { direct: true }), ...(lookupMs !== undefined && { lookupMs }), loadMs, ...load }, "playback-started");
  }

  private noteFailed(deviceId: string, state: PlayerState): void {
    const link = this.lastLookup.get(deviceId);
    if (!link) return;
    let domain = "";
    try {
      domain = new URL(link).hostname;
    } catch {
    }
    this.log?.info({ domain, error: state.error, ...(state.detail && { detail: state.detail }) }, "playback-failed");
    this.failedLinks.delete(link);
    this.failedLinks.add(link);
    for (const oldest of this.failedLinks) {
      if (this.failedLinks.size <= this.maxFailedLinks) break;
      this.failedLinks.delete(oldest);
    }
  }

  private turnAway(conn: Conn): Conn {
    conn.socket.close(1013, "busy");
    return conn;
  }

  private tvHello(conn: Conn, named?: string, opened = false): Conn {
    const mine = conn.role === "tv" ? conn.deviceId : undefined;
    if (conn.role !== "none" && (!mine || (named && named !== mine && this.registry.getDevice(named)))) return this.refuseHello(conn);
    const { socket } = conn;
    const wanted = mine ?? named;
    if (!(wanted && this.registry.getDevice(wanted)) && !this.hasRoomFor("tv", socket)) return this.turnAway(conn);
    const device = this.registry.tvHello(wanted);
    this.goneSince.delete(device.id);
    this.awaySince.delete(device.id);

    const previous = this.tvs.get(device.id);
    this.tvs.set(device.id, socket);
    if (previous && previous !== socket) previous.close(CLOSE_REPLACED, "replaced");

    const wasWith = opened ? this.registry.leaderOf(device) : undefined;
    let leftParty: string | undefined;
    if (wasWith && !this.tvs.has(wasWith.id) && Date.now() - (this.awaySince.get(wasWith.id) ?? this.startedAt) >= this.hostGoneMs) {
      this.registry.detachFollower(device);
      leftParty = this.registry.displayName(wasWith);
      this.sendParty(wasWith);
    }

    const leader = this.registry.leaderOf(device);
    if (opened && !leader) {
      this.opened.add(device.id);
      device.state = IDLE_STATE;
    } else this.opened.delete(device.id);
    this.send(socket, {
      type: "TV_WELCOME",
      deviceId: device.id,
      paired: device.controllerId !== null || leader !== undefined,
      pairing: this.registry.ensureCode(device),
      ...(leader ? { following: this.registry.displayName(leader) } : {}),
      ...(leftParty ? { leftParty } : {}),
    });
    this.toControllers(device, { type: "TV_STATUS", online: true });
    this.tellPhones(device);
    if (leader) {
      this.catchUp(device, leader);
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
      const first = this.opened.delete(deviceId);
      const wasOn = device.state.state !== "idle";
      if (message.media && !device.media && !device.leaderId && message.state.state !== "idle") {
        device.media = message.media;
        this.toControllers(device, { type: "MEDIA", media: message.media });
      }
      device.state = message.state;
      if (message.state.state === "error") this.noteFailed(deviceId, message.state);
      this.toControllers(device, { type: "STATE", state: message.state });
      this.syncFollowers(device);
      this.registry.noteProgress(device, message.state);
      if (wasOn && message.state.state === "idle") {
        this.registry.forgetResume(device);
        if (device.followerIds.length > 0) this.toFollowers(device, { type: "TV_CMD", command: { type: "STOP" } });
        this.applyCommand(device, { type: "STOP" });
      }
      if (first) this.restore(device);
    } else if (message.type === "TV_NAME") {
      this.registry.setLabel(device, message.name);
      this.tellPhones(device);
      const host = this.registry.leaderOf(device) ?? device;
      if (this.registry.inParty(host)) this.sendParty(host);
    } else if (message.type === "TV_PROFILE") {
      this.registry.setProfile(device, (message.proof && this.profiles?.redeem(message.proof)) || null);
      const host = this.registry.leaderOf(device) ?? device;
      if (this.registry.inParty(host)) this.sendParty(host);
    } else if (message.type === "TV_PARTY_OPEN") {
      if (device.leaderId) return;
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
    } else if (message.type === "TV_PARTY_ADMIN") {
      this.setAdmin(device, message.id, message.admin);
    } else if (message.type === "TV_PARTY_CMD") {
      const host = this.registry.leaderOf(device);
      if (!host || !device.admin || !this.tvs.has(host.id)) return;
      if (message.command.type === "PLAY" || message.command.type === "PAUSE") this.steered.set(host.id, { by: device.publicId, at: Date.now() });
      this.command(host, message.command, undefined, device.publicId);
    } else if (message.type === "TV_NEW_CODE") {
      const hasPhone = device.controllerId !== null;
      const pairing = hasPhone ? this.registry.ensureControlCode(device) : this.registry.ensureCode(device);
      if (pairing) this.send(this.tvs.get(deviceId), { type: "TV_CODE", pairing, ...(hasPhone ? { control: true } : {}) });
    } else if (message.type === "TV_NEXT_EPISODE") {
      if (device.leaderId) return;
      if (device.media?.series?.next?.url) {
        void this.playUrlForDevice(device, device.media.series.next.url, undefined, undefined, { poster: device.media.poster, backdrop: device.media.backdrop, year: device.media.year });
      }
    } else if (message.type === "TV_PLAY_URL") {
      if (device.leaderId) return;
      void this.playUrlForDevice(device, message.url, undefined, message.startAt, message.hint);
    } else if (message.type === "TV_CANCEL") {
      if (device.leaderId) return;
      this.cancelLoad(device);
    } else if (message.type === "TV_STARTED") {
      this.noteStarted(device, message);
    } else if (message.type === "TV_UNPAIR") {
      const leader = this.registry.leaderOf(device);
      if (leader) {
        this.registry.detachFollower(device);
        this.resetTv(device);
        this.sendParty(leader);
        return;
      }
      const followers = this.registry.followersOf(device);
      const phones = this.registry.phonesOf(device);
      this.registry.unpairDevice(device);
      this.resetTv(device);
      followers.forEach((follower) => this.resetTv(follower));
      phones.forEach((phone) => (phone.deviceId === null ? this.sendWelcome(phone) : this.sendTvs(phone)));
    }
  }

  private controllerHello(conn: Conn, named?: string): Conn {
    const mine = conn.role === "controller" ? conn.controllerId : undefined;
    if (conn.role !== "none" && (!mine || (named && named !== mine && this.registry.getController(named)))) return this.refuseHello(conn);
    const { socket } = conn;
    const wanted = mine ?? named;
    if (!(wanted && this.registry.getController(wanted)) && !this.hasRoomFor("phone", socket)) return this.turnAway(conn);
    const controller = this.registry.controllerHello(wanted);
    this.goneSince.delete(controller.id);
    this.phoneOpened(controller.id, socket);
    this.sendWelcome(controller);
    return { role: "controller", socket, controllerId: controller.id };
  }

  private phoneOpened(id: string, socket: WebSocket): void {
    const open = this.phoneSockets.get(id) ?? new Set<WebSocket>();
    open.add(socket);
    this.phoneSockets.set(id, open);
    this.controllers.set(id, socket);
  }

  private phoneClosed(id: string, socket: WebSocket): void {
    const open = this.phoneSockets.get(id);
    open?.delete(socket);
    const newest = open ? [...open].pop() : undefined;
    if (!newest) {
      this.phoneSockets.delete(id);
      if (this.controllers.get(id) === socket) this.controllers.delete(id);
    } else if (this.controllers.get(id) === socket) this.controllers.set(id, newest);
  }

  private refuseHello(conn: Conn): Conn {
    this.send(conn.socket, { type: "ERROR", code: "ALREADY_HELLO", message: "This connection is a TV or a phone already. Connect again to be another." });
    return conn;
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
            controllerCount: this.registry.controllersOf(device).length,
          }
        : null,
      media: device?.media ?? null,
      state: device?.state ?? IDLE_STATE,
      party: device ? this.partyOf(device) : [],
      tvs: this.tvList(controller),
    });
  }

  private tvList(controller: Controller): PhoneTv[] {
    return this.registry.tvsOf(controller).map((device) => ({
      id: device.publicId,
      name: device.name,
      ...(device.label ? { label: device.label } : {}),
      online: this.tvs.has(device.id),
      current: device.id === controller.deviceId,
    }));
  }

  private sendTvs(controller: Controller): void {
    this.toController(controller.id, { type: "TVS", tvs: this.tvList(controller) });
  }

  private tellPhones(device: Device): void {
    for (const phone of this.registry.phonesOf(device)) this.sendTvs(phone);
  }

  private fromController(controllerId: string, message: ClientMessage): void {
    const controller = this.registry.getController(controllerId);
    if (!controller) return;
    if (message.type === "PAIR") return this.pair(controller, message.code);
    if (message.type === "PLAY_URL") return void this.playUrl(controller, message.url, message.startAt, message.hint);
    if (message.type === "UNPAIR") return this.unpair(controller, message.id);
    if (message.type === "SWITCH_TV") return this.switchTv(controller, message.id);
    if (message.type === "NAME_TV") return this.nameTv(controller, message.name);
    if (message.type === "ADD_TV") return this.addTv(controller, message.code);
    if (message.type === "REMOVE_TV") return this.removeTv(controller, message.id);
    if (message.type === "OPEN_PARTY") return this.openParty(controller);
    if (message.type === "END_PARTY") return this.endParty(controller);
    if (message.type === "PARTY_ADMIN") return this.partyAdmin(controller, message.id, message.admin);
    if (message.type !== "CMD") return;

    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controllerId, "NOT_PAIRED", "Connect to a TV first.");
    if (!this.tvs.has(device.id)) return this.error(controllerId, "TV_OFFLINE", "The TV is offline.");
    this.command(device, message.command, controllerId);
  }

  private command(device: Device, command: Command, controllerId?: string, by?: string): void {
    if (command.type === "NEXT_EPISODE") {
      if (device.media?.series?.next?.url) {
        void this.playUrlForDevice(device, device.media.series.next.url, controllerId);
      }
      return;
    }

    if (command.type === "LOAD" || command.type === "STOP") this.bumpResolveSeq(device.id);
    this.send(this.tvs.get(device.id), { type: "TV_CMD", command, ...(by ? { by } : {}) });
    if (command.type === "LOAD" || command.type === "STOP") {
      this.toFollowers(device, { type: "TV_CMD", command });
    }
    if (command.type === "LOAD" || command.type === "STOP") {
      this.applyCommand(device, command);
      this.toControllers(device, { type: "STATE", state: device.state });
    }
  }

  private pair(controller: Controller, code: string): void {
    if (this.registry.isFull(controller)) return this.error(controller.id, "TV_LIST_FULL", `A phone can keep ${MAX_PHONE_TVS} TVs. Forget one first.`);
    const socket = this.controllers.get(controller.id);
    if (this.pairingPaused(socket)) return this.error(controller.id, "RATE_LIMITED", "Too many wrong codes. Try again in a minute.");
    const address = socket && this.addresses.get(socket);
    if (address && this.newPairs.wait(address) > 0) return this.error(controller.id, "RATE_LIMITED", "Too many phones were connected from here lately. Try again later.");

    const before = this.registry.deviceForController(controller);
    let device = this.registry.pair(controller, code);
    let isNewPair = true;
    if (!device) {
      device = this.registry.joinController(controller, code, (id) => this.controllers.has(id));
      isNewPair = false;
    }
    if (device && address) this.newPairs.hit(address);
    if (!device) {
      if (this.registry.isPartyCode(code)) {
        return this.error(controller.id, "PARTY_CODE", "That is the code of a watch party. Watch on this device to join it.");
      }
      if (this.registry.isFullControlCode(controller, code)) {
        return this.error(controller.id, "TV_PHONES_FULL", `That TV already has ${MAX_PHONES_PER_TV} phones, all it can keep. Disconnect its phones on the TV, then try again.`);
      }
      this.wrongCode(socket);
      return this.error(controller.id, "INVALID_CODE", "Invalid or expired code.");
    }
    this.send(this.tvs.get(device.id), { type: "TV_PAIRED" });
    this.sendWelcome(controller);
    if (!isNewPair) {
      for (const other of this.registry.controllersOf(device)) {
        if (other.id !== controller.id) this.sendWelcome(other);
      }
    }
    this.tellLeftBehind(controller, before, device);
  }

  private tellLeftBehind(controller: Controller, before: Device | undefined, now: Device): void {
    if (!before || before === now) return;
    for (const other of this.registry.controllersOf(before)) {
      if (other.id !== controller.id) this.sendWelcome(other);
    }
  }

  private switchTv(controller: Controller, id: string): void {
    const before = this.registry.deviceForController(controller);
    const device = this.registry.switchTo(controller, id);
    if (!device) {
      this.error(controller.id, "NOT_YOUR_TV", "That TV is not on your list any more.");
      return this.sendTvs(controller);
    }
    if (device !== before) {
      this.send(this.tvs.get(device.id), { type: "TV_PAIRED" });
      for (const other of this.registry.controllersOf(device)) {
        if (other.id !== controller.id) this.sendWelcome(other);
      }
      this.tellLeftBehind(controller, before, device);
    }
    this.sendWelcome(controller);
  }

  private nameTv(controller: Controller, name: string): void {
    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    this.registry.rename(device, name);
    this.tellPhones(device);
    const host = this.registry.leaderOf(device) ?? device;
    if (this.registry.inParty(host)) this.sendParty(host);
  }

  private addressOf(socket: WebSocket | undefined): string {
    return (socket && this.addresses.get(socket)) ?? "unknown";
  }

  private pairingPaused(socket: WebSocket | undefined): boolean {
    return this.wrongByAddress.wait(this.addressOf(socket)) > 0 || this.wrongInAll.wait("all") > 0;
  }

  private wrongCode(socket: WebSocket | undefined): void {
    this.wrongByAddress.hit(this.addressOf(socket));
    this.wrongInAll.hit("all");
  }

  private unpair(controller: Controller, id?: string): void {
    const leader = id === undefined ? this.registry.deviceForController(controller) : this.registry.tvsOf(controller).find((tv) => tv.publicId === id);
    const wasCurrent = leader !== undefined && leader.id === controller.deviceId;
    const followers = leader ? this.registry.followersOf(leader) : [];
    const device = this.registry.unpair(controller, id);
    if (device) {
      this.resetTv(device);
      followers.forEach((follower) => this.resetTv(follower));
    } else if (leader && wasCurrent) {
      for (const other of this.registry.controllersOf(leader)) {
        this.sendWelcome(other);
      }
    }
    if (id === undefined || wasCurrent) this.sendWelcome(controller);
    else this.sendTvs(controller);
  }

  private addTv(controller: Controller, code: string): void {
    const socket = this.controllers.get(controller.id);
    if (this.pairingPaused(socket)) return this.error(controller.id, "RATE_LIMITED", "Too many wrong codes. Try again in a minute.");
    const joined = this.registry.addFollower(controller, code);
    if (!joined.ok) {
      if (joined.reason === "INVALID_CODE") {
        if (this.registry.isPartyCode(code)) {
          return this.error(controller.id, "ADD_PARTY_CODE", "That is the code of a watch party. Type it on the device that should join it.");
        }
        this.wrongCode(socket);
        return this.error(controller.id, "INVALID_CODE", "Invalid or expired code.");
      }
      if (joined.reason === "PARTY_FULL") {
        return this.error(controller.id, "PARTY_FULL", `A party has room for ${MAX_FOLLOWERS + 1} devices.`);
      }
      if (joined.reason === "TV_HOSTING") {
        return this.error(controller.id, "TV_HOSTING", "That device hosts a party of its own. End it there first.");
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

  private openParty(controller: Controller): void {
    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    this.registry.ensurePartyCode(device);
    this.sendParty(device);
  }

  private setAdmin(host: Device, publicId: string, admin: boolean): void {
    if (!this.registry.setAdmin(host, publicId, admin)) return;
    this.sendParty(host);
  }

  private partyAdmin(controller: Controller, publicId: string, admin: boolean): void {
    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    this.setAdmin(device, publicId, admin);
  }

  private endParty(controller: Controller): void {
    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    this.registry.closeParty(device).forEach((guest) => this.resetTv(guest));
    this.sendParty(device);
  }

  private joinParty(guest: Device, code: string): void {
    const tv = this.tvs.get(guest.id);
    const refuse = (errorCode: string, message: string) => this.send(tv, { type: "ERROR", code: errorCode, message });
    if (this.pairingPaused(tv)) return refuse("RATE_LIMITED", "Too many wrong codes. Try again in a minute.");
    const joined = this.registry.joinParty(guest, code);
    if (!joined.ok) {
      switch (joined.reason) {
        case "INVALID_CODE":
          this.wrongCode(tv);
          return refuse("INVALID_CODE", "Invalid or expired code.");
        case "PARTY_FULL":
          return refuse("PARTY_FULL", `A party has room for ${MAX_FOLLOWERS + 1} devices.`);
        case "HOSTING":
          return refuse("HOSTING", "End your own party before joining another.");
        case "HAS_PHONE":
          return refuse("HAS_PHONE", "Disconnect the phone from this TV before joining a party.");
        case "ALREADY_IN_PARTY":
          return refuse("ALREADY_IN_PARTY", "Leave this party before joining another.");
      }
    }
    this.bumpResolveSeq(guest.id);
    this.send(tv, { type: "TV_FOLLOWING", leader: this.registry.displayName(joined.host) });
    this.catchUp(guest, joined.host);
    this.sendParty(joined.host);
  }

  private partyTv(device: Device): PartyTv {
    const profile = device.profileId ? this.profiles?.card(device.profileId) : undefined;
    return {
      id: device.publicId,
      name: this.registry.displayName(device),
      online: this.tvs.has(device.id),
      ...(device.admin ? { admin: true } : {}),
      ...(profile ? { profile } : {}),
    };
  }

  private partyOf(host: Device): PartyTv[] {
    return this.registry.followersOf(host).map((guest) => this.partyTv(guest));
  }

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

  private catchUp(follower: Device, leader: Device): void {
    if (!leader.media) return;
    const at = leader.state.currentTime;
    this.send(this.tvs.get(follower.id), {
      type: "TV_CMD",
      command: { type: "LOAD", media: leader.media, ...(at > 5 ? { startAt: Math.floor(at) } : {}) },
    });
  }

  private syncFollowers(leader: Device): void {
    const { state } = leader;
    if (leader.followerIds.length === 0) {
      this.holds.delete(leader.id);
      this.steered.delete(leader.id);
      return;
    }
    if (state.state !== "playing" && state.state !== "paused") return;
    const waiting = state.state === "playing" && Boolean(state.buffering);
    const playing = state.state === "playing" && !waiting;
    const report = {
      type: "TV_SYNC" as const,
      playing,
      time: state.currentTime,
      rate: state.playbackRate ?? 1,
      ...(state.stream ? { stream: state.stream } : {}),
      by: this.holder(leader, playing, waiting),
      ...(waiting ? { waiting: true } : {}),
      ...(state.ended ? { ended: true } : {}),
    };
    for (const follower of this.registry.followersOf(leader)) {
      const lag = this.lagBetween(leader, follower);
      this.send(this.tvs.get(follower.id), lag === undefined ? report : { ...report, lag });
    }
  }

  private holder(leader: Device, playing: boolean, waiting: boolean): string {
    const before = this.holds.get(leader.id);
    if (before && before.playing === playing && before.waiting === waiting) return before.by;
    const steer = this.steered.get(leader.id);
    this.steered.delete(leader.id);
    const by = !waiting && steer && Date.now() - steer.at < STEER_ATTRIBUTION_MS ? steer.by : leader.publicId;
    this.holds.set(leader.id, { playing, waiting, by });
    return by;
  }

  private lagBetween(leader: Device, follower: Device): number | undefined {
    const there = this.roundTrips.get(leader.id);
    const here = this.roundTrips.get(follower.id);
    if (there === undefined && here === undefined) return undefined;
    return Math.min(MAX_LAG_S, ((there ?? here ?? 0) + (here ?? there ?? 0)) / 2000);
  }

  private resetTv(device: Device): void {
    this.bumpResolveSeq(device.id);
    const tv = this.tvs.get(device.id);
    this.send(tv, { type: "TV_CMD", command: { type: "STOP" } });
    this.send(tv, { type: "TV_UNPAIRED", pairing: this.registry.ensureCode(device) });
    this.send(tv, { type: "TV_PARTY", party: null });
  }

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

  private async playUrl(controller: Controller, url: string, startAt?: number, hint?: PlayHint): Promise<void> {
    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    return this.playUrlForDevice(device, url, controller.id, startAt, hint);
  }

  private restore(device: Device): void {
    const back = this.registry.resumeOf(device);
    if (back) void this.playUrlForDevice(device, back.url, undefined, back.time > 5 ? back.time : undefined, back.hint, true);
  }

  private async playUrlForDevice(device: Device, url: string, controllerId?: string, startAt?: number, hint?: PlayHint, putBack = false): Promise<void> {
    const status = (s: ResolveStatus) => {
      this.toControllers(device, { type: "RESOLVE_STATUS", status: s });
    };
    const tvOffline = () => status({ phase: "failed", reason: "tv_offline", message: "The TV is offline." });
    if (!this.tvs.has(device.id)) return tvOffline();

    const address = this.addressOf(controllerId ? this.controllers.get(controllerId) : this.tvs.get(device.id));
    if (this.resolvesByDevice.wait(device.id) > 0 || this.resolvesByAddress.wait(address) > 0) {
      const message = "Too many videos asked for in a short time. Try again in a minute.";
      if (controllerId) return this.error(controllerId, "RATE_LIMITED", message);
      return this.send(this.tvs.get(device.id), { type: "ERROR", code: "RATE_LIMITED", message });
    }
    this.resolvesByDevice.hit(device.id);
    this.resolvesByAddress.hit(address);

    const seq = this.bumpResolveSeq(device.id);
    status({ phase: "resolving" });
    this.send(this.tvs.get(device.id), { type: "TV_RESOLVING", active: true, ...(hint && { hint }) });
    this.toFollowers(device, { type: "TV_RESOLVING", active: true });

    const fresh = this.failedLinks.delete(url);
    this.lastLookup.set(device.id, url);
    let result: ResolveResult;
    try {
      result = await this.resolve(url, false, fresh);
    } catch {
      result = { status: "temporary_failure", reason: "Something went wrong while looking for the video." };
    }
    if (this.resolveSeq.get(device.id) !== seq) return;

    this.send(this.tvs.get(device.id), { type: "TV_RESOLVING", active: false });
    this.toFollowers(device, { type: "TV_RESOLVING", active: false });
    if (result.status !== "success") return status(failureStatus(result));
    if (!this.tvs.has(device.id)) return tvOffline();

    const media = withHint(result.media, hint);
    status({ phase: "found", media });
    this.send(this.tvs.get(device.id), { type: "TV_CMD", command: { type: "LOAD", media, startAt } });
    if (!putBack) this.send(this.tvs.get(device.id), { type: "TV_CMD", command: { type: "PLAY" } });
    this.toFollowers(device, { type: "TV_CMD", command: { type: "LOAD", media, startAt } });
    this.applyCommand(device, { type: "LOAD", media, ...(startAt === undefined ? {} : { startAt }) }, putBack);
    this.toControllers(device, { type: "MEDIA", media });
    this.toControllers(device, { type: "STATE", state: device.state });
  }

  private applyCommand(device: Device, command: Command, putBack = false): void {
    if (command.type === "LOAD") {
      device.media = command.media;
      device.state = { state: "loading", currentTime: 0, duration: 0 };
      this.registry.startedPlaying(device, command.media, command.startAt, putBack);
    } else if (command.type === "STOP") {
      device.media = null;
      device.state = IDLE_STATE;
      this.registry.forgetResume(device);
    }
  }

  private send(socket: WebSocket | undefined, message: ServerMessage): void {
    if (socket?.readyState !== 1) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return socket.terminate();
    socket.send(JSON.stringify(message));
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
