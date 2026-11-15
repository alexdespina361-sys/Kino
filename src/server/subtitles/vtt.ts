/** One subtitle line: seconds, and its text with its markup (lines joined by "\n"), as a browser's cue has them. */
export interface VttCue {
  start: number;
  end: number;
  text: string;
}

/** `hh:mm:ss.ttt` or `mm:ss.ttt`, as WebVTT writes a time (a browser drops a cue whose time is written otherwise). */
const TIME = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;

function seconds(text: string): number | undefined {
  const match = TIME.exec(text);
  if (!match) return undefined;
  const [, hours, minutes, secs, millis] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs) + Number(millis) / 1000;
}

/**
 * The cues of a WebVTT file, in its order, read the way a browser reads them (the WebVTT parser of the HTML standard, as far as subtitle
 * files go): blocks apart by an empty line, a block with "-->" in its first or second line is a cue, a cue whose times are written wrong is
 * left out. What a screen counts as line 7 is line 7 here, which is what an offer's lines are matched by (see `shared/official.ts`).
 */
export function parseVtt(file: string): VttCue[] {
  const lines = file.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? "")) return [];
  const cues: VttCue[] = [];
  let i = 1;
  // (The header goes on to the first empty line.)
  while (i < lines.length && lines[i] !== "") i++;
  while (i < lines.length) {
    while (i < lines.length && lines[i] === "") i++;
    if (i >= lines.length) break;
    const block: string[] = [];
    while (i < lines.length && lines[i] !== "") block.push(lines[i++] as string);
    const timingAt = block[0]?.includes("-->") ? 0 : block[1]?.includes("-->") ? 1 : -1;
    if (timingAt < 0) continue; // (a note, a style, a region, or a block that is no cue)
    const timing = (block[timingAt] as string).trim().split(/[ \t]+/);
    const start = seconds(timing[0] ?? "");
    const end = timing[1] === "-->" ? seconds(timing[2] ?? "") : undefined;
    if (start === undefined || end === undefined) continue;
    // (A line of the text with "-->" in it ends the cue there, as in a browser.)
    const text: string[] = [];
    for (const line of block.slice(timingAt + 1)) {
      if (line.includes("-->")) break;
      text.push(line);
    }
    cues.push({ start, end, text: text.join("\n") });
  }
  return cues;
}

/**
 * The cues in the order a browser's `track.cues` lists them (the HTML standard's "text track cue order"): by start, earliest first; with the
 * same start, the one that ends latest first; else in the file's order. A screen numbers a file's lines in this order.
 */
export function inCueOrder(cues: readonly VttCue[]): VttCue[] {
  return cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.start - b.cue.start || b.cue.end - a.cue.end || a.index - b.index)
    .map(({ cue }) => cue);
}

function stamp(at: number): string {
  const ms = Math.max(0, Math.round(at * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/** A WebVTT file of these cues. A line of text that is empty, or has "-->" in it, would end the cue early: it is left out. */
export function toVtt(cues: readonly VttCue[], note?: string): string {
  const out = ["WEBVTT", ""];
  if (note) out.push(`NOTE ${note.replace(/\r?\n/g, " ").replace(/-->/g, "->")}`, "");
  for (const cue of cues) {
    const text = cue.text
      .split("\n")
      .map((line) => line.replace(/-->/g, "->"))
      .filter((line) => line.trim() !== "");
    if (text.length === 0) continue;
    out.push(`${stamp(cue.start)} --> ${stamp(cue.end)}`, ...text, "");
  }
  return out.join("\n");
}
