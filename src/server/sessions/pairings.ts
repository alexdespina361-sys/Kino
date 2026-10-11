import { z } from "zod";
import type { Persistence } from "../accounts/persistence";
import type { ControllerRecord, DeviceRecord, Records, Registry } from "./registry";

// The order of the fields is the order they are written in: a database that keeps JSON in a form of its own (Postgres does) still reads back as the same text.
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
});
const ControllerDoc = z.object({ v: z.literal(1), id: z.string(), deviceId: z.string(), seenDay: z.number() });

const TV = "tv:";
const PHONE = "phone:";
/** When a write fails (the database is waking up, the network blinked), try again after this. */
const RETRY_MS = 10_000;

export interface PairingStoreOptions {
  registry: Registry;
  persistence: Persistence;
  /** How long a change waits before it is written; it is also written when the server stops. `0` leaves the writing to `flush` (tests). */
  flushMs?: number;
  log?: { warn(message: string): void };
}

/**
 * Keeps which phone goes with which TV (and which TVs watch along with which) through a `Persistence`, so a server that
 * restarts, or a free host that sleeps and wakes, does not make every pair start over. Codes and what is playing are not kept:
 * a TV asks for a new code when it needs one, and says what it is playing the moment it reconnects.
 */
export class PairingStore {
  /** What is in the database right now: key -> its JSON. A change is written only if it differs from this. */
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
    this.schedule(); // what was too old, or no longer agreed, is cleared out of the database soon
  }

  private schedule(delay = this.flushMs): void {
    if (this.flushMs <= 0) return;
    this.timer ??= setTimeout(() => void this.flush(), delay);
    this.timer.unref?.();
  }

  /** What should be in the database now. */
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

  /** Write what changed. Resolves when it is written; a failure is kept to try again with the next change. */
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

  /** Writes what has not been written. The database itself is closed by whoever opened it. */
  async close(): Promise<void> {
    this.registry.onChange = undefined;
    await this.flush();
  }
}
