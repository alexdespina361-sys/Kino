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
  publicId: string;
  name: string;
  label: string | null;
  profileId: string | null;
  partyCode: { value: string; expiresAt: number } | null;
  partyId: string | null;
  barred: Set<string>;
  code: { value: string; expiresAt: number } | null;
  controllerId: string | null;
  controllerIds: string[];
  controlCode: { value: string; expiresAt: number } | null;
  leaderId: string | null;
  followerIds: string[];
  admin: boolean;
  media: NormalizedMedia | null;
  state: PlayerState;
  resume: Resume | null;
}

export interface Resume {
  url: string;
  hint: PlayHint | undefined;
  time: number;
  saved: number;
  day: number;
  holdUntil: number;
}

export interface ResumeRecord {
  url: string;
  hint?: PlayHint;
  time: number;
  day: number;
}

export interface Controller {
  id: string;
  deviceId: string | null;
  deviceIds: string[];
}

export type JoinResult =
  | { ok: true; leader: Device; follower: Device }
  | { ok: false; reason: "NOT_PAIRED" | "PARTY_FULL" | "INVALID_CODE" | "TV_HOSTING" };

export type JoinPartyResult =
  | { ok: true; host: Device }
  | { ok: false; reason: "INVALID_CODE" | "PARTY_FULL" | "HOSTING" | "HAS_PHONE" | "ALREADY_IN_PARTY" };

export function cleanLabel(name: string): string | null {
  const label = name.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return label || null;
}

const defaultName = (id: string) => `TV ${id.slice(-4).toUpperCase()}`;

export interface RegistryOptions {
  now?: () => number;
  generateCode?: () => string;
  codeTtlMs?: number;
}

export interface DeviceRecord {
  id: string;
  publicId: string;
  name: string;
  label: string | null;
  controllerId: string | null;
  controllerIds: string[];
  leaderId: string | null;
  followerIds: string[];
  admin?: boolean;
  seenDay: number;
  resume?: ResumeRecord;
}

export interface ControllerRecord {
  id: string;
  deviceId: string | null;
  deviceIds?: string[];
  seenDay: number;
}

export interface Records {
  devices: DeviceRecord[];
  controllers: ControllerRecord[];
}

const DAY_MS = 24 * 3600 * 1000;
export const KEEP_PAIRINGS_DAYS = 400;
export const KEEP_RESUME_DAYS = 30;
export const MAX_PHONES_PER_TV = 32;
const SAVE_EVERY_S = 30;
const HOLD_MS = 45_000;
const HOLD_SLACK_S = 5;

const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;

const isPaired = (device: Device): boolean => device.controllerIds.length > 0 || device.leaderId !== null || device.followerIds.length > 0;

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

  onChange: (() => void) | undefined;

  constructor(options: RegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateCode = options.generateCode ?? generatePairingCode;
    this.codeTtlMs = options.codeTtlMs ?? PAIRING_CODE_TTL_MS;
  }

  private today(): number {
    return Math.floor(this.now() / DAY_MS);
  }

  markSeen(id: string): void {
    if (!this.devices.has(id) && !this.controllers.has(id)) return;
    const day = this.today();
    if (this.seenDays.get(id) === day) return;
    this.seenDays.set(id, day);
    this.onChange?.();
  }

  records(): Records {
    const today = this.today();
    const devices = [...this.devices.values()]
      .filter(isPaired)
      .map((device) => ({
        id: device.id,
        publicId: device.publicId,
        name: device.name,
        label: device.label,
        controllerId: device.controllerId,
        controllerIds: [...device.controllerIds],
        leaderId: device.leaderId,
        followerIds: [...device.followerIds],
        ...(device.admin ? { admin: true } : {}),
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
        admin: kept.admin === true,
        profileId: null,
        partyCode: null,
        partyId: null,
        barred: new Set(),
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
    for (const controller of this.controllers.values()) {
      controller.deviceIds = controller.deviceIds.filter((id) => this.devices.get(id)?.controllerIds.includes(controller.id));
      if (controller.deviceId && !controller.deviceIds.includes(controller.deviceId)) controller.deviceId = null;
    }
    for (const device of this.devices.values()) {
      device.controllerIds = device.controllerIds.filter((id) => this.controllers.get(id)?.deviceIds.includes(device.id));
      if (!device.controllerId || !device.controllerIds.includes(device.controllerId)) device.controllerId = device.controllerIds[0] ?? null;
      const host = device.leaderId ? this.devices.get(device.leaderId) : undefined;
      if (!host?.followerIds.includes(device.id)) device.leaderId = null;
      if (!device.leaderId) device.admin = false;
    }
    for (const device of this.devices.values()) device.followerIds = device.followerIds.filter((id) => this.devices.get(id)?.leaderId === device.id);
  }

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
      profileId: null,
      partyCode: null,
      partyId: null,
      barred: new Set(),
      code: null,
      controllerId: null,
      controllerIds: [],
      controlCode: null,
      leaderId: null,
      followerIds: [],
      admin: false,
      media: null,
      state: IDLE_STATE,
      resume: null,
    };
    this.devices.set(id, device);
    this.markSeen(id);
    return device;
  }

  startedPlaying(device: Device, media: NormalizedMedia, at = 0, putBack = false): void {
    const before = device.resume;
    const time = Math.floor(at);
    device.resume = media.page
      ? { url: media.page, hint: hintOf(media), time, saved: time, day: this.today(), holdUntil: putBack && time > 0 ? this.now() + HOLD_MS : 0 }
      : null;
    if (before || device.resume) this.onChange?.();
  }

  noteProgress(device: Device, state: PlayerState): void {
    const media = device.media;
    if (!media?.page || (state.state !== "playing" && state.state !== "paused")) return;
    if (state.ended || reachedEnd(state)) return this.forgetResume(device);
    if (device.resume?.url !== media.page) this.startedPlaying(device, media, state.currentTime);
    const resume = device.resume;
    if (!resume) return;
    if (resume.holdUntil > this.now()) {
      if (state.currentTime < resume.time - HOLD_SLACK_S) return;
      resume.holdUntil = 0;
    }
    resume.time = state.currentTime;
    if (Math.abs(resume.time - resume.saved) < SAVE_EVERY_S) return;
    resume.saved = resume.time;
    resume.day = this.today();
    this.onChange?.();
  }

  checkpoint(device: Device): void {
    const resume = device.resume;
    if (!resume || resume.saved === resume.time) return;
    resume.saved = resume.time;
    resume.day = this.today();
    this.onChange?.();
  }

  forgetResume(device: Device): void {
    if (!device.resume) return;
    device.resume = null;
    this.onChange?.();
  }

  resumeOf(device: Device): { url: string; hint: PlayHint | undefined; time: number } | undefined {
    const resume = device.resume;
    if (!resume || device.leaderId || (device.controllerIds.length === 0 && device.followerIds.length === 0)) return undefined;
    if (this.today() - resume.day > KEEP_RESUME_DAYS) return undefined;
    return { url: resume.url, hint: resume.hint, time: Math.floor(resume.time) };
  }

  getDevice(id: string): Device | undefined {
    return this.devices.get(id);
  }

  private freshCode(): string {
    const inUse = (value: string) => this.deviceByCode.has(value) || this.deviceByControlCode.has(value) || this.deviceByPartyCode.has(value);
    let value = this.generateCode();
    for (let i = 0; inUse(value) && i < 20; i++) value = this.generateCode();
    return value;
  }

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

  getController(id: string): Controller | undefined {
    return this.controllers.get(id);
  }

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

  freeTvs(): string[] {
    return [...this.devices.values()].filter((device) => !isPaired(device)).map((device) => device.id);
  }

  freePhones(): string[] {
    return [...this.controllers.values()].filter((controller) => controller.deviceIds.length === 0).map((controller) => controller.id);
  }

  forgetFree(id: string): boolean {
    const device = this.devices.get(id);
    if (device) {
      if (isPaired(device)) return false;
      this.dropCode(device);
      this.dropPartyCode(device);
      if (device.controlCode) this.deviceByControlCode.delete(device.controlCode.value);
      this.devices.delete(id);
    } else {
      const controller = this.controllers.get(id);
      if (!controller || controller.deviceIds.length > 0) return false;
      this.controllers.delete(id);
    }
    this.seenDays.delete(id);
    return true;
  }

  private holderOf(code: string): Device | null {
    const deviceId = this.deviceByCode.get(code);
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    return device?.code?.value === code ? device : null;
  }

  private takeCode(code: string): Device | null {
    const device = this.holderOf(code);
    if (!device?.code) return null;
    this.deviceByCode.delete(code);
    const expired = device.code.expiresAt <= this.now();
    device.code = null;
    return expired ? null : device;
  }

  isFull(controller: Controller): boolean {
    return controller.deviceIds.length >= MAX_PHONE_TVS;
  }

  private connect(controller: Controller, device: Device): void {
    if (!device.controllerId) device.controllerId = controller.id;
    if (!device.controllerIds.includes(controller.id)) device.controllerIds.push(controller.id);
    if (!controller.deviceIds.includes(device.id)) controller.deviceIds.push(device.id);
    controller.deviceId = device.id;
    this.onChange?.();
  }

  pair(controller: Controller, code: string): Device | null {
    const device = this.takeCode(code);
    if (!device) return null;
    this.connect(controller, device);
    return device;
  }

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

  joinController(controller: Controller, code: string, connected: (controllerId: string) => boolean = () => true): Device | null {
    const deviceId = this.deviceByControlCode.get(code);
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    if (!device?.controlCode || device.controlCode.value !== code) return null;
    if (device.controlCode.expiresAt <= this.now()) {
      this.deviceByControlCode.delete(code);
      device.controlCode = null;
      return null;
    }
    if (this.hasNoRoomFor(device, controller)) this.makeRoom(device, connected);
    if (this.hasNoRoomFor(device, controller)) return null;
    this.connect(controller, device);
    return device;
  }

  private makeRoom(device: Device, connected: (controllerId: string) => boolean): void {
    const away = this.phonesOf(device).filter((phone) => !connected(phone.id));
    const [gone] = away.sort((a, b) => (this.seenDays.get(a.id) ?? 0) - (this.seenDays.get(b.id) ?? 0));
    if (gone) this.unpair(gone, device.publicId);
  }

  isFullControlCode(controller: Controller, code: string): boolean {
    const deviceId = this.deviceByControlCode.get(code);
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    return device?.controlCode?.value === code && device.controlCode.expiresAt > this.now() && this.hasNoRoomFor(device, controller);
  }

  private hasNoRoomFor(device: Device, controller: Controller): boolean {
    return device.controllerIds.length >= MAX_PHONES_PER_TV && !device.controllerIds.includes(controller.id);
  }

  phonesOf(device: Device): Controller[] {
    return device.controllerIds.flatMap((id) => this.controllers.get(id) ?? []);
  }

  controllersOf(device: Device): Controller[] {
    return this.phonesOf(device).filter((controller) => controller.deviceId === device.id);
  }

  tvsOf(controller: Controller): Device[] {
    return controller.deviceIds.flatMap((id) => this.devices.get(id) ?? []);
  }

  switchTo(controller: Controller, publicId: string): Device | null {
    const device = this.tvsOf(controller).find((candidate) => candidate.publicId === publicId);
    if (!device) return null;
    if (controller.deviceId !== device.id) {
      controller.deviceId = device.id;
      this.onChange?.();
    }
    return device;
  }

  addFollower(controller: Controller, code: string): JoinResult {
    const leader = this.deviceForController(controller);
    if (!leader || !leader.controllerIds.includes(controller.id)) return { ok: false, reason: "NOT_PAIRED" };
    if (leader.followerIds.length >= MAX_FOLLOWERS) return { ok: false, reason: "PARTY_FULL" };
    if ((this.holderOf(code)?.followerIds.length ?? 0) > 0) return { ok: false, reason: "TV_HOSTING" };
    const follower = this.takeCode(code);
    if (!follower) return { ok: false, reason: "INVALID_CODE" };
    this.makeGuest(follower, leader);
    return { ok: true, leader, follower };
  }

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

  displayName(device: Device): string {
    return device.label ?? device.name;
  }

  setLabel(device: Device, name: string): void {
    device.label = cleanLabel(name);
    this.onChange?.();
  }

  setProfile(device: Device, profileId: string | null): void {
    device.profileId = profileId;
  }

  rename(device: Device, name: string): void {
    device.name = cleanLabel(name) ?? defaultName(device.id);
    this.onChange?.();
  }

  inParty(device: Device): boolean {
    return device.leaderId !== null || device.followerIds.length > 0 || this.partyCodeOf(device) !== null;
  }

  partyCodeOf(host: Device): PairingCode | null {
    const open = host.partyCode;
    const left = open ? open.expiresAt - this.now() : 0;
    return open && left > 0 ? { code: open.value, expiresInMs: left } : null;
  }

  hostOfPartyCode(code: string): Device | undefined {
    const hostId = this.deviceByPartyCode.get(code);
    const host = hostId ? this.devices.get(hostId) : undefined;
    return host && host.partyCode?.value === code && this.partyCodeOf(host) ? host : undefined;
  }

  isPartyCode(code: string): boolean {
    return this.hostOfPartyCode(code) !== undefined;
  }

  deviceByPublicId(publicId: string): Device | undefined {
    for (const device of this.devices.values()) if (device.publicId === publicId) return device;
    return undefined;
  }

  runningParty(host: Device): PairingCode | null {
    return host.followerIds.length > 0 || this.partyCodeOf(host) ? this.ensurePartyCode(host) : null;
  }

  ensurePartyCode(host: Device): PairingCode | null {
    if (host.leaderId) return null;
    const open = this.partyCodeOf(host);
    if (open) return open;
    if (host.followerIds.length === 0 || host.partyId === null) {
      host.partyId = newId("party");
      host.barred.clear();
    }
    return this.newPartyCode(host);
  }

  private newPartyCode(host: Device): PairingCode {
    this.dropPartyCode(host);
    const value = this.freshCode();
    host.partyCode = { value, expiresAt: this.now() + this.codeTtlMs };
    this.deviceByPartyCode.set(value, host.id);
    return { code: value, expiresInMs: this.codeTtlMs };
  }

  partyOfCode(code: string): { host: string; party: string } | undefined {
    const host = this.hostOfPartyCode(code);
    return host?.partyId ? { host: host.publicId, party: host.partyId } : undefined;
  }

  invitedParty(publicId: string, party: string, profileId: string): PairingCode | null {
    const host = this.deviceByPublicId(publicId);
    if (!host || host.partyId !== party || host.barred.has(profileId)) return null;
    return this.runningParty(host);
  }

  private isBarred(host: Device, guest: Device): boolean {
    return host.barred.has(guest.id) || (guest.profileId !== null && host.barred.has(guest.profileId));
  }

  private dropPartyCode(host: Device): void {
    if (host.partyCode) this.deviceByPartyCode.delete(host.partyCode.value);
    host.partyCode = null;
  }

  joinParty(guest: Device, code: string): JoinPartyResult {
    const hostId = this.deviceByPartyCode.get(code);
    const host = hostId ? this.devices.get(hostId) : undefined;
    if (!host || host.id === guest.id || host.partyCode?.value !== code) return { ok: false, reason: "INVALID_CODE" };
    if (!this.partyCodeOf(host)) {
      this.dropPartyCode(host);
      return { ok: false, reason: "INVALID_CODE" };
    }
    if (this.isBarred(host, guest)) return { ok: false, reason: "INVALID_CODE" };
    if (guest.leaderId === host.id) return { ok: true, host };
    if (guest.leaderId) return { ok: false, reason: "ALREADY_IN_PARTY" };
    if (guest.followerIds.length > 0) return { ok: false, reason: "HOSTING" };
    if (guest.controllerIds.length > 0) return { ok: false, reason: "HAS_PHONE" };
    if (host.followerIds.length >= MAX_FOLLOWERS) return { ok: false, reason: "PARTY_FULL" };
    this.makeGuest(guest, host);
    return { ok: true, host };
  }

  setAdmin(host: Device, publicId: string, admin: boolean): Device | null {
    const guest = this.followersOf(host).find((candidate) => candidate.publicId === publicId);
    if (!guest || guest.admin === admin) return null;
    guest.admin = admin;
    this.onChange?.();
    return guest;
  }

  removeGuest(host: Device, publicId: string): Device | null {
    const guest = this.followersOf(host).find((candidate) => candidate.publicId === publicId);
    if (!guest) return null;
    this.sendAway(host, guest);
    return guest;
  }

  private sendAway(host: Device, guest: Device): void {
    host.barred.add(guest.id);
    if (guest.profileId) host.barred.add(guest.profileId);
    this.detachFollower(guest);
    if (this.partyCodeOf(host)) this.newPartyCode(host);
  }

  closeParty(host: Device): Device[] {
    const guests = this.followersOf(host);
    for (const guest of guests) this.detachFollower(guest);
    this.dropPartyCode(host);
    host.partyId = null;
    host.barred.clear();
    return guests;
  }

  removeFollower(controller: Controller, publicId: string): { leader: Device; follower: Device } | null {
    const leader = this.deviceForController(controller);
    const follower = leader && this.followersOf(leader).find((candidate) => candidate.publicId === publicId);
    if (!leader || !follower) return null;
    this.sendAway(leader, follower);
    return { leader, follower };
  }

  detachFollower(follower: Device): void {
    const leader = this.leaderOf(follower);
    if (leader) leader.followerIds = leader.followerIds.filter((id) => id !== follower.id);
    follower.leaderId = null;
    this.release(follower);
  }

  deviceForController(controller: Controller): Device | undefined {
    return controller.deviceId ? this.devices.get(controller.deviceId) : undefined;
  }

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
    for (const follower of this.followersOf(device)) {
      follower.leaderId = null;
      this.release(follower);
    }
    if (device.controlCode) {
      this.deviceByControlCode.delete(device.controlCode.value);
      device.controlCode = null;
    }
    this.dropPartyCode(device);
    device.partyId = null;
    device.barred.clear();
    this.dropCode(device);
    device.followerIds = [];
    device.admin = false;
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

function hintOf({ poster, backdrop, year }: NormalizedMedia): PlayHint | undefined {
  if (!poster && !backdrop && !year) return undefined;
  return { ...(poster ? { poster } : {}), ...(backdrop ? { backdrop } : {}), ...(year ? { year } : {}) };
}
