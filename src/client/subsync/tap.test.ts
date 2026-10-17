import { describe, expect, it } from "vitest";
import { AudioTap, type Piece } from "./tap";

type Listener = (event: string, data: never) => void;

class FakeHls {
  private readonly listeners = new Map<string, Set<Listener>>();
  on(event: string, listener: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
  }
  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach((listener) => listener(event, data as never));
  }
  count(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

const EVENT = "hlsBufferAppending";
const bytes = (...values: number[]) => Uint8Array.from(values);
/** An MP4 header's first bytes: a box size, then its name. */
const initSegment = (name: string, ...rest: number[]) => Uint8Array.from([0, 0, 0, 24, ...[...name].map((c) => c.charCodeAt(0)), ...rest]);
const frag = (start: number, duration = 5, streams?: Record<string, { startPTS: number; endPTS: number }>) => ({ start, duration, elementaryStreams: streams });

/** A tap with someone taking the pieces. */
function setup() {
  const hls = new FakeHls();
  const pieces: Piece[] = [];
  const tap = new AudioTap(hls, EVENT);
  tap.connect((piece) => pieces.push(piece));
  return { hls, pieces, tap };
}
const media = bytes(0, 0, 0, 9, 109, 111, 111, 102, 7);

describe("the audio tap", () => {
  it("hands out each audio piece with the init segment that came before it", () => {
    const { hls, pieces } = setup();
    hls.emit(EVENT, { type: "audio", data: initSegment("ftyp", 1), frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: bytes(0, 0, 0, 9, 109, 111, 111, 102, 7), frag: frag(0) });
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.init[8]).toBe(1);
    expect(pieces[0]?.data[8]).toBe(7);
  });

  it("times a piece by the audio's own clock, else by the fragment's", () => {
    const { hls, pieces } = setup();
    hls.emit(EVENT, { type: "audio", data: initSegment("moov"), frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: bytes(0, 0, 0, 9, 109, 111, 111, 102), frag: frag(10, 5, { audio: { startPTS: 10.02, endPTS: 15.01 } }) });
    hls.emit(EVENT, { type: "audio", data: bytes(0, 0, 0, 9, 109, 111, 111, 102), frag: frag(15, 6) });
    expect(pieces.map((p) => [p.start, p.end])).toEqual([
      [10.02, 15.01],
      [15, 21],
    ]);
  });

  it("copies the bytes, because hls.js gives them on to the player afterwards", () => {
    const { hls, pieces } = setup();
    const init = initSegment("ftyp", 0);
    const data = bytes(0, 0, 0, 9, 109, 111, 111, 102, 5);
    hls.emit(EVENT, { type: "audio", data: init, frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data, frag: frag(0) });
    data[8] = 99;
    init[8] = 99;
    expect(pieces[0]?.data[8]).toBe(5);
    expect(pieces[0]?.init[8]).toBe(0);
  });

  it("takes muxed pieces (picture and sound together) and not picture alone", () => {
    const { hls, pieces } = setup();
    hls.emit(EVENT, { type: "video", data: initSegment("ftyp"), frag: frag(0) });
    hls.emit(EVENT, { type: "video", data: bytes(0, 0, 0, 9, 109, 111, 111, 102), frag: frag(0) });
    hls.emit(EVENT, { type: "audiovideo", data: initSegment("ftyp"), frag: frag(0) });
    hls.emit(EVENT, { type: "audiovideo", data: bytes(0, 0, 0, 9, 109, 111, 111, 102), frag: frag(0) });
    expect(pieces).toHaveLength(1);
  });

  it("ignores a piece that has no init segment", () => {
    const { hls, pieces } = setup();
    hls.emit(EVENT, { type: "audio", data: bytes(0, 0, 0, 9, 109, 111, 111, 102), frag: frag(0) });
    expect(pieces).toHaveLength(0);
  });

  it("uses the newest init segment for the pieces after it", () => {
    const { hls, pieces } = setup();
    hls.emit(EVENT, { type: "audio", data: initSegment("ftyp", 1), frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: bytes(0, 0, 0, 9, 109, 111, 111, 102), frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: initSegment("ftyp", 2), frag: frag(5) });
    hls.emit(EVENT, { type: "audio", data: bytes(0, 0, 0, 9, 109, 111, 111, 102), frag: frag(5) });
    expect(pieces.map((p) => p.init[8])).toEqual([1, 2]);
  });

  it("stops listening when stopped", () => {
    const { hls, pieces, tap } = setup();
    tap.stop();
    expect(hls.count(EVENT)).toBe(0);
    hls.emit(EVENT, { type: "audio", data: initSegment("ftyp"), frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(0) });
    expect(pieces).toHaveLength(0);
  });
});

describe("the audio tap between one aligner and the next", () => {
  it("learns the init segments with nobody taking the pieces, and gives them to the one that comes later in the film", () => {
    const hls = new FakeHls();
    const tap = new AudioTap(hls, EVENT);
    hls.emit(EVENT, { type: "audio", data: initSegment("ftyp", 3), frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(0) }); // (nobody takes this one)
    const pieces: Piece[] = [];
    tap.connect((piece) => pieces.push(piece));
    expect(pieces).toHaveLength(0);
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(5) });
    expect(pieces.map((piece) => [piece.start, piece.init[8]])).toEqual([[5, 3]]);
  });

  it("keeps the init segments when the aligner lets go, and for the next one", () => {
    const { hls, pieces, tap } = setup();
    hls.emit(EVENT, { type: "audio", data: initSegment("ftyp", 4), frag: frag(0) });
    tap.disconnect();
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(0) });
    expect(pieces).toHaveLength(0);
    const again: Piece[] = [];
    tap.connect((piece) => again.push(piece));
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(5) });
    expect(again.map((piece) => piece.init[8])).toEqual([4]);
  });

  it("keeps the first pieces for an aligner that is on its way, and hands them over before the next ones", () => {
    const hls = new FakeHls();
    const tap = new AudioTap(hls, EVENT);
    tap.keep(true);
    hls.emit(EVENT, { type: "audio", data: initSegment("ftyp"), frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(5) });
    const pieces: Piece[] = [];
    tap.connect((piece) => pieces.push(piece));
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(10) });
    expect(pieces.map((piece) => piece.start)).toEqual([0, 5, 10]);
    // (Nothing is kept any more once someone takes the pieces, and nothing is handed over twice.)
    tap.disconnect();
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(15) });
    tap.connect((piece) => pieces.push(piece));
    expect(pieces.map((piece) => piece.start)).toEqual([0, 5, 10]);
  });

  it("lets what it kept go when the aligner is not coming, and keeps no more than a limit", () => {
    const hls = new FakeHls();
    const tap = new AudioTap(hls, EVENT);
    tap.keep(true);
    hls.emit(EVENT, { type: "audio", data: initSegment("ftyp"), frag: frag(0) });
    hls.emit(EVENT, { type: "audio", data: media, frag: frag(0) });
    tap.keep(false);
    const pieces: Piece[] = [];
    tap.connect((piece) => pieces.push(piece));
    expect(pieces).toHaveLength(0);

    tap.disconnect();
    tap.keep(true);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set([0, 0, 0, 9, 109, 111, 111, 102]);
    for (let i = 0; i < 5; i++) hls.emit(EVENT, { type: "audio", data: big, frag: frag(i * 5) });
    tap.connect((piece) => pieces.push(piece));
    // (16 MB: the first two and a half of the pieces of 6 MB, so two. The later ones are let go.)
    expect(pieces.map((piece) => piece.start)).toEqual([0, 5]);
  });
});
