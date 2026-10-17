import { describe, expect, it } from "vitest";
import { CueEditor } from "./apply";

const lines = () => [
  { startTime: 10, endTime: 12 },
  { startTime: 20, endTime: 22 },
  { startTime: 30, endTime: 32 },
];

describe("moving subtitle lines", () => {
  it("puts a line where it is said", () => {
    const cues = lines();
    const editor = new CueEditor(cues);
    expect(editor.place(1, 23.5, 25.5, 0)).toBe(true);
    expect(cues[1]).toEqual({ startTime: 23.5, endTime: 25.5 });
    expect(editor.changed).toBe(true);
  });

  it("never lets a line end before it starts on the way", () => {
    const cues = lines();
    const seen: string[] = [];
    const watched = cues.map(
      (cue) =>
        new Proxy(cue, {
          set(target, key, value) {
            (target as Record<string, number>)[key as string] = value as number;
            if (target.endTime < target.startTime) seen.push(`${target.startTime}>${target.endTime}`);
            return true;
          },
        }),
    );
    new CueEditor(watched).place(0, 50, 52, 0);
    expect(seen).toEqual([]);
  });

  it("leaves the line on screen alone until it is gone", () => {
    const cues = lines();
    const editor = new CueEditor(cues);
    expect(editor.place(1, 26, 28, 21)).toBe(false);
    expect(cues[1]).toEqual({ startTime: 20, endTime: 22 });
    editor.flush(21.5);
    expect(cues[1]).toEqual({ startTime: 20, endTime: 22 });
    editor.flush(22.5);
    expect(cues[1]).toEqual({ startTime: 26, endTime: 28 });
  });

  it("moves a line on screen at once when its new place still has it on screen", () => {
    const cues = lines();
    expect(new CueEditor(cues).place(1, 19.5, 22.5, 21)).toBe(true);
    expect(cues[1]).toEqual({ startTime: 19.5, endTime: 22.5 });
  });

  it("restores the file's times", () => {
    const cues = lines();
    const editor = new CueEditor(cues);
    editor.place(0, 11, 13, 0);
    editor.place(2, 40, 42, 0);
    editor.restore();
    expect(cues).toEqual(lines());
    expect(editor.changed).toBe(false);
  });
});
