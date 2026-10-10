import { randomBytes, randomInt } from "node:crypto";
import {
  IDLE_STATE,
  MAX_FOLLOWERS,
  PAIRING_CODE_TTL_MS,
  type NormalizedMedia,
  type PairingCode,
  type PlayerState,
} from "../../shared";

export function generatePairingCode(rng: (min: number, max: number) => number = randomInt): string {
  return String(rng(0, 1_000_000)).padStart(6, "0");
}

export interface Device {
  id: string;
  /** What a phone may know about this TV (the id is its secret): how the watch-together list names it for removal. */
  publicId: string;
  name: string;
  /** Present only while unpaired. Single use: consumed by a successful pairing. */
  code: { value: string; expiresAt: number } | null;
  controllerId: string | null;
  /** All phones currently controlling this TV or party. */
  controllerIds: string[];
  /** Re-usable 6-digit code for additional phones to join this TV or party while it's active. */
  controlCode: { value: string; expiresAt: number } | null;
  /** Set on a TV that watches along with another: that TV's id. Such a TV has no phone of its own. */
  leaderId: string | null;
  /** The TVs watching along with this one, in the order they joined. */
  followerIds: string[];
  /** Last known playback, so a reconnecting phone can resync. */
  media: NormalizedMedia | null;
  state: PlayerState;
}

export interface Controller {
  id: string;
  deviceId: string | null;
}

export type JoinResult =
  | { ok: true; leader: Device; follower: Device }
  | { ok: false; reason: "NOT_PAIRED" | "PARTY_FULL" | "INVALID_CODE" };

export interface RegistryOptions {
  now?: () => number;
  generateCode?: () => string;
  codeTtlMs?: number;
}

const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;

/** Everything lives in memory. A server restart means fresh devices and fresh codes - by design for now. */
export class Registry {
  private readonly devices = new Map<string, Device>();
  private readonly controllers = new Map<string, Controller>();
  private readonly deviceByCode = new Map<string, string>();
  private readonly deviceByControlCode = new Map<string, string>();
  private readonly now: () => number;
  private readonly generateCode: () => string;
  private readonly codeTtlMs: number;

  constructor(options: RegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateCode = options.generateCode ?? generatePairingCode;
    this.codeTtlMs = options.codeTtlMs ?? PAIRING_CODE_TTL_MS;
  }

  /** A TV announces itself. Unknown or missing id -> brand new device with a fresh code. */
  tvHello(deviceId?: string): Device {
    const existing = deviceId ? this.devices.get(deviceId) : undefined;
    if (existing) return existing;
    const id = newId("tv");
    const device: Device = {
      id,
      publicId: randomBytes(6).toString("hex"),
      name: `TV ${id.slice(-4).toUpperCase()}`,
      code: null,
      controllerId: null,
      controllerIds: [],
      controlCode: null,
      leaderId: null,
      followerIds: [],
      media: null,
      state: IDLE_STATE,
    };
    this.devices.set(id, device);
    return device;
  }

  getDevice(id: string): Device | undefined {
    return this.devices.get(id);
  }

  /** Valid pairing code for an unpaired device (issuing a new one if missing/expired); null if paired. */
  ensureCode(device: Device): PairingCode | null {
    if (device.controllerId || device.leaderId) return null;
    if (!device.code || device.code.expiresAt <= this.now()) {
      if (device.code) this.deviceByCode.delete(device.code.value);
      let value = this.generateCode();
      for (let i = 0; this.deviceByCode.has(value) && i < 20; i++) value = this.generateCode();
      device.code = { value, expiresAt: this.now() + this.codeTtlMs };
      this.deviceByCode.set(value, device.id);
    }
    return { code: device.code.value, expiresInMs: Math.max(0, device.code.expiresAt - this.now()) };
  }

  /** A phone announces itself. Unknown or missing id -> new controller, unpaired. */
  controllerHello(controllerId?: string): Controller {
    const existing = controllerId ? this.controllers.get(controllerId) : undefined;
    if (existing) return existing;
    const controller: Controller = { id: newId("ctl"), deviceId: null };
    this.controllers.set(controller.id, controller);
    return controller;
  }

  /** A live code names a free TV, and using it burns the code. Null for a wrong or expired one. */
  private takeCode(code: string): Device | null {
    const deviceId = this.deviceByCode.get(code);
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    if (!device?.code || device.code.value !== code) return null;
    this.deviceByCode.delete(code);
    const expired = device.code.expiresAt <= this.now();
    device.code = null;
    return expired ? null : device;
  }

  /** Consume a pairing code and link controller <-> device. Returns the device, or null if the code is bad. */
  pair(controller: Controller, code: string): Device | null {
    const device = this.takeCode(code);
    if (!device) return null;
    device.controllerId = controller.id;
    if (!device.controllerIds.includes(controller.id)) device.controllerIds.push(controller.id);
    controller.deviceId = device.id;
    return device;
  }

  /** Valid control code for an active session (issuing a new one if missing/expired). */
  ensureControlCode(device: Device): PairingCode {
    const leader = this.leaderOf(device) ?? device;
    if (!leader.controlCode || leader.controlCode.expiresAt <= this.now()) {
      if (leader.controlCode) this.deviceByControlCode.delete(leader.controlCode.value);
      let value = this.generateCode();
      for (let i = 0; (this.deviceByCode.has(value) || this.deviceByControlCode.has(value)) && i < 20; i++) {
        value = this.generateCode();
      }
      leader.controlCode = { value, expiresAt: this.now() + this.codeTtlMs };
      this.deviceByControlCode.set(value, leader.id);
    }
    return { code: leader.controlCode.value, expiresInMs: Math.max(0, leader.controlCode.expiresAt - this.now()) };
  }

  /** An additional phone joins an active session via the control code. */
  joinController(controller: Controller, code: string): Device | null {
    const deviceId = this.deviceByControlCode.get(code);
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    if (!device?.controlCode || device.controlCode.value !== code) return null;
    if (device.controlCode.expiresAt <= this.now()) {
      this.deviceByControlCode.delete(code);
      device.controlCode = null;
      return null;
    }
    controller.deviceId = device.id;
    if (!device.controllerIds.includes(controller.id)) device.controllerIds.push(controller.id);
    if (!device.controllerId) device.controllerId = controller.id;
    return device;
  }

  controllersOf(device: Device): Controller[] {
    return device.controllerIds.flatMap((id) => this.controllers.get(id) ?? []);
  }

  /** The phone's TV gets company: another TV's code makes that TV watch along. */
  addFollower(controller: Controller, code: string): JoinResult {
    const leader = this.deviceForController(controller);
    if (!leader || leader.controllerId !== controller.id) return { ok: false, reason: "NOT_PAIRED" };
    if (leader.followerIds.length >= MAX_FOLLOWERS) return { ok: false, reason: "PARTY_FULL" };
    const follower = this.takeCode(code);
    if (!follower) return { ok: false, reason: "INVALID_CODE" };
    follower.leaderId = leader.id;
    leader.followerIds.push(follower.id);
    return { ok: true, leader, follower };
  }

  followersOf(leader: Device): Device[] {
    return leader.followerIds.flatMap((id) => this.devices.get(id) ?? []);
  }

  leaderOf(follower: Device): Device | undefined {
    return follower.leaderId ? this.devices.get(follower.leaderId) : undefined;
  }

  /** The phone sends one of the TVs watching along away (by the id the list gave it). */
  removeFollower(controller: Controller, publicId: string): { leader: Device; follower: Device } | null {
    const leader = this.deviceForController(controller);
    const follower = leader && this.followersOf(leader).find((candidate) => candidate.publicId === publicId);
    if (!leader || !follower) return null;
    this.detachFollower(follower);
    return { leader, follower };
  }

  /** A TV stops watching along: unpaired and idle again, and gone from its leader's party. */
  detachFollower(follower: Device): void {
    const leader = this.leaderOf(follower);
    if (leader) leader.followerIds = leader.followerIds.filter((id) => id !== follower.id);
    follower.leaderId = null;
    this.release(follower);
  }

  deviceForController(controller: Controller): Device | undefined {
    return controller.deviceId ? this.devices.get(controller.deviceId) : undefined;
  }

  /** The phone lets go of its TV. The TV is unpaired again (ensureCode issues it a fresh code) and idle. */
  unpair(controller: Controller): Device | null {
    const device = this.deviceForController(controller);
    controller.deviceId = null;
    if (!device) return null;
    device.controllerIds = device.controllerIds.filter((id) => id !== controller.id);
    if (device.controllerIds.length > 0) {
      if (device.controllerId === controller.id) {
        device.controllerId = device.controllerIds[0] ?? null;
      }
      return null;
    }
    return this.release(device);
  }

  /** The TV lets go of its phone (the same end state as `unpair`). Returns the phone that was paired, if any. */
  unpairDevice(device: Device): Controller | null {
    if (device.leaderId) {
      this.detachFollower(device);
      return null;
    }
    const controllers = this.controllersOf(device);
    for (const controller of controllers) controller.deviceId = null;
    const primary = device.controllerId ? this.controllers.get(device.controllerId) : undefined;
    this.release(device);
    return primary ?? null;
  }

  private release(device: Device): Device {
    // A TV that was being followed takes its followers down with it: they go back to their own pairing screens.
    for (const follower of this.followersOf(device)) {
      follower.leaderId = null;
      this.release(follower);
    }
    if (device.controlCode) {
      this.deviceByControlCode.delete(device.controlCode.value);
      device.controlCode = null;
    }
    device.followerIds = [];
    device.controllerId = null;
    device.controllerIds = [];
    device.code = null;
    device.media = null;
    device.state = IDLE_STATE;
    return device;
  }
}
