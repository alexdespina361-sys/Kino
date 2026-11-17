import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { PushHub } from "./push";

/**
 * The Android app's own updates (docs/android-app.md). Its builds are kept on the host, outside the site's checkout and outside the repository (env
 * ANDROID_APP_DIR, `/var/lib/kino-web/app` on the box): `android.json` says which one is the newest, and the APK is beside it. `scripts/android-release.mjs` puts
 * a new one there; this notices it within a minute, and sends every copy of the app the news once (`PushHub.appUpdate`), which is "the signal": each app asks
 * `/api/app/android`, downloads the APK, checks its hash and asks Android to install it. An app also asks when it is opened, so a phone that missed the news
 * is not left behind.
 *
 * `/app/kino.apk` is the newest one under one address, for a link to give to people.
 */

export interface AppRelease {
  versionCode: number;
  versionName: string;
  /** The APK's name in the folder (`kino-<versionCode>.apk`). */
  file: string;
  sha256: string;
  size: number;
  /** A line about what is new, in English (the app shows it). */
  notes?: string;
}

const FILE = /^kino-\d{1,9}\.apk$/;
const MANIFEST = "android.json";
const SIGNALLED = "signalled.json";
const CHECK_MS = 60_000;

/** What `android.json` says, if it says a release: anything else is nothing. */
export function readRelease(value: unknown): AppRelease | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { versionCode, versionName, file, sha256, size, notes } = value as Record<string, unknown>;
  if (typeof versionCode !== "number" || !Number.isInteger(versionCode) || versionCode < 1) return undefined;
  if (typeof versionName !== "string" || !/^[0-9A-Za-z.+-]{1,32}$/.test(versionName)) return undefined;
  if (typeof file !== "string" || !FILE.test(file) || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return undefined;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1) return undefined;
  return { versionCode, versionName, file, sha256, size, ...(typeof notes === "string" && notes.length <= 500 ? { notes } : {}) };
}

export class AppReleases {
  private current: AppRelease | undefined;
  private seenMtime = -1;
  private signalled = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly dir: string,
    private readonly push: PushHub | undefined,
    private readonly log: { warn(message: string): void; info?(message: string): void } = { warn: () => {} },
  ) {}

  get latest(): AppRelease | undefined {
    return this.current;
  }

  /** Read `android.json` again if it changed; tell the apps of a version they have not been told of. */
  async check(): Promise<void> {
    try {
      const { mtimeMs } = await stat(path.join(this.dir, MANIFEST));
      if (mtimeMs !== this.seenMtime) {
        this.seenMtime = mtimeMs;
        const release = readRelease(JSON.parse(await readFile(path.join(this.dir, MANIFEST), "utf8")));
        const size = release && (await stat(path.join(this.dir, release.file)).catch(() => undefined))?.size;
        if (!release) this.log.warn(`${MANIFEST} in ANDROID_APP_DIR is not a release: the app is not offered.`);
        else if (size !== release.size) this.log.warn(`${release.file} is not there, or not ${release.size} bytes: the app is not offered.`);
        this.current = release && size === release.size ? release : undefined;
      }
    } catch {
      this.current = undefined;
      this.seenMtime = -1;
    }
    const release = this.current;
    if (!release || !this.push?.on || release.versionCode <= this.signalled) return;
    this.signalled = release.versionCode;
    if (await this.push.appUpdate(release.versionCode)) {
      this.log.info?.(`The apps were told of version ${release.versionName} (${release.versionCode}).`);
      await writeFile(path.join(this.dir, SIGNALLED), JSON.stringify({ versionCode: release.versionCode }), "utf8").catch(() => this.log.warn(`${SIGNALLED} could not be written: the news may be sent again after a restart.`));
    } else this.signalled = 0; // (tried again at the next check)
  }

  /** Remember which version was told of (so a restart does not send it again), read the release, and keep checking. */
  async start(): Promise<void> {
    try {
      const said = JSON.parse(await readFile(path.join(this.dir, SIGNALLED), "utf8")) as { versionCode?: unknown };
      if (typeof said.versionCode === "number") this.signalled = said.versionCode;
    } catch {
      // (nothing told yet)
    }
    await this.check();
    this.timer = setInterval(() => void this.check(), CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The APK's place on disk, if `name` is the newest one. */
  fileOf(name: string): string | undefined {
    return this.current && name === this.current.file ? path.join(this.dir, name) : undefined;
  }
}

/** `/api/app/android` (what the newest version is) and the APK itself. Without a release, the first is a 404 and there is no APK. */
export function appReleaseRoutes(app: FastifyInstance, releases: AppReleases | undefined): void {
  app.get("/api/app/android", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const release = releases?.latest;
    if (!release) return reply.code(404).send({ error: "none" });
    return { versionCode: release.versionCode, versionName: release.versionName, size: release.size, sha256: release.sha256, url: `/app/android/${release.file}`, ...(release.notes ? { notes: release.notes } : {}) };
  });
  app.get("/app/kino.apk", async (_request, reply) => {
    const release = releases?.latest;
    reply.header("Cache-Control", "no-store");
    return release ? reply.redirect(`/app/android/${release.file}`) : reply.code(404).send({ error: "none" });
  });
  app.get<{ Params: { file: string } }>("/app/android/:file", async (request, reply) => {
    const where = releases?.fileOf(request.params.file);
    if (!where) return reply.code(404).send({ error: "none" });
    return reply
      .header("Content-Type", "application/vnd.android.package-archive")
      .header("Content-Length", String(releases!.latest!.size))
      .header("Content-Disposition", 'attachment; filename="kino.apk"')
      .header("Cache-Control", "public, max-age=86400, immutable")
      .send(createReadStream(where));
  });
}
