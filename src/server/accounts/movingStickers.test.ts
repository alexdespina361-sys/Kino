import { PNG } from "pngjs";
import realSharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MOVING_STICKER, PERSONAL_STICKER, PERSONAL_STICKER_BASE64_MAX, readStickerMake, StickerMakeSchema } from "../../shared";
import { MemoryStickerFiles } from "./stickerFiles";
import { makeMovingSticker, pictureType } from "./stickerImage";
import { StickerBook } from "./stickers";

const given = vi.hoisted(() => [] as Array<{ input: unknown; options: unknown }>);
vi.mock("sharp", async (importOriginal) => {
  const real = (await importOriginal<typeof import("sharp")>()).default;
  const spy = Object.assign((input: unknown, options: unknown) => {
    given.push({ input, options });
    return real(input as Buffer, options as never);
  }, real);
  return { default: spy };
});

type Rgba = [number, number, number, number];
function strip(side: number, frames: number, paint: (frame: number, x: number, y: number) => Rgba): Buffer {
  const png = new PNG({ width: side, height: side * frames });
  for (let frame = 0; frame < frames; frame++)
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) png.data.set(paint(frame, x, y), ((frame * side + y) * side + x) * 4);
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, deflateLevel: 9 });
}
const moving = (frame: number, x: number, y: number): Rgba => (Math.abs(x - 8 - frame * 6) < 5 && Math.abs(y - 16) < 5 ? [230, 40, 40, 255] : [20, 90, 200, 255]);

function withText(png: Buffer, text: string): Buffer {
  const body = Buffer.concat([Buffer.from("tEXt", "latin1"), Buffer.from(`Comment\0${text}`, "latin1")]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  const end = png.length - 12;
  return Buffer.concat([png.subarray(0, end), length, body, sum, png.subarray(end)]);
}

describe("a sticker that moves", () => {
  it("is an animated WebP made here of the pixels sent: as many pictures, each shown as long as the page said, round and round; sharp is given only those pixels", async () => {
    const sent = withText(strip(32, 3, moving), "secret words of the sender");
    given.length = 0;
    const made = await makeMovingSticker(sent, [80, 120, 200]);
    const asked = [...given];
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(pictureType(made.data)).toBe("image/webp");
    expect(made.data.includes(Buffer.from("secret words"))).toBe(false);
    const back = await realSharp(made.data, { animated: true }).metadata();
    expect([back.format, back.width, back.pageHeight, back.pages, back.loop]).toEqual(["webp", 32, 32, 3, 0]);
    expect(back.delay).toEqual([80, 120, 200]);
    expect(asked).toHaveLength(1);
    const { input, options } = asked[0]!;
    expect(Buffer.isBuffer(input) && (input as Buffer).length).toBe(32 * 32 * 3 * 4);
    expect((input as Buffer).includes(Buffer.from("secret words"))).toBe(false);
    expect(options).toEqual({ raw: { width: 32, height: 96, channels: 4, pageHeight: 32 } });
  });

  it("is a still sticker (a PNG) when its pictures are all the same", async () => {
    given.length = 0;
    const made = await makeMovingSticker(strip(32, 4, () => [10, 200, 10, 255]), [100, 100, 100, 100]);
    expect(made.ok && pictureType(made.data)).toBe("image/png");
    if (made.ok) expect([PNG.sync.read(made.data).width, PNG.sync.read(made.data).height]).toEqual([32, 32]);
    expect(given, "sharp was not asked").toHaveLength(0);
  });

  it("is not a picture with a size that is not so many squares, too many or too few pictures, too long a time or a time out of bounds, or nothing to see", async () => {
    const three = strip(32, 3, moving);
    const cases: Array<[string, Promise<unknown>]> = [
      ["two squares said, three sent", makeMovingSticker(three, [100, 100])],
      ["four said, three sent", makeMovingSticker(three, [100, 100, 100, 100])],
      ["one picture", makeMovingSticker(strip(32, 1, moving), [100])],
      ["too many", makeMovingSticker(strip(16, MOVING_STICKER.maxFrames + 1, moving), Array(MOVING_STICKER.maxFrames + 1).fill(20))],
      ["too long, each short enough", makeMovingSticker(strip(16, 9, moving), Array(9).fill(MOVING_STICKER.maxDelay))],
      ["one too long", makeMovingSticker(three, [MOVING_STICKER.maxDelay + 1, 100, 100])],
      ["too short a time", makeMovingSticker(three, [MOVING_STICKER.minDelay - 1, 100, 100])],
      ["not a whole time", makeMovingSticker(three, [100.5, 100, 100])],
      ["wider than a sticker", makeMovingSticker(strip(PERSONAL_STICKER.side + 1, 2, moving), [100, 100])],
      ["all see-through", makeMovingSticker(strip(32, 2, (frame) => [frame, 0, 0, 0]), [100, 100])],
      ["not a PNG", makeMovingSticker(Buffer.from("GIF89a and so on"), [100, 100])],
    ];
    for (const [name, made] of cases) expect(await made, name).toEqual({ ok: false, error: "not_a_picture" });
    expect(await makeMovingSticker(Buffer.alloc(MOVING_STICKER.sentBytes + 1), [100, 100])).toEqual({ ok: false, error: "too_big" });
  });

  it("is made by the book only while those are on as well: off, one sent is not a picture (the page makes a still one), and nothing is kept", async () => {
    const host = { touch: () => {}, drop: () => {}, now: () => Date.parse("2026-11-17T12:00:00Z"), on: () => true };
    const off = new StickerBook(host, new MemoryStickerFiles(), { on: true });
    expect(off.moving).toBe(false);
    expect(await off.make("p1", "a1", strip(32, 3, moving), [100, 100, 100])).toEqual({ ok: false, error: "not_a_picture" });
    expect(off.size).toEqual({ stickers: 0, bytes: 0 });
    expect(new StickerBook(host, new MemoryStickerFiles(), { on: false, moving: true }).moving, "never while personal stickers are off").toBe(false);

    const files = new MemoryStickerFiles();
    const on = new StickerBook(host, files, { on: true, moving: true });
    const made = await on.make("p1", "a1", strip(32, 3, moving), [100, 100, 100]);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const kept = await on.picture(made.value);
    expect(kept && pictureType(kept)).toBe("image/webp");
    expect(on.size).toEqual({ stickers: 1, bytes: kept!.length });
    expect(await on.make("p1", "a1", strip(32, 3, moving), [100, 100, 100])).toEqual({ ok: true, value: made.value });
  });

  it("costs one of the day's tries whenever it is sent, made or not: an account that has none left is told to wait, and still ones are made all the same (the judge, 17 Nov)", async () => {
    let now = Date.parse("2026-11-17T12:00:00Z");
    const host = { touch: () => {}, drop: () => {}, now: () => now, on: () => true };
    const book = new StickerBook(host, new MemoryStickerFiles(), { on: true, moving: true });
    const three = strip(32, 3, moving);
    for (let tried = 0; tried < MOVING_STICKER.triesPerDay; tried++) expect(await book.make("p1", "a1", three, [100, 100])).toEqual({ ok: false, error: "not_a_picture" });
    given.length = 0;
    const refused = await book.make("p1", "a1", three, [100, 100, 100]);
    expect(refused).toMatchObject({ ok: false, error: "too_many" });
    expect(!refused.ok && refused.waitMs, "until a day after the first").toBeGreaterThan(23 * 3_600_000);
    expect(given, "sharp was not asked").toHaveLength(0);
    expect((await book.make("p1", "a1", strip(32, 1, () => [200, 10, 10, 255]))).ok, "a still one is not one of those tries").toBe(true);
    expect((await book.make("p2", "a2", three, [100, 100, 100])).ok, "another account has its own").toBe(true);
    now += 24 * 3_600_000 + 1;
    expect((await book.make("p1", "a1", three, [100, 100, 100])).ok, "a day later").toBe(true);
  });

  it("is packed one at a time, each made all the same when several are sent at once", async () => {
    const all = await Promise.all([1, 2, 3, 4].map((n) => makeMovingSticker(strip(32, 3, (frame, x, y) => moving(frame + n, x, y)), [100, 100, 100])));
    expect(all.map((made) => made.ok && pictureType(made.data))).toEqual(["image/webp", "image/webp", "image/webp", "image/webp"]);
    expect(new Set(all.map((made) => made.ok && made.hash)).size).toBe(4);
  });

  it("is read from the body's text without unpacking anything else: exactly what the page sends, or nothing (the judge, 17 Nov)", () => {
    expect(readStickerMake('{"data":"QUJD"}')).toEqual({ data: "QUJD" });
    expect(readStickerMake('{"data":"QUJD","delays":[20,1000,66]}')).toEqual({ data: "QUJD", delays: [20, 1000, 66] });
    expect(readStickerMake('{"data":"QQ=="}')).toEqual({ data: "QQ==" });
    for (const not of [
      '{"data":"","delays":[20,20],"junk":[{},{},{}]}',
      '{"junk":[{}],"data":"QUJD"}',
      '{"delays":[20,20],"data":"QUJD"}',
      '{ "data": "QUJD" }',
      '{"data":"QUJD"} ',
      '{"data":"QU\\"JD"}',
      '{"data":"QU JD"}',
      '{"data":"QUJD","delays":[]}',
      '{"data":"QUJD","delays":[20,20,]}',
      '{"data":"QUJD","delays":[20.5,20]}',
      '{"data":"QUJD","delays":[-20,20]}',
      '{"data":"QUJD","delays":[20,20]}{"data":"QUJD"}',
      `{"data":"QUJD","delays":[${Array(200).fill(20).join(",")}]}`,
      '["QUJD"]',
      "",
    ]) {
      expect(readStickerMake(not), not.slice(0, 60)).toBeUndefined();
    }
    const many = readStickerMake(`{"data":"QUJD","delays":[${Array(MOVING_STICKER.maxFrames + 1).fill(20).join(",")}]}`);
    expect(many?.delays).toHaveLength(MOVING_STICKER.maxFrames + 1);
    expect(StickerMakeSchema.safeParse(many).success).toBe(false);
  });

  it("may be sent bigger than a still one, which may not", () => {
    const long = "A".repeat(PERSONAL_STICKER_BASE64_MAX + 1);
    expect(StickerMakeSchema.safeParse({ data: long }).success).toBe(false);
    expect(StickerMakeSchema.safeParse({ data: long, delays: [100, 100] }).success).toBe(true);
    expect(StickerMakeSchema.safeParse({ data: "A", delays: [100] }).success, "one picture is not one that moves").toBe(false);
    expect(StickerMakeSchema.safeParse({ data: "A", delays: [100, 5000] }).success).toBe(false);
  });
});

describe("what kind of picture is kept", () => {
  it("is read from its first bytes: a WebP, or else a PNG", () => {
    expect(pictureType(Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8X", "latin1"))).toBe("image/webp");
    expect(pictureType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe("image/png");
    expect(pictureType(Buffer.from("RIFF"))).toBe("image/png");
  });
});
