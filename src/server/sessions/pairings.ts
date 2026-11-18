import { z } from "zod";
import { PlayHintSchema } from "../../shared";
import type { Persistence } from "../accounts/persistence";
import type { ControllerRecord, DeviceRecord, Records, Registry } from "./registry";

const DeviceDoc = z.object({
  v: z.literal(1),
  id: z.string(),
  publicId: z.string(),
  name: z.string(),
  label: z.string().nullable(),
  controllerId: z.string().nullable(),
  controllerIds: z.array(z.string()),
  leaderId: z.string().nullable(),
  followerIds: z.array(z.string()),
  seenDay: z.number(),
  resume: z.object({ url: z.string().max(2048), hint: PlayHintSchema.optional(), time: z.number().min(0).max(86_400), day: z.number() }).optional().catch(undefined),
  admin: z.boolean().optional(),
});
const ControllerDoc = z.object({
  v: z.literal(1),
  id: z.string(),
  deviceId: z.string().nullable(),
  seenDay: z.number(),
  deviceIds: z.array(z.string()).optional(),
});

const TV = "tv:";
const PHONE = "phone:";
const RETRY_MS = 10_000;

export interface PairingStoreOptions {
  registry: Registry;
  persistence: Persistence;
  flushMs?: number;
  log?: { warn(message: string): void };
}

export class PairingStore {
  private readonly written = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly registry: Registry,
    private readonly persistence: Persistence,
    private readonly flushMs: number,
    private readonly log: { warn(message: string): void } | undefined,
  ) {}

  static async open({ registry, persistence, flushMs = 1500, log }: PairingStoreOptions): Promise<PairingStore> {
    const store = new PairingStore(registry, persistence, flushMs, log);
    await store.load();
    registry.onChange = () => store.schedule();
    return store;
  }

  private async load(): Promise<void> {
    const records: Records = { devices: [], controllers: [] };
    for (const [key, value] of await this.persistence.load()) {
      if (key.startsWith(TV)) {
        const doc = DeviceDoc.safeParse(value);
        if (!doc.success) this.log?.warn(`Skipped an unreadable record (${key}).`);
        else {
          this.written.set(key, JSON.stringify(doc.data));
          records.devices.push(doc.data);
        }
      } else if (key.startsWith(PHONE)) {
        const doc = ControllerDoc.safeParse(value);
        if (!doc.success) this.log?.warn(`Skipped an unreadable record (${key}).`);
        else {
          this.written.set(key, JSON.stringify(doc.data));
          records.controllers.push(doc.data);
        }
      }
    }
    this.registry.restore(records);
    this.schedule();
  }

  private schedule(delay = this.flushMs): void {
    if (this.flushMs <= 0) return;
    this.timer ??= setTimeout(() => void this.flush(), delay);
    this.timer.unref?.();
  }

  private wanted(): Map<string, { doc: unknown; json: string }> {
    const { devices, controllers } = this.registry.records();
    const wanted = new Map<string, { doc: unknown; json: string }>();
    const add = (key: string, doc: DeviceRecord | ControllerRecord, schema: typeof DeviceDoc | typeof ControllerDoc) => {
      const stored = schema.parse({ v: 1, ...doc });
      wanted.set(key, { doc: stored, json: JSON.stringify(stored) });
    };
    for (const device of devices) add(`${TV}${device.id}`, device, DeviceDoc);
    for (const controller of controllers) add(`${PHONE}${controller.id}`, controller, ControllerDoc);
    return wanted;
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.flushing = this.flushing.then(async () => {
      try {
        const wanted = this.wanted();
        const put = new Map<string, unknown>();
        for (const [key, { doc, json }] of wanted) if (this.written.get(key) !== json) put.set(key, doc);
        const remove = new Set([...this.written.keys()].filter((key) => !wanted.has(key)));
        if (put.size === 0 && remove.size === 0) return;
        await this.persistence.save({ put, remove });
        for (const key of put.keys()) this.written.set(key, wanted.get(key)!.json);
        for (const key of remove) this.written.delete(key);
      } catch (error) {
        this.log?.warn(`Could not save pairings: ${(error as Error).message}`);
        this.schedule(RETRY_MS);
      }
    });
    return this.flushing;
  }

  async close(): Promise<void> {
    this.registry.onChange = undefined;
    await this.flush();
  }
}
