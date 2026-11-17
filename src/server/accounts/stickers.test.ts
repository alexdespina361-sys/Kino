import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONAL_STICKER } from "../../shared";
import { FileStickerFiles, MemoryStickerFiles, PostgresStickerFiles, personalStickersMaxBytes, personalStickersOn, type StickerFiles } from "./stickerFiles";
import { makeSticker, pngHeader } from "./stickerImage";
import { StickerBook, type StickerHost } from "./stickers";

/** A square picture: every pixel `rgba`, or made by `paint`. */
function picture(side: number, rgba: [number, number, number, number] = [200, 40, 40, 255], paint?: (x: number, y: number) => [number, number, number, number]): Buffer {
  const png = new PNG({ width: side, height: side });
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) png.data.set(paint ? paint(x, y) : rgba, (y * side + x) * 4);
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, deflateLevel: 9 });
}
/** A picture of its own for each `n`. */
const nth = (n: number) => picture(32, [n & 255, (n >> 8) & 255, 99, 255]);

/** A chunk of a PNG, with its CRC. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** A PNG put together by hand: its header as given, `idat` as its data. */
function handMade(header: { width: number; height: number; depth?: number; colour?: number; interlace?: number }, idat: Buffer, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(header.width, 0);
  ihdr.writeUInt32BE(header.height, 4);
  ihdr[8] = header.depth ?? 8;
  ihdr[9] = header.colour ?? 6;
  ihdr[12] = header.interlace ?? 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
/** A picture with a chunk of text put in before its end (where a camera or an editor puts what it says of a picture). */
function withText(png: Buffer, text: string): Buffer {
  const end = png.length - 12;
  return Buffer.concat([png.subarray(0, end), chunk("tEXt", Buffer.from(`Comment\0${text}`, "latin1")), png.subarray(end)]);
}

describe("a personal sticker's picture", () => {
  it("is made again from its pixels: the same picture, as a PNG this server wrote, with nothing else the file held", () => {
    const sent = withText(picture(64), "secret words of the sender");
    const made = makeSticker(sent);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.png.includes(Buffer.from("secret words"))).toBe(false);
    expect(made.png.includes(Buffer.from("tEXt"))).toBe(false);
    const back = PNG.sync.read(made.png);
    expect([back.width, back.height]).toEqual([64, 64]);
    expect([...back.data.subarray(0, 4)]).toEqual([200, 40, 40, 255]);
    expect(made.hash).toBe(createHash("sha256").update(made.png).digest("base64url"));
  });

  it("keeps the see-through parts of a picture that has them, and leaves out the alpha of one that has none", () => {
    const opaque = makeSticker(picture(32));
    const cut = makeSticker(picture(32, undefined, (x) => (x < 16 ? [0, 0, 0, 0] : [10, 200, 10, 255])));
    expect(opaque.ok && pngHeader(opaque.png)?.colour).toBe(2);
    expect(cut.ok && pngHeader(cut.png)?.colour).toBe(6);
    if (!cut.ok) return;
    const back = PNG.sync.read(cut.png);
    expect([back.data[3], back.data[(31 * 4) + 3]]).toEqual([0, 255]);
  });

  it("is the same sticker made twice (the hash), and another for another picture", () => {
    const one = makeSticker(nth(1));
    const again = makeSticker(withText(nth(1), "different words, same pixels"));
    const two = makeSticker(nth(2));
    expect(one.ok && again.ok && one.hash === again.hash).toBe(true);
    expect(one.ok && two.ok && one.hash !== two.hash).toBe(true);
  });

  it("turns away what is not such a picture, before unpacking it when its header says so", () => {
    const rows = (width: number, height: number) => deflateSync(Buffer.alloc((width * 4 + 1) * height));
    const cases: Array<[string, Buffer, string]> = [
      ["nothing", Buffer.alloc(0), "not_a_picture"],
      ["a JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(60)]), "not_a_picture"],
      ["all see-through", picture(32, [255, 255, 255, 0]), "not_a_picture"],
      ["not square", handMade({ width: 32, height: 16 }, rows(32, 16)), "not_a_picture"],
      ["too small", handMade({ width: 8, height: 8 }, rows(8, 8)), "not_a_picture"],
      ["bigger than a page makes it", handMade({ width: PERSONAL_STICKER.side + 1, height: PERSONAL_STICKER.side + 1 }, rows(4, 4)), "not_a_picture"],
      // (a few bytes that say they are a picture of a hundred thousand pixels a side: never unpacked)
      ["a header that would unpack to gigabytes", handMade({ width: 100_000, height: 100_000 }, deflateSync(Buffer.alloc(1024))), "not_a_picture"],
      ["interlaced", handMade({ width: 32, height: 32, interlace: 1 }, rows(32, 32)), "not_a_picture"],
      ["16 bits a colour", handMade({ width: 32, height: 32, depth: 16 }, rows(64, 32)), "not_a_picture"],
      ["a palette", handMade({ width: 32, height: 32, colour: 3 }, rows(8, 32)), "not_a_picture"],
      ["grey", handMade({ width: 32, height: 32, colour: 0 }, rows(8, 32)), "not_a_picture"],
      ["less data than its header says", handMade({ width: 32, height: 32 }, rows(32, 4)), "not_a_picture"],
      ["a header that is not the first chunk", Buffer.concat([picture(32).subarray(0, 8), chunk("tEXt", Buffer.from("a\0b")), picture(32).subarray(8)]), "not_a_picture"],
      ["more bytes than a sticker is sent in", Buffer.concat([picture(32), Buffer.alloc(PERSONAL_STICKER.sentBytes)]), "too_big"],
    ];
    for (const [name, sent, error] of cases) expect(makeSticker(sent), name).toEqual({ ok: false, error });
  });

  it("turns away a file whose checksum is wrong", () => {
    const sent = Buffer.from(picture(32));
    const idat = sent.indexOf(Buffer.from("IDAT"));
    sent[idat + 6] = sent[idat + 6]! ^ 0xff; // (a byte of the data changed, its CRC not)
    expect(makeSticker(sent)).toEqual({ ok: false, error: "not_a_picture" });
  });
});

/* ------------------------------ the book ------------------------------ */

/** What the book is told of the store and the profiles (`now` is the clock, moved by the tests). */
class Host {
  now = Date.parse("2026-11-17T10:00:00Z");
  readonly off = new Set<string>();
  readonly touched: string[] = [];
  readonly dropped: string[] = [];
  touch(key: string) {
    this.touched.push(key);
  }
  drop(key: string) {
    this.dropped.push(key);
  }
  on(profileId: string) {
    return !this.off.has(profileId);
  }
}

function book(options: { on?: boolean; maxBytes?: number; files?: StickerFiles; host?: Host } = {}) {
  const host = options.host ?? new Host();
  const files = options.files ?? new MemoryStickerFiles();
  const warned: string[] = [];
  const seen: StickerHost = { touch: (key) => host.touch(key), drop: (key) => host.drop(key), now: () => host.now, on: (id) => host.on(id) };
  const stickers = new StickerBook(seen, files, {
    on: options.on ?? true,
    ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
    log: { warn: (message) => void warned.push(message) },
  });
  return { stickers, host, files, warned };
}

async function make(stickers: StickerBook, profile: string, picture: Buffer, account = `account-of-${profile}`): Promise<string> {
  const made = await stickers.make(profile, account, picture);
  if (!made.ok) throw new Error(`could not make it: ${made.error}`);
  return made.value;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the book of personal stickers", () => {
  it("makes nothing while they are off, nor for a profile without friends", async () => {
    expect(await book({ on: false }).stickers.make("p1", "a1", nth(1))).toEqual({ ok: false, error: "off" });
    const { stickers, host } = book();
    host.off.add("child");
    expect(await stickers.make("child", "a1", nth(1))).toEqual({ ok: false, error: "friends_off" });
    expect(stickers.size).toEqual({ stickers: 0, bytes: 0 });
  });

  it("keeps a profile's stickers, the newest first, and tells its own from those it saved", async () => {
    const { stickers, host, files } = book();
    const first = await make(stickers, "alex", nth(1));
    host.now += 1000;
    const second = await make(stickers, "alex", nth(2));
    host.now += 1000;
    const sams = await make(stickers, "sam", nth(3));
    host.now += 1000;
    expect(stickers.save("alex", sams)).toEqual({ ok: true, value: null });
    expect(stickers.of("alex").stickers).toEqual([
      { id: sams, mine: false },
      { id: second, mine: true },
      { id: first, mine: true },
    ]);
    expect(stickers.of("sam").stickers).toEqual([{ id: sams, mine: true }]);
    expect(stickers.of("nobody").stickers).toEqual([]);
    expect((await files.ids()).sort()).toEqual([first, second, sams].sort());
    expect(await stickers.picture(first)).toEqual((makeSticker(nth(1)) as { png: Buffer }).png);
  });

  it("is the sticker a profile made already when it makes the same picture again; another profile's same picture is a sticker of its own", async () => {
    const { stickers } = book();
    const alexs = await make(stickers, "alex", nth(7));
    expect(await make(stickers, "alex", withText(nth(7), "again"))).toBe(alexs);
    const sams = await make(stickers, "sam", nth(7), "account-of-sam");
    expect(sams).not.toBe(alexs);
    expect(stickers.of("sam").stickers).toEqual([{ id: sams, mine: true }]);
    expect(stickers.size.stickers).toBe(2);
  });

  it("holds so many for a profile, makes so many a day for an account, and keeps so much for the site", async () => {
    const { stickers, host } = book();
    for (let n = 0; n < PERSONAL_STICKER.madePerDay; n++) await make(stickers, "alex", nth(100 + n), "alexs-account");
    const tooMany = await stickers.make("alex", "alexs-account", nth(99));
    expect(tooMany).toMatchObject({ ok: false, error: "too_many" });
    expect((tooMany as { waitMs: number }).waitMs).toBeGreaterThan(0);
    // (the rest of the profile's room, from an account that has made none today)
    for (let n = PERSONAL_STICKER.madePerDay; n < PERSONAL_STICKER.perProfile; n++) await make(stickers, "alex", nth(100 + n), "another-account");
    expect(await stickers.make("alex", "another-account", nth(98))).toEqual({ ok: false, error: "full" });
    const sams = await make(stickers, "sam", nth(500));
    expect(stickers.save("alex", sams)).toEqual({ ok: false, error: "full" });
    // (a day later the account may make some again: the profile is still full)
    host.now += 24 * 3600 * 1000 + 1;
    expect(await stickers.make("alex", "alexs-account", nth(97))).toEqual({ ok: false, error: "full" });

    const one = (makeSticker(nth(1)) as { png: Buffer }).png.length;
    const small = book({ maxBytes: one + 10 }).stickers;
    await make(small, "alex", nth(1));
    expect(await small.make("alex", "alexs-account", nth(2))).toEqual({ ok: false, error: "site_full" });
    // (a sticker that was not made is not counted against the account's day)
    for (let n = 0; n < PERSONAL_STICKER.madePerDay - 1; n++) expect((await small.make("alex", "alexs-account", nth(2))).ok).toBe(false);
    expect(await small.make("alex", "alexs-account", nth(2))).toEqual({ ok: false, error: "site_full" });
  });

  it("lets a picture go for good when the last profile that has it lets it go", async () => {
    const { stickers, host, files } = book();
    const id = await make(stickers, "alex", nth(1));
    expect(stickers.save("sam", id).ok).toBe(true);
    expect(stickers.save("sam", id).ok).toBe(true); // (saving one it has is nothing)
    expect(stickers.release("alex", id)).toEqual({ ok: true, value: null });
    expect(stickers.has(id)).toBe(true);
    expect(stickers.of("alex").stickers).toEqual([]);
    expect(stickers.of("sam").stickers).toEqual([{ id, mine: false }]);
    expect(stickers.release("alex", id)).toEqual({ ok: false, error: "gone" });
    expect(stickers.release("sam", id).ok).toBe(true);
    await tick();
    expect(stickers.has(id)).toBe(false);
    expect(await stickers.picture(id)).toBeUndefined();
    expect(await files.ids()).toEqual([]);
    expect(host.dropped).toEqual([`sticker:${id}`]);
    expect(stickers.size).toEqual({ stickers: 0, bytes: 0 });
    expect(stickers.save("sam", id)).toEqual({ ok: false, error: "gone" });
  });

  it("forgets a profile that is gone: its hold on every sticker, and the pictures only it had", async () => {
    const { stickers } = book();
    const alone = await make(stickers, "alex", nth(1));
    const shared = await make(stickers, "alex", nth(2));
    stickers.save("sam", shared);
    stickers.forget("alex");
    await tick();
    expect(stickers.has(alone)).toBe(false);
    expect(stickers.has(shared)).toBe(true);
    expect(stickers.of("sam").stickers).toEqual([{ id: shared, mine: false }]);
  });

  it("is taken down by the team, one sticker or all of a maker's, out of every collection", async () => {
    const { stickers } = book();
    const one = await make(stickers, "alex", nth(1), "alexs-account");
    const two = await make(stickers, "alex", nth(2), "alexs-account");
    const sams = await make(stickers, "sam", nth(3));
    stickers.save("sam", one);
    expect(stickers.list().map((each) => [each.id, each.by, each.account, each.holders])).toEqual(
      expect.arrayContaining([
        [one, "alex", "alexs-account", 2],
        [two, "alex", "alexs-account", 1],
        [sams, "sam", "account-of-sam", 1],
      ]),
    );
    expect(stickers.takeDown(one)).toBe(2);
    expect(stickers.takeDown(one)).toBe(0);
    expect(stickers.of("sam").stickers).toEqual([{ id: sams, mine: true }]);
    expect(stickers.takeDownBy("alexs-account")).toBe(1);
    expect(stickers.takeDownBy("sam")).toBe(1);
    expect(stickers.takeDownBy("nobody")).toBe(0);
    expect(stickers.size.stickers).toBe(0);
  });

  it("is read back as it was written, and turns away a document that is not one of its own", async () => {
    const first = book();
    const id = await make(first.stickers, "alex", nth(1));
    first.stickers.save("sam", id);
    const doc = first.stickers.docFor(`sticker:${id}`);
    const second = book({ files: first.files });
    second.stickers.load(`sticker:${id}`, JSON.parse(JSON.stringify(doc)));
    expect(second.stickers.of("sam").stickers).toEqual([{ id, mine: false }]);
    expect(second.stickers.of("alex").stickers).toEqual([{ id, mine: true }]);
    expect(await second.stickers.picture(id)).toEqual(await first.stickers.picture(id));
    // (and the same picture made again by its maker is found)
    expect(await make(second.stickers, "alex", nth(1))).toBe(id);
    for (const broken of [null, {}, { ...(doc as object), id: "short" }, { ...(doc as object), held: [] }, { ...(doc as object), bytes: "9" }]) {
      expect(() => book().stickers.load(`sticker:${id}`, broken), JSON.stringify(broken)).toThrow();
    }
    expect(() => book().stickers.load("sticker:another-name-of-22", doc)).toThrow();
    expect(StickerBook.owns(`sticker:${id}`)).toBe(true);
    expect(StickerBook.owns("chat:x")).toBe(false);
  });

  it("tidies at start: a picture with no record goes, a record nobody has goes, a record whose picture is missing stays and is said", async () => {
    const first = book();
    const kept = await make(first.stickers, "alex", nth(1));
    const lost = await make(first.stickers, "alex", nth(2));
    const docs = [kept, lost].map((id) => JSON.parse(JSON.stringify(first.stickers.docFor(`sticker:${id}`))));
    await first.files.put("AAAAAAAAAAAAAAAAAAAAAA", Buffer.from("an orphan"));
    await first.files.remove(lost);
    const nobodys = { ...docs[0], id: "BBBBBBBBBBBBBBBBBBBBBB", hash: "other", held: {} };

    const second = book({ files: first.files });
    second.stickers.load(`sticker:${kept}`, docs[0]);
    second.stickers.load(`sticker:${lost}`, docs[1]);
    second.stickers.load(`sticker:${nobodys.id}`, nobodys);
    expect(await second.stickers.reconcile()).toEqual({ pictures: 1, documents: 1, missing: 1 });
    await tick();
    expect((await first.files.ids()).sort()).toEqual([kept]);
    expect(second.stickers.has(kept) && second.stickers.has(lost)).toBe(true);
    expect(second.stickers.has(nobodys.id)).toBe(false);
    expect(second.host.dropped).toEqual([`sticker:${nobodys.id}`]);
    expect(second.warned.join(" ")).toMatch(/1 record\(s\) have no picture/);
    // (a home of the pictures that cannot be read is said, and nothing is let go)
    const failing = book({ files: { ...new MemoryStickerFiles(), ids: async () => Promise.reject(new Error("down")) } as unknown as StickerFiles });
    failing.stickers.load(`sticker:${kept}`, docs[0]);
    expect(await failing.stickers.reconcile()).toEqual({ pictures: 0, documents: 0, missing: 0 });
    expect(failing.stickers.has(kept)).toBe(true);
    expect(failing.warned.join(" ")).toMatch(/could not tidy/);
  });

  it("takes back the room it counted when a picture could not be written", async () => {
    const files = new MemoryStickerFiles();
    files.put = async () => Promise.reject(new Error("disk full"));
    const { stickers } = book({ files });
    await expect(stickers.make("alex", "a1", nth(1))).rejects.toThrow("disk full");
    expect(stickers.size).toEqual({ stickers: 0, bytes: 0 });
    expect(stickers.of("alex").stickers).toEqual([]);
  });
});

/* ------------------------------ where the pictures are kept ------------------------------ */

const folders: string[] = [];
const dbs: PGlite[] = [];
afterEach(async () => {
  while (folders.length) await rm(folders.pop()!, { recursive: true, force: true });
  await Promise.all(dbs.splice(0).map((db) => db.close()));
});

const ID = "C".repeat(22);
const OTHER = "D".repeat(22);

for (const [name, open] of [
  ["memory", async () => new MemoryStickerFiles()],
  [
    "a folder",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "kino-stickers-"));
      folders.push(dir);
      return new FileStickerFiles(path.join(dir, "stickers"));
    },
  ],
  [
    "Postgres",
    async () => {
      const db = new PGlite();
      dbs.push(db);
      return new PostgresStickerFiles(db);
    },
  ],
] as const) {
  describe(`the pictures kept in ${name}`, () => {
    it("are written, read, listed and removed by their names", async () => {
      const files: StickerFiles = await open();
      expect(await files.ids()).toEqual([]);
      expect(await files.get(ID)).toBeUndefined();
      await files.put(ID, Buffer.from("one"));
      await files.put(OTHER, Buffer.from("two"));
      await files.put(ID, Buffer.from("one again"));
      expect((await files.get(ID))?.toString()).toBe("one again");
      expect((await files.ids()).sort()).toEqual([ID, OTHER]);
      await files.remove(ID);
      await files.remove(ID);
      expect(await files.get(ID)).toBeUndefined();
      expect(await files.ids()).toEqual([OTHER]);
      // (only a sticker's name names a picture)
      expect(await files.get("../../etc/passwd")).toBeUndefined();
    });
  });
}

describe("the folder of the pictures", () => {
  it("never writes outside itself, and lists only what is a sticker's picture", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kino-stickers-"));
    folders.push(dir);
    const files = new FileStickerFiles(dir);
    await expect(files.put("../outside", Buffer.from("x"))).rejects.toThrow();
    await files.put(ID, Buffer.from("x"));
    await writeFile(path.join(dir, "notes.txt"), "x");
    await writeFile(path.join(dir, "short.png"), "x");
    expect(await files.ids()).toEqual([ID]);
    expect((await readdir(dir)).sort()).toEqual([`${ID}.png`, "notes.txt", "short.png"]);
  });
});

describe("the host's switches", () => {
  it("are off unless the host turned them on, and the room is what it says", () => {
    expect(personalStickersOn({})).toBe(false);
    expect(personalStickersOn({ PERSONAL_STICKERS: "off" })).toBe(false);
    expect(personalStickersOn({ PERSONAL_STICKERS: "On" })).toBe(true);
    expect(personalStickersMaxBytes({})).toBeUndefined();
    expect(personalStickersMaxBytes({ PERSONAL_STICKERS_MB: "-1" })).toBeUndefined();
    expect(personalStickersMaxBytes({ PERSONAL_STICKERS_MB: "2" })).toBe(2 * 1024 * 1024);
  });
});
