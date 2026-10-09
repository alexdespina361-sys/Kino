import type { WebSocket } from "ws";
import {
  IDLE_STATE,
  parseClientMessage,
  type ClientMessage,
  type Command,
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
        if (device?.controllerId) this.toController(device.controllerId, { type: "TV_STATUS", online: false });
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

    this.send(socket, {
      type: "TV_WELCOME",
      deviceId: device.id,
      paired: device.controllerId !== null,
      pairing: this.registry.ensureCode(device),
    });
    if (device.controllerId) this.toController(device.controllerId, { type: "TV_STATUS", online: true });
    return { role: "tv", socket, deviceId: device.id };
  }

  private fromTv(deviceId: string, message: ClientMessage): void {
    const device = this.registry.getDevice(deviceId);
    if (!device) return;

    if (message.type === "TV_STATE") {
      device.state = message.state;
      if (device.controllerId) this.toController(device.controllerId, { type: "STATE", state: message.state });
    } else if (message.type === "TV_NEW_CODE") {
      const pairing = this.registry.ensureCode(device);
      if (pairing) this.send(this.tvs.get(deviceId), { type: "TV_CODE", pairing });
    } else if (message.type === "TV_NEXT_EPISODE") {
      if (device.media?.series?.next?.url) {
        void this.playUrlForDevice(device, device.media.series.next.url);
      }
    } else if (message.type === "TV_PLAY_URL") {
      void this.playUrlForDevice(device, message.url);
    } else if (message.type === "TV_UNPAIR") {
      const controller = this.registry.unpairDevice(device);
      this.resetTv(device);
      if (controller) this.sendWelcome(controller); // no TV any more: the phone is back at the code screen
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
    this.toController(controller.id, {
      type: "CTL_WELCOME",
      controllerId: controller.id,
      tv: device ? { name: device.name, online: this.tvs.has(device.id) } : null,
      media: device?.media ?? null,
      state: device?.state ?? IDLE_STATE,
    });
  }

  private fromController(controllerId: string, message: ClientMessage): void {
    const controller = this.registry.controllerHello(controllerId);
    if (message.type === "PAIR") return this.pair(controller, message.code);
    if (message.type === "PLAY_URL") return void this.playUrl(controller, message.url, message.startAt);
    if (message.type === "UNPAIR") return this.unpair(controller);
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
    // The phone always renders what the TV reports; only LOAD/STOP need an immediate placeholder.
    if (message.command.type === "LOAD" || message.command.type === "STOP") {
      this.applyCommand(device, message.command);
      this.toController(controllerId, { type: "STATE", state: device.state });
    }
  }

  private pair(controller: Controller, code: string): void {
    if (controller.deviceId) return this.error(controller.id, "ALREADY_PAIRED", "Already connected to a TV.");
    const now = Date.now();
    this.failedPairings = this.failedPairings.filter((at) => now - at < this.failedPairingWindowMs);
    // While blocked the code is not even checked, so a right guess gets no answer different from a wrong one.
    if (this.failedPairings.length >= this.maxFailedPairings) {
      return this.error(controller.id, "RATE_LIMITED", "Too many wrong codes. Try again in a minute.");
    }
    const device = this.registry.pair(controller, code);
    if (!device) {
      this.failedPairings.push(now);
      return this.error(controller.id, "INVALID_CODE", "Invalid or expired code.");
    }
    this.send(this.tvs.get(device.id), { type: "TV_PAIRED" });
    this.sendWelcome(controller);
  }

  /** The phone forgets its TV: the TV stops, gets a fresh code, and the phone is sent back to the code screen. */
  private unpair(controller: Controller): void {
    const device = this.registry.unpair(controller);
    if (device) this.resetTv(device);
    this.sendWelcome(controller);
  }

  /** After a pairing ended from either side: the TV stops and shows a fresh code. */
  private resetTv(device: Device): void {
    this.bumpResolveSeq(device.id); // a lookup still in flight must not start playing on an unpaired TV
    const tv = this.tvs.get(device.id);
    this.send(tv, { type: "TV_CMD", command: { type: "STOP" } });
    this.send(tv, { type: "TV_UNPAIRED", pairing: this.registry.ensureCode(device) });
  }

  private bumpResolveSeq(deviceId: string): number {
    const next = (this.resolveSeq.get(deviceId) ?? 0) + 1;
    this.resolveSeq.set(deviceId, next);
    return next;
  }

  /** Resolve a pasted URL to media, report progress to the phone, then have the TV load and play it. */
  private async playUrl(controller: Controller, url: string, startAt?: number): Promise<void> {
    const device = this.registry.deviceForController(controller);
    if (!device) return this.error(controller.id, "NOT_PAIRED", "Connect to a TV first.");
    return this.playUrlForDevice(device, url, controller.id, startAt);
  }

  private async playUrlForDevice(device: Device, url: string, controllerId?: string, startAt?: number): Promise<void> {
    const cId = controllerId || device.controllerId;
    const status = (s: ResolveStatus) => {
      if (cId) this.toController(cId, { type: "RESOLVE_STATUS", status: s });
    };
    const tvOffline = () => status({ phase: "failed", reason: "tv_offline", message: "The TV is offline." });
    if (!this.tvs.has(device.id)) return tvOffline();

    const seq = this.bumpResolveSeq(device.id);
    status({ phase: "resolving" });
    this.send(this.tvs.get(device.id), { type: "TV_RESOLVING", active: true });

    let result: ResolveResult;
    try {
      result = await this.resolve(url);
    } catch {
      result = { status: "temporary_failure", reason: "Something went wrong while looking for the video." };
    }
    if (this.resolveSeq.get(device.id) !== seq) return; // superseded by a newer choice or a STOP

    this.send(this.tvs.get(device.id), { type: "TV_RESOLVING", active: false });
    if (result.status !== "success") return status(failureStatus(result));
    if (!this.tvs.has(device.id)) return tvOffline();

    status({ phase: "found", media: result.media });
    this.send(this.tvs.get(device.id), { type: "TV_CMD", command: { type: "LOAD", media: result.media, startAt } });
    this.send(this.tvs.get(device.id), { type: "TV_CMD", command: { type: "PLAY" } });
    this.applyCommand(device, { type: "LOAD", media: result.media });
    if (cId) {
      this.toController(cId, { type: "MEDIA", media: result.media });
      this.toController(cId, { type: "STATE", state: device.state });
    }
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
