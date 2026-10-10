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
  /** What the screen asked to be called on the others' lists (the profile in use), instead of `name`. */
  label: string | null;
  /** On a TV hosting a watch party: the code the others join with. Valid for a while, asked for again when it runs out. */
  partyCode: { value: string; expiresAt: number } | null;
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
  | { ok: false; reason: "NOT_PAIRED" | "PARTY_FULL" | "INVALID_CODE" | "TV_HOSTING" };

/** A TV joining a party by its host's code. */
export type JoinPartyResult =
  | { ok: true; host: Device }
  | { ok: false; reason: "INVALID_CODE" | "PARTY_FULL" | "HOSTING" | "HAS_PHONE" | "ALREADY_IN_PARTY" };

/** What a screen can be called on a list: no control characters, one space between words, short. Empty means "no name of its own". */
export function cleanLabel(name: string): string | null {
  const label = name.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return label || null;
}

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
  private readonly deviceByPartyCode = new Map<string, string>();
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
      label: null,
      partyCode: null,
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

  /** A code no live one is using, so a code typed anywhere means one thing. */
  private freshCode(): string {
    const inUse = (value: string) => this.deviceByCode.has(value) || this.deviceByControlCode.has(value) || this.deviceByPartyCode.has(value);
    let value = this.generateCode();
    for (let i = 0; inUse(value) && i < 20; i++) value = this.generateCode();
    return value;
  }

  /** Valid pairing code for an unpaired device (issuing a new one if missing/expired); null if paired. */
  ensureCode(device: Device): PairingCode | null {
    if (device.controllerId || device.leaderId) return null;
    if (!device.code || device.code.expiresAt <= this.now()) {
      this.dropCode(device);
      const value = this.freshCode();
      device.code = { value, expiresAt: this.now() + this.codeTtlMs };
      this.deviceByCode.set(value, device.id);
    }
    return { code: device.code.value, expiresInMs: Math.max(0, device.code.expiresAt - this.now()) };
  }

  private dropCode(device: Device): void {
    if (device.code) this.deviceByCode.delete(device.code.value);
    device.code = null;
  }

  /** A phone announces itself. Unknown or missing id -> new controller, unpaired. */
  controllerHello(controllerId?: string): Controller {
    const existing = controllerId ? this.controllers.get(controllerId) : undefined;
    if (existing) return existing;
    const controller: Controller = { id: newId("ctl"), deviceId: null };
    this.controllers.set(controller.id, controller);
    return controller;
  }

  /** The free TV a code was given to, as long as that is still its code (it may have run out). */
  private holderOf(code: string): Device | null {
    const deviceId = this.deviceByCode.get(code);
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    return device?.code?.value === code ? device : null;
  }

  /** A live code names a free TV, and using it burns the code. Null for a wrong or expired one. */
  private takeCode(code: string): Device | null {
    const device = this.holderOf(code);
    if (!device?.code) return null;
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

  /** Valid control code for an active session (issuing a new one if missing/expired). Asking for it is what keeps it good: a phone shows it while someone scans it. */
  ensureControlCode(device: Device): PairingCode {
    const leader = this.leaderOf(device) ?? device;
    if (!leader.controlCode || leader.controlCode.expiresAt <= this.now()) {
      if (leader.controlCode) this.deviceByControlCode.delete(leader.controlCode.value);
      const value = this.freshCode();
      leader.controlCode = { value, expiresAt: this.now() + this.codeTtlMs };
      this.deviceByControlCode.set(value, leader.id);
    } else {
      leader.controlCode.expiresAt = this.now() + this.codeTtlMs;
    }
    return { code: leader.controlCode.value, expiresInMs: this.codeTtlMs };
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
    if (!leader || !leader.controllerIds.includes(controller.id)) return { ok: false, reason: "NOT_PAIRED" };
    if (leader.followerIds.length >= MAX_FOLLOWERS) return { ok: false, reason: "PARTY_FULL" };
    // A TV with guests of its own would make a party inside a party: it ends that first, and its code is left as it was for then.
    if ((this.holderOf(code)?.followerIds.length ?? 0) > 0) return { ok: false, reason: "TV_HOSTING" };
    const follower = this.takeCode(code);
    if (!follower) return { ok: false, reason: "INVALID_CODE" };
    this.makeGuest(follower, leader);
    return { ok: true, leader, follower };
  }

  /** `guest` watches along with `host` from now on, leaving behind what it had of its own: a pairing code, a party nobody came to, what it was playing. */
  private makeGuest(guest: Device, host: Device): void {
    this.dropCode(guest);
    this.dropPartyCode(guest);
    guest.leaderId = host.id;
    host.followerIds.push(guest.id);
    guest.media = null;
    guest.state = IDLE_STATE;
  }

  followersOf(leader: Device): Device[] {
    return leader.followerIds.flatMap((id) => this.devices.get(id) ?? []);
  }

  leaderOf(follower: Device): Device | undefined {
    return follower.leaderId ? this.devices.get(follower.leaderId) : undefined;
  }

  /* ------------------------------ watch party ------------------------------ */

  /** What a screen is called on the lists: the name it asked for, else its own. */
  displayName(device: Device): string {
    return device.label ?? device.name;
  }

  setLabel(device: Device, name: string): void {
    device.label = cleanLabel(name);
  }

  /** Whether a TV is part of a party: it hosts one (guests or a code open) or watches along with one. */
  inParty(device: Device): boolean {
    return device.leaderId !== null || device.followerIds.length > 0 || this.partyCodeOf(device) !== null;
  }

  /** The code others join this TV's party with, if one is open now. */
  partyCodeOf(host: Device): PairingCode | null {
    const open = host.partyCode;
    const left = open ? open.expiresAt - this.now() : 0;
    return open && left > 0 ? { code: open.value, expiresInMs: left } : null;
  }

  /** The code others join this TV's party with (a new one if none is open): having one is what makes a TV a host. Null for a TV that is itself a guest. */
  ensurePartyCode(host: Device): PairingCode | null {
    if (host.leaderId) return null;
    const open = this.partyCodeOf(host);
    if (open) return open;
    this.dropPartyCode(host);
    const value = this.freshCode();
    host.partyCode = { value, expiresAt: this.now() + this.codeTtlMs };
    this.deviceByPartyCode.set(value, host.id);
    return { code: value, expiresInMs: this.codeTtlMs };
  }

  private dropPartyCode(host: Device): void {
    if (host.partyCode) this.deviceByPartyCode.delete(host.partyCode.value);
    host.partyCode = null;
  }

  /**
   * A TV joins the party a code belongs to and from then on watches along with its host. Only a TV that is on its own can: one
   * with a phone connected, or one that hosts others, has to let go of that first.
   */
  joinParty(guest: Device, code: string): JoinPartyResult {
    const hostId = this.deviceByPartyCode.get(code);
    const host = hostId ? this.devices.get(hostId) : undefined;
    if (!host || host.id === guest.id || host.partyCode?.value !== code) return { ok: false, reason: "INVALID_CODE" };
    if (!this.partyCodeOf(host)) {
      this.dropPartyCode(host);
      return { ok: false, reason: "INVALID_CODE" };
    }
    if (guest.leaderId === host.id) return { ok: true, host };
    if (guest.leaderId) return { ok: false, reason: "ALREADY_IN_PARTY" };
    if (guest.followerIds.length > 0) return { ok: false, reason: "HOSTING" };
    if (guest.controllerIds.length > 0) return { ok: false, reason: "HAS_PHONE" };
    if (host.followerIds.length >= MAX_FOLLOWERS) return { ok: false, reason: "PARTY_FULL" };
    this.makeGuest(guest, host);
    return { ok: true, host };
  }

  /** The host sends one guest away (by the id the lists give it): that TV is on its own again. */
  removeGuest(host: Device, publicId: string): Device | null {
    const guest = this.followersOf(host).find((candidate) => candidate.publicId === publicId);
    if (!guest) return null;
    this.detachFollower(guest);
    return guest;
  }

  /** The host ends its party: the code stops working and every guest is on its own again. Returns the guests that were in it. */
  closeParty(host: Device): Device[] {
    const guests = this.followersOf(host);
    for (const guest of guests) this.detachFollower(guest);
    this.dropPartyCode(host);
    return guests;
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
    this.dropPartyCode(device);
    this.dropCode(device);
    device.followerIds = [];
    device.controllerId = null;
    device.controllerIds = [];
    device.media = null;
    device.state = IDLE_STATE;
    return device;
  }
}
