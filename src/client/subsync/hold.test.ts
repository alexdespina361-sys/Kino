import { describe, expect, it } from "vitest";
import { CueEditor } from "./apply";
import { CHECK_EVERY, cuesAt } from "./hold";

type Cue = { startTime: number; endTime: number; id: number };
const scan = (cues: Cue[], time: number) => cues.filter((cue) => cue.startTime <= time && time < cue.endTime);
const found = (owner: object, cues: Cue[], time: number) => {
  const into: Cue[] = [];
  cuesAt(owner, cues, time, into);
  return into;
};
const random = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

describe("the cues on screen at a time", () => {
  it("are the ones a full scan finds, overlaps and long cues included, in start order", () => {
    const next = random(7);
    const cues: Cue[] = [];
    for (let id = 0; id < 600; id++) {
      const startTime = Math.round(next() * 3000 * 10) / 10;
      cues.push({ id, startTime, endTime: startTime + (next() < 0.05 ? 120 : 0.5 + next() * 6) });
    }
    cues.sort((a, b) => a.startTime - b.startTime);
    const owner = {};
    for (let i = 0; i < 400; i++) {
      const time = next() * 3100;
      expect(found(owner, cues, time).map((cue) => cue.id)).toEqual(scan(cues, time).map((cue) => cue.id));
    }
    expect(found(owner, cues, cues[10]!.startTime)).toEqual(scan(cues, cues[10]!.startTime));
    expect(found(owner, cues, cues[10]!.endTime).includes(cues[10]!)).toBe(false);
  });

  it("follow cues that arrive later and cues the aligner moves", () => {
    const cues: Cue[] = [
      { id: 1, startTime: 1, endTime: 3 },
      { id: 2, startTime: 5, endTime: 7 },
    ];
    const owner = {};
    expect(found(owner, cues, 6).map((cue) => cue.id)).toEqual([2]);
    cues.push({ id: 3, startTime: 6, endTime: 9 });
    expect(found(owner, cues, 6.5).map((cue) => cue.id)).toEqual([2, 3]);
    const editor = new CueEditor(cues);
    editor.flush(0);
    (editor as unknown as { write: (cue: Cue, start: number, end: number) => void }).write(cues[0]!, 6.2, 6.8);
    expect(found(owner, cues, 6.5).map((cue) => cue.id).sort()).toEqual([1, 2, 3]);
    expect(found(owner, cues, 2)).toEqual([]);
  });

  it("follow cues removed from the front (the stream's own, behind the picture) and added back on a seek", () => {
    const cues: Cue[] = Array.from({ length: 6 }, (_, id) => ({ id, startTime: id * 4, endTime: id * 4 + 3 }));
    const owner = {};
    expect(found(owner, cues, 1).map((cue) => cue.id)).toEqual([0]);
    const dropped = cues.splice(0, 3);
    expect(found(owner, cues, 1)).toEqual([]);
    expect(found(owner, cues, 13).map((cue) => cue.id)).toEqual([3]);
    cues.unshift(...dropped);
    expect(found(owner, cues, 1).map((cue) => cue.id)).toEqual([0]);
  });

  it("notice within a second a cue swapped in the middle, or moved by code that does not say so", () => {
    const cues: Cue[] = [
      { id: 1, startTime: 1, endTime: 3 },
      { id: 2, startTime: 5, endTime: 7 },
      { id: 3, startTime: 9, endTime: 11 },
    ];
    const owner = {};
    expect(found(owner, cues, 6).map((cue) => cue.id)).toEqual([2]);
    cues[1] = { id: 4, startTime: 5.5, endTime: 7.5 };
    let seen: number[] = [];
    for (let asked = 0; asked < CHECK_EVERY && !seen.includes(4); asked++) seen = found(owner, cues, 6).map((cue) => cue.id);
    expect(seen).toEqual([4]);
    cues[2]!.startTime = 6;
    for (let asked = 0; asked < CHECK_EVERY && !seen.includes(3); asked++) seen = found(owner, cues, 6.5).map((cue) => cue.id);
    expect(seen).toEqual([4, 3]);
  });

  it("are none in an empty list, before the first cue and after the last", () => {
    expect(found({}, [], 5)).toEqual([]);
    const cues: Cue[] = [{ id: 1, startTime: 4, endTime: 5 }];
    expect(found({}, cues, 3.9)).toEqual([]);
    expect(found({}, cues, 5)).toEqual([]);
  });
});
