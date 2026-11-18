export interface VttCue {
  start: number;
  end: number;
  text: string;
}

const TIME = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;

function seconds(text: string): number | undefined {
  const match = TIME.exec(text);
  if (!match) return undefined;
  const [, hours, minutes, secs, millis] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs) + Number(millis) / 1000;
}

export function parseVtt(file: string): VttCue[] {
  const lines = file.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? "")) return [];
  const cues: VttCue[] = [];
  let i = 1;
  while (i < lines.length && lines[i] !== "") i++;
  while (i < lines.length) {
    while (i < lines.length && lines[i] === "") i++;
    if (i >= lines.length) break;
    const block: string[] = [];
    while (i < lines.length && lines[i] !== "") block.push(lines[i++] as string);
    const timingAt = block[0]?.includes("-->") ? 0 : block[1]?.includes("-->") ? 1 : -1;
    if (timingAt < 0) continue;
    const timing = (block[timingAt] as string).trim().split(/[ \t]+/);
    const start = seconds(timing[0] ?? "");
    const end = timing[1] === "-->" ? seconds(timing[2] ?? "") : undefined;
    if (start === undefined || end === undefined) continue;
    const text: string[] = [];
    for (const line of block.slice(timingAt + 1)) {
      if (line.includes("-->")) break;
      text.push(line);
    }
    cues.push({ start, end, text: text.join("\n") });
  }
  return cues;
}

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
