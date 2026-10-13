import { randomBytes, randomInt } from "node:crypto";
import {
  IDLE_STATE,
  MAX_FOLLOWERS,
  MAX_PHONE_TVS,
  PAIRING_CODE_TTL_MS,
  reachedEnd,
  type NormalizedMedia,
  type PairingCode,
  type PlayerState,
  type PlayHint,
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
  /** What this TV was last playing and how far it got, to be put back when its page is opened again. Only a TV with a phone or a party has one that outlives a restart. */
  resume: Resume | null;
}

/** What it takes to put a TV back where it was: the link that plays it again, with the picture its card had, and the place reached. */
export interface Resume {
  url: string;
  hint: PlayHint | undefined;
  /** Where it is now, and where it was when last handed to `records` (a few seconds more or less is not worth a write). */
  time: number;
  saved: number;
  /** The day (days since 1970) the place was last written down. */
  day: number;
  /** Just put back at `time`: until then, what the picture reports before it has got there is not taken for where it is. */
  holdUntil: number;
}

/** The part of a `Resume` that a restart keeps. */
export interface ResumeRecord {
  url: string;
  hint?: PlayHint;
  time: number;
  day: number;
}

export interface Controller {
  id: string;
  /** The TV this phone is controlling now. */
  deviceId: string | null;
  /**
   * Every TV this phone has connected to and has not let go of, in the order it did (`deviceId` is one of them). A phone moving on to
   * another TV leaves the first one as it was: paired, playing, and on this list, so the phone can come back to it without a code.
   * Only the phone (forgetting it) or the TV (disconnecting) takes a TV off.
   */
  deviceIds: string[];
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

/** What a TV is called until someone names it. */
const defaultName = (id: string) => `TV ${id.slice(-4).toUpperCase()}`;

export interface RegistryOptions {
  now?: () => number;
  generateCode?: () => string;
  codeTtlMs?: number;
}

/** What is remembered of a TV that has a phone or a party: who it goes with, not what it is doing. */
export interface DeviceRecord {
  id: string;
  publicId: string;
  name: string;
  label: string | null;
  controllerId: string | null;
  controllerIds: string[];
  leaderId: string | null;
  followerIds: string[];
  /** The last day (days since 1970) the TV, or a phone of it, said anything. */
  seenDay: number;
  /** What it was playing when it was last heard from. */
  resume?: ResumeRecord;
}

/** A phone that has a TV. */
export interface ControllerRecord {
  id: string;
  /** The TV it was controlling; none when it had moved on from all of them (it still has them on its list). */
  deviceId: string | null;
  /** Its list of TVs. A record written before there was a list has none: the list is then the one TV it had. */
  deviceIds?: string[];
  seenDay: number;
}

export interface Records {
  devices: DeviceRecord[];
  controllers: ControllerRecord[];
}

const DAY_MS = 24 * 3600 * 1000;
/**
 * A phone and its TV stay together until one of them lets go. Only a pair that nobody has used for more than a year (a TV in a
 * drawer, a phone that was replaced) is cleared out when the server starts, so the database does not fill with ghosts.
 */
export const KEEP_PAIRINGS_DAYS = 400;
/** What a TV was playing is put back when its page is opened again, unless that was longer ago than this. */
export const KEEP_RESUME_DAYS = 30;
/** The place a TV reached is written down again when it has moved this far (and when the TV goes away). */
const SAVE_EVERY_S = 30;
/** A picture that has just been put back at a place is given this long to get there before its reports count again. */
const HOLD_MS = 45_000;
const HOLD_SLACK_S = 5;

const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;

/**
 * Who is paired with whom, and the codes that are good right now. Codes and what is playing live in memory only; the pairs
 * themselves are handed out by `records` and taken back by `restore`, so a restart of the server (a free host sleeps and
 * wakes) does not make every phone and TV forget each other.
 */
export class Registry {
  private readonly devices = new Map<string, Device>();
  private readonly controllers = new Map<string, Controller>();
  private readonly deviceByCode = new Map<string, string>();
  private readonly deviceByControlCode = new Map<string, string>();
  private readonly deviceByPartyCode = new Map<string, string>();
  private readonly seenDays = new Map<string, number>();
  private readonly now: () => number;
  private readonly generateCode: () => string;
  private readonly codeTtlMs: number;

  /** Called when something a restart should remember has changed: a pair, a party, a name, a day it was last heard from. */
  onChange: (() => void) | undefined;

  constructor(options: RegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateCode = options.generateCode ?? generatePairingCode;
    this.codeTtlMs = options.codeTtlMs ?? PAIRING_CODE_TTL_MS;
  }

  private today(): number {
    return Math.floor(this.now() / DAY_MS);
  }

  /** A TV or phone was heard from. Only the day counts, so a device that is always on is written once a day, not at every ping. */
  markSeen(id: string): void {
    const day = this.today();
    if (this.seenDays.get(id) === day) return;
    this.seenDays.set(id, day);
    this.onChange?.();
  }

  /** The pairs worth keeping: a TV with a phone or a party, and the phones that have a TV. Free TVs, codes and what is playing are not. */
  records(): Records {
    const today = this.today();
    const devices = [...this.devices.values()]
      .filter((device) => device.controllerIds.length > 0 || device.leaderId !== null || device.followerIds.length > 0)
      .map((device) => ({
        id: device.id,
        publicId: device.publicId,
        name: device.name,
        label: device.label,
        controllerId: device.controllerId,
        controllerIds: [...device.controllerIds],
        leaderId: device.leaderId,
        followerIds: [...device.followerIds],
        seenDay: this.seenDays.get(device.id) ?? today,
        ...(device.resume ? { resume: resumeRecord(device.resume) } : {}),
      }));
    const controllers = [...this.controllers.values()].flatMap((controller) =>
      controller.deviceIds.length > 0
        ? [{ id: controller.id, deviceId: controller.deviceId, deviceIds: [...controller.deviceIds], seenDay: this.seenDays.get(controller.id) ?? today }]
        : [],
    );
    return { devices, controllers };
  }

  /** Take back what `records` gave before a restart. What is too old is dropped, and so is anything that points at something no longer there. */
  restore({ devices, controllers }: Records): void {
    const horizon = this.today() - KEEP_PAIRINGS_DAYS;
    const resumeHorizon = this.today() - KEEP_RESUME_DAYS;
    for (const record of devices) {
      if (record.seenDay < horizon || this.devices.has(record.id)) continue;
      const { seenDay, resume, ...kept } = record;
      this.devices.set(record.id, {
        ...kept,
        controllerIds: [...kept.controllerIds],
        followerIds: [...kept.followerIds],
        partyCode: null,
        code: null,
        controlCode: null,
        media: null,
        state: IDLE_STATE,
        resume: resume && resume.day >= resumeHorizon ? { url: resume.url, hint: resume.hint, time: resume.time, saved: resume.time, day: resume.day, holdUntil: 0 } : null,
      });
      this.seenDays.set(record.id, seenDay);
    }
    for (const record of controllers) {
      if (record.seenDay < horizon || this.controllers.has(record.id)) continue;
      const listed = record.deviceIds ?? (record.deviceId ? [record.deviceId] : []);
      this.controllers.set(record.id, { id: record.id, deviceId: record.deviceId, deviceIds: [...new Set(listed)].slice(0, MAX_PHONE_TVS) });
      this.seenDays.set(record.id, record.seenDay);
    }
    // A phone and its TVs have to agree, and so do a host and its guests: what only one side remembers is let go.
    for (const controller of this.controllers.values()) {
      controller.deviceIds = controller.deviceIds.filter((id) => this.devices.get(id)?.controllerIds.includes(controller.id));
      if (controller.deviceId && !controller.deviceIds.includes(controller.deviceId)) controller.deviceId = null;
    }
    for (const device of this.devices.values()) {
      device.controllerIds = device.controllerIds.filter((id) => this.controllers.get(id)?.deviceIds.includes(device.id));
      if (!device.controllerId || !device.controllerIds.includes(device.controllerId)) device.controllerId = device.controllerIds[0] ?? null;
      const host = device.leaderId ? this.devices.get(device.leaderId) : undefined;
      if (!host?.followerIds.includes(device.id)) device.leaderId = null;
    }
    for (const device of this.devices.values()) device.followerIds = device.followerIds.filter((id) => this.devices.get(id)?.leaderId === device.id);
  }

  /** A TV announces itself. Unknown or missing id -> brand new device with a fresh code. */
  tvHello(deviceId?: string): Device {
    const existing = deviceId ? this.devices.get(deviceId) : undefined;
    if (existing) {
      this.markSeen(existing.id);
      return existing;
    }
    const id = newId("tv");
    const device: Device = {
      id,
      publicId: randomBytes(6).toString("hex"),
      name: defaultName(id),
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
      resume: null,
    };
    this.devices.set(id, device);
    this.markSeen(id);
    return device;
  }

  /* ------------------------------ what was playing ------------------------------ */

  /**
   * A video is put on a TV, from `at` seconds in. It is remembered in place of whatever was remembered before, if there is a link
   * that plays it again (the phone is never what the TV fetches from, so a video without one cannot be looked up on another day).
   * `putBack`: this is the TV being returned to where it was, so the reports of a picture still on its way there do not count.
   */
  startedPlaying(device: Device, media: NormalizedMedia, at = 0, putBack = false): void {
    const before = device.resume;
    const time = Math.floor(at);
    device.resume = media.page
      ? { url: media.page, hint: hintOf(media), time, saved: time, day: this.today(), holdUntil: putBack && time > 0 ? this.now() + HOLD_MS : 0 }
      : null;
    if (before || device.resume) this.onChange?.();
  }

  /**
   * The TV says how far it has got. Memory follows every report; what a restart keeps follows when the place has moved a while
   * (or the TV goes away: see `checkpoint`). A video that has played to its end is not put back.
   */
  noteProgress(device: Device, state: PlayerState): void {
    const media = device.media;
    if (!media?.page || (state.state !== "playing" && state.state !== "paused")) return;
    if (state.ended || reachedEnd(state)) return this.forgetResume(device);
    // A server that restarted while this was playing hears about it here, from the report that follows the TV's hello.
    if (device.resume?.url !== media.page) this.startedPlaying(device, media, state.currentTime);
    const resume = device.resume;
    if (!resume) return;
    if (resume.holdUntil > this.now()) {
      if (state.currentTime < resume.time - HOLD_SLACK_S) return; // not there yet: the picture reports the start before it has found its place
      resume.holdUntil = 0;
    }
    resume.time = state.currentTime;
    if (Math.abs(resume.time - resume.saved) < SAVE_EVERY_S) return;
    resume.saved = resume.time;
    resume.day = this.today();
    this.onChange?.();
  }

  /** The TV went away (its page was closed, its power cut): the place it had reached is written down exactly, not as it was up to half a minute before. */
  checkpoint(device: Device): void {
    const resume = device.resume;
    if (!resume || resume.saved === resume.time) return;
    resume.saved = resume.time;
    resume.day = this.today();
    this.onChange?.();
  }

  /** The TV was stopped, or got to the end, or lost its phone: there is nothing to put back. */
  forgetResume(device: Device): void {
    if (!device.resume) return;
    device.resume = null;
    this.onChange?.();
  }

  /**
   * What to put on a TV whose page has just been opened: what it was playing, from where. Nothing for a TV without a phone or a
   * party (it was on its own, and its own Continue watching has the place), for one that watches along (the host decides), or when
   * it was long ago.
   */
  resumeOf(device: Device): { url: string; hint: PlayHint | undefined; time: number } | undefined {
    const resume = device.resume;
    if (!resume || device.leaderId || (device.controllerIds.length === 0 && device.followerIds.length === 0)) return undefined;
    if (this.today() - resume.day > KEEP_RESUME_DAYS) return undefined;
    return { url: resume.url, hint: resume.hint, time: Math.floor(resume.time) };
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
    if (existing) {
      this.markSeen(existing.id);
      return existing;
    }
    const controller: Controller = { id: newId("ctl"), deviceId: null, deviceIds: [] };
    this.controllers.set(controller.id, controller);
    this.markSeen(controller.id);
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

  /** The phone's list has no room for a TV it is not already on (see `MAX_PHONE_TVS`). */
  isFull(controller: Controller): boolean {
    return controller.deviceIds.length >= MAX_PHONE_TVS;
  }

  /** The phone is a remote of `device` and controls it from now on. A TV it controlled before is left as it was, on the phone's list. */
  private connect(controller: Controller, device: Device): void {
    if (!device.controllerId) device.controllerId = controller.id;
    if (!device.controllerIds.includes(controller.id)) device.controllerIds.push(controller.id);
    if (!controller.deviceIds.includes(device.id)) controller.deviceIds.push(device.id);
    controller.deviceId = device.id;
    this.onChange?.();
  }

  /** Consume a pairing code and link controller <-> device. Returns the device, or null if the code is bad. */
  pair(controller: Controller, code: string): Device | null {
    const device = this.takeCode(code);
    if (!device) return null;
    this.connect(controller, device);
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
    this.connect(controller, device);
    return device;
  }

  /** Every phone that is a remote of this TV, the ones that have moved on to another TV included. */
  phonesOf(device: Device): Controller[] {
    return device.controllerIds.flatMap((id) => this.controllers.get(id) ?? []);
  }

  /** The phones that are controlling this TV now: the ones that hear what it is doing. */
  controllersOf(device: Device): Controller[] {
    return this.phonesOf(device).filter((controller) => controller.deviceId === device.id);
  }

  /** The TVs a phone has connected to, in the order it did. */
  tvsOf(controller: Controller): Device[] {
    return controller.deviceIds.flatMap((id) => this.devices.get(id) ?? []);
  }

  /** The phone controls another TV of its list (by the id the list gave it). Null when that TV is not on the list. */
  switchTo(controller: Controller, publicId: string): Device | null {
    const device = this.tvsOf(controller).find((candidate) => candidate.publicId === publicId);
    if (!device) return null;
    if (controller.deviceId !== device.id) {
      controller.deviceId = device.id;
      this.onChange?.();
    }
    return device;
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
    guest.resume = null;
    this.onChange?.();
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
    this.onChange?.();
  }

  /** A phone names the TV it controls, cleaned up like any name on a list. Nothing, or only blanks, gives the TV its own name back. */
  rename(device: Device, name: string): void {
    device.name = cleanLabel(name) ?? defaultName(device.id);
    this.onChange?.();
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

  /** The TV a party is open with this code on now, if there is one. */
  hostOfPartyCode(code: string): Device | undefined {
    const hostId = this.deviceByPartyCode.get(code);
    const host = hostId ? this.devices.get(hostId) : undefined;
    return host && host.partyCode?.value === code && this.partyCodeOf(host) ? host : undefined;
  }

  /** Whether a code is one a party is open with now: what a phone is told when it types such a code where a TV's pairing code goes. */
  isPartyCode(code: string): boolean {
    return this.hostOfPartyCode(code) !== undefined;
  }

  /** A TV by the id the lists (and the invitations of friends) know it by. */
  deviceByPublicId(publicId: string): Device | undefined {
    for (const device of this.devices.values()) if (device.publicId === publicId) return device;
    return undefined;
  }

  /**
   * The code to join the party of a TV with, for a friend who was invited to it: the one open now or, for a party that has guests in it
   * but whose code ran out (a code stays good only while the host's screen shows it), a new one. Null when the party is over: nobody in
   * it and no code open (or the TV is a guest itself).
   */
  runningParty(host: Device): PairingCode | null {
    return host.followerIds.length > 0 || this.partyCodeOf(host) ? this.ensurePartyCode(host) : null;
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

  /**
   * The phone lets go of a TV: the one it controls, or one on its list (by the id the list gave it). That TV forgets the phone. A TV
   * left with no phone at all is unpaired again (ensureCode issues it a fresh code) and idle, and is the one returned.
   */
  unpair(controller: Controller, publicId?: string): Device | null {
    const device = publicId === undefined ? this.deviceForController(controller) : this.tvsOf(controller).find((candidate) => candidate.publicId === publicId);
    if (!device) {
      if (publicId === undefined) controller.deviceId = null;
      this.onChange?.();
      return null;
    }
    controller.deviceIds = controller.deviceIds.filter((id) => id !== device.id);
    if (controller.deviceId === device.id) controller.deviceId = null;
    this.onChange?.();
    device.controllerIds = device.controllerIds.filter((id) => id !== controller.id);
    if (device.controllerIds.length > 0) {
      if (device.controllerId === controller.id) {
        device.controllerId = device.controllerIds[0] ?? null;
      }
      return null;
    }
    return this.release(device);
  }

  /** The TV lets go of its phones, the ones that have moved on to another TV included (the same end state as `unpair`). Returns the phone that was paired, if any. */
  unpairDevice(device: Device): Controller | null {
    if (device.leaderId) {
      this.detachFollower(device);
      return null;
    }
    const primary = device.controllerId ? this.controllers.get(device.controllerId) : undefined;
    this.release(device);
    return primary ?? null;
  }

  private release(device: Device): Device {
    for (const phone of this.phonesOf(device)) {
      phone.deviceIds = phone.deviceIds.filter((id) => id !== device.id);
      if (phone.deviceId === device.id) phone.deviceId = null;
    }
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
    device.resume = null;
    this.onChange?.();
    return device;
  }
}

const resumeRecord = ({ url, hint, saved, day }: Resume): ResumeRecord => ({ url, ...(hint ? { hint } : {}), time: Math.min(86_400, Math.floor(saved)), day });

/** The picture and year of a video, as a screen would have asked for it. */
function hintOf({ poster, backdrop, year }: NormalizedMedia): PlayHint | undefined {
  if (!poster && !backdrop && !year) return undefined;
  return { ...(poster ? { poster } : {}), ...(backdrop ? { backdrop } : {}), ...(year ? { year } : {}) };
}
