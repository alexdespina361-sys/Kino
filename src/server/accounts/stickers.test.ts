import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_STICKER } from "../../shared";
import { WorkBudget } from "./rateLimit";
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
    expect(made.data.includes(Buffer.from("secret words"))).toBe(false);
    expect(made.data.includes(Buffer.from("tEXt"))).toBe(false);
    const back = PNG.sync.read(made.data);
    expect([back.width, back.height]).toEqual([64, 64]);
    expect([...back.data.subarray(0, 4)]).toEqual([200, 40, 40, 255]);
    expect(made.hash).toBe(createHash("sha256").update(made.data).digest("base64url"));
  });

  it("keeps the see-through parts of a picture that has them, and leaves out the alpha of one that has none", () => {
    const opaque = makeSticker(picture(32));
    const cut = makeSticker(picture(32, undefined, (x) => (x < 16 ? [0, 0, 0, 0] : [10, 200, 10, 255])));
    expect(opaque.ok && pngHeader(opaque.data)?.colour).toBe(2);
    expect(cut.ok && pngHeader(cut.data)?.colour).toBe(6);
    if (!cut.ok) return;
    const back = PNG.sync.read(cut.data);
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
    // (rows of white pixels that are seen, each with its filter byte: a picture that is good in every way but the one each case is about)
    const rows = (width: number, height: number) => {
      const data = Buffer.alloc((width * 4 + 1) * height, 0xff);
      for (let row = 0; row < height; row++) data[row * (width * 4 + 1)] = 0;
      return deflateSync(data);
    };
    expect(makeSticker(handMade({ width: 32, height: 32 }, rows(32, 32))).ok, "the pictures the cases are made of are good ones").toBe(true);
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
      ["a depth its kind has not", handMade({ width: 32, height: 32, colour: 2, depth: 4 }, rows(12, 32)), "not_a_picture"],
      ["a palette of 16 bits", handMade({ width: 32, height: 32, colour: 3, depth: 16 }, rows(16, 32)), "not_a_picture"],
      ["a kind there is not", handMade({ width: 32, height: 32, colour: 5 }, rows(32, 32)), "not_a_picture"],
      ["a palette picture with no palette", handMade({ width: 32, height: 32, colour: 3 }, deflateSync(Buffer.alloc(33 * 32))), "not_a_picture"],
      ["less data than its header says", handMade({ width: 32, height: 32 }, rows(32, 4)), "not_a_picture"],
      ["more data than its header says", handMade({ width: 32, height: 32 }, rows(32, 400)), "not_a_picture"],
      ["no end", handMade({ width: 32, height: 32 }, rows(32, 32)).subarray(0, -12), "not_a_picture"],
      ["a chunk longer than the file", Buffer.concat([handMade({ width: 32, height: 32 }, rows(32, 32)).subarray(0, 33), Buffer.from([0x7f, 0xff, 0xff, 0xff]), Buffer.from("IDAT")]), "not_a_picture"],
      ["a header that is not the first chunk", Buffer.concat([picture(32).subarray(0, 8), chunk("tEXt", Buffer.from("a\0b")), picture(32).subarray(8)]), "not_a_picture"],
      ["more bytes than a sticker is sent in", Buffer.concat([picture(32), Buffer.alloc(PERSONAL_STICKER.sentBytes)]), "too_big"],
    ];
    for (const [name, sent, error] of cases) expect(makeSticker(sent), name).toEqual({ ok: false, error });
  });

  it("takes the other kinds of PNG a browser's canvas may write (grey, 16 bits, grey and alpha), and keeps each as this server writes one", () => {
    for (const [colour, depth, bytesPerPixel] of [
      [0, 8, 1],
      [0, 16, 2],
      [2, 16, 6],
      [4, 8, 2],
      [6, 16, 8],
    ] as const) {
      const data = Buffer.alloc((32 * bytesPerPixel + 1) * 32, 0xc0);
      for (let row = 0; row < 32; row++) data[row * (32 * bytesPerPixel + 1)] = 0;
      const made = makeSticker(handMade({ width: 32, height: 32, colour, depth }, deflateSync(data)));
      expect(made.ok, `colour ${colour} depth ${depth}`).toBe(true);
      if (made.ok) expect([pngHeader(made.data)?.depth, pngHeader(made.data)?.colour], `colour ${colour} depth ${depth}`).toEqual([8, colour === 4 || colour === 6 ? 6 : 2]); // (its alpha, 0xc0, is kept)
    }
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

function book(options: { on?: boolean; maxBytes?: number; files?: StickerFiles; host?: Host; writeMs?: number; siteWorkMs?: number } = {}) {
  const host = options.host ?? new Host();
  const files = options.files ?? new MemoryStickerFiles();
  const warned: string[] = [];
  const seen: StickerHost = { touch: (key) => host.touch(key), drop: (key) => host.drop(key), now: () => host.now, on: (id) => host.on(id) };
  const stickers = new StickerBook(seen, files, {
    on: options.on ?? true,
    ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
    ...(options.writeMs ? { writeMs: options.writeMs } : {}),
    ...(options.siteWorkMs ? { siteWorkMs: options.siteWorkMs } : {}),
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
    expect(await stickers.picture(first)).toEqual((makeSticker(nth(1)) as { data: Buffer }).data);
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

    const one = (makeSticker(nth(1)) as { data: Buffer }).data.length;
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

  it("is one sticker when a profile sends the same picture twice at once (its makes go one after the other)", async () => {
    const { stickers, files } = book();
    const [one, two] = await Promise.all([stickers.make("alex", "a1", nth(5)), stickers.make("alex", "a1", nth(5))]);
    expect(one.ok && two.ok).toBe(true);
    expect((one as { value: string }).value).toBe((two as { value: string }).value);
    expect(stickers.size.stickers).toBe(1);
    expect(await files.ids()).toHaveLength(1);
    // (and one that fails lets the next one go on)
    const failing = new MemoryStickerFiles();
    const put = failing.put.bind(failing);
    let fail = true;
    failing.put = async (id, data) => (fail ? ((fail = false), Promise.reject(new Error("disk full"))) : put(id, data));
    const other = book({ files: failing }).stickers;
    const [first, second] = await Promise.allSettled([other.make("alex", "a1", nth(6)), other.make("alex", "a1", nth(6))]);
    expect(first.status).toBe("rejected");
    expect(second).toMatchObject({ status: "fulfilled", value: { ok: true } });
  });

  it("does not count a sticker against the account's day when the collection filled while its picture was written", async () => {
    const files = new MemoryStickerFiles();
    const put = files.put.bind(files);
    let hold: (() => void) | undefined;
    const { stickers } = book({ files });
    // (the collection one short of full, and a sticker of Sam's to save into it)
    for (let n = 0; n < PERSONAL_STICKER.perProfile - 1; n++) await make(stickers, "alex", nth(200 + n), `account-${Math.floor(n / PERSONAL_STICKER.madePerDay)}`);
    const sams = await make(stickers, "sam", nth(300));
    files.put = (id, data) => new Promise<void>((resolve) => (hold = () => void put(id, data).then(resolve)));
    const making = stickers.make("alex", "late-account", nth(301));
    await tick();
    expect(stickers.save("alex", sams).ok).toBe(true);
    hold!();
    expect(await making).toEqual({ ok: false, error: "full" });
    files.put = put;
    // (the account has all of its day still: as many as a day allows, for another profile)
    for (let n = 0; n < PERSONAL_STICKER.madePerDay; n++) await make(stickers, "kim", nth(400 + n), "late-account");
    expect(await files.ids()).toHaveLength(PERSONAL_STICKER.perProfile - 1 + 1 + PERSONAL_STICKER.madePerDay);
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

describe("what the whole site gives to making stickers (the judge, 17 Nov: every limit was an account's)", () => {
  it("lets so many pictures in in a minute, whoever sends them, and the next when the minute has passed", () => {
    const { stickers, host } = book();
    for (let n = 0; n < PERSONAL_STICKER.sitePerMinute; n++) expect(stickers.arriving(), String(n)).toBe(0);
    expect(stickers.arriving()).toBeGreaterThan(0);
    host.now += 60_001;
    expect(stickers.arriving()).toBe(0);
  });

  it("counts the time spent making them: an hour's spent, the next waits until enough of it is an hour old", () => {
    const clock = { now: 1_000_000 };
    const budget = new WorkBudget(1000, 3600_000, () => clock.now);
    expect(budget.wait()).toBe(0);
    budget.spend(600);
    clock.now += 60_000;
    budget.spend(300);
    expect(budget.wait()).toBe(0);
    clock.now += 60_000;
    budget.spend(200); // (1100 of 1000: what was under way was finished, the next waits)
    expect(budget.wait(), "until the first 600 are an hour old").toBe(3600_000 - 120_000);
    clock.now += 3600_000 - 120_000;
    expect(budget.wait()).toBe(0);
  });

  it("counts what making a sticker took, made or not, and lets none in when the hour's is spent", async () => {
    const { stickers, host } = book({ siteWorkMs: 0.0001 });
    expect(stickers.arriving()).toBe(0);
    expect(await stickers.make("p1", "a1", Buffer.from("not a picture"))).toEqual({ ok: false, error: "not_a_picture" });
    expect(stickers.arriving(), "even what was refused took its time").toBeGreaterThan(0);
    host.now += 3600_001;
    expect(stickers.arriving()).toBe(0);
  });

  it("tells a maker whose picture is not written in time that it failed, counts it until it is, and makes nothing new with so many on their way", async () => {
    const files = new MemoryStickerFiles();
    const put = files.put.bind(files);
    const held: Array<() => void> = [];
    files.put = (id, data) => new Promise<void>((resolve) => held.push(() => void put(id, data).then(resolve)));
    const { stickers } = book({ files, writeMs: 20 });
    for (let n = 0; n < PERSONAL_STICKER.writesAtOnce; n++) await expect(stickers.make(`p${n}`, `a${n}`, nth(n + 1)), String(n)).rejects.toThrow(/not written in time/);
    expect(await stickers.make("p9", "a9", nth(99))).toEqual({ ok: false, error: "site_full" });
    expect(stickers.size.stickers).toBe(0);
    // (they answer at last: what they wrote is let go, nothing having been made of it, and the site makes again)
    for (const go of held.splice(0)) go();
    await vi.waitFor(async () => expect(await files.ids()).toEqual([]));
    files.put = put;
    await vi.waitFor(async () => expect((await stickers.make("p9", "a9", nth(99))).ok).toBe(true));
    expect(stickers.size.stickers).toBe(1);
    // (and it was not one of its maker's day: the first eight makers can make theirs again)
    expect((await stickers.make("p0", "a0", nth(1))).ok).toBe(true);
  });

  it("keeps a picture written too late counted while it cannot be removed: it is there, with no record, until the next start", async () => {
    const files = new MemoryStickerFiles();
    const put = files.put.bind(files);
    let go: (() => void) | undefined;
    files.put = (id, data) => new Promise<void>((resolve) => (go = () => void put(id, data).then(resolve)));
    files.remove = () => Promise.reject(new Error("the disk says no"));
    const { stickers, warned } = book({ files, writeMs: 20 });
    await expect(stickers.make("p1", "a1", nth(1))).rejects.toThrow(/not written in time/);
    go!();
    await vi.waitFor(() => expect(warned.join(" ")).toMatch(/could not be removed/));
    expect(await files.ids()).toHaveLength(1);
    expect(stickers.size, "no sticker, and its bytes still counted").toMatchObject({ stickers: 0 });
    expect(stickers.size.bytes).toBeGreaterThan(0);
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
