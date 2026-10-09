import { randomBytes, randomInt } from "node:crypto";
import {
  IDLE_STATE,
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
  name: string;
  /** Present only while unpaired. Single use: consumed by a successful pairing. */
  code: { value: string; expiresAt: number } | null;
  controllerId: string | null;
  /** Last known playback, so a reconnecting phone can resync. */
  media: NormalizedMedia | null;
  state: PlayerState;
}

export interface Controller {
  id: string;
  deviceId: string | null;
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
      name: `TV ${id.slice(-4).toUpperCase()}`,
      code: null,
      controllerId: null,
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
    if (device.controllerId) return null;
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

  /** Consume a pairing code and link controller <-> device. Returns the device, or null if the code is bad. */
  pair(controller: Controller, code: string): Device | null {
    const deviceId = this.deviceByCode.get(code);
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    if (!device?.code || device.code.value !== code) return null;
    if (device.code.expiresAt <= this.now()) {
      this.deviceByCode.delete(code);
      device.code = null;
      return null;
    }
    this.deviceByCode.delete(code);
    device.code = null;
    device.controllerId = controller.id;
    controller.deviceId = device.id;
    return device;
  }

  deviceForController(controller: Controller): Device | undefined {
    return controller.deviceId ? this.devices.get(controller.deviceId) : undefined;
  }

  /** The phone lets go of its TV. The TV is unpaired again (ensureCode issues it a fresh code) and idle. */
  unpair(controller: Controller): Device | null {
    const device = this.deviceForController(controller);
    controller.deviceId = null;
    if (!device || device.controllerId !== controller.id) return null;
    return this.release(device);
  }

  /** The TV lets go of its phone (the same end state as `unpair`). Returns the phone that was paired, if any. */
  unpairDevice(device: Device): Controller | null {
    const controller = device.controllerId ? this.controllers.get(device.controllerId) : undefined;
    if (controller) controller.deviceId = null;
    this.release(device);
    return controller ?? null;
  }

  private release(device: Device): Device {
    device.controllerId = null;
    device.code = null;
    device.media = null;
    device.state = IDLE_STATE;
    return device;
  }
}
