import { inCueOrder, parseVtt, toVtt, type VttCue } from "../vtt";

/** The kinds of subtitle file the fixer reads. Pictures of text (PGS, VobSub) are Subtitle Edit's OCR's, not ours. */
export type SubtitleFormat = "srt" | "vtt" | "ass";

/** A file's bytes as text: UTF-8 when they are, else the code page such files of that language are written in. */
export function decodeSubtitle(bytes: Uint8Array, lang: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder(lang === "ro" ? "windows-1250" : "windows-1252").decode(bytes);
  }
}

export function formatOf(text: string, name = ""): SubtitleFormat {
  if (/^﻿?WEBVTT/.test(text) || /\.vtt$/i.test(name)) return "vtt";
  if (/^\s*\[Script Info\]/im.test(text) || /\[Events\]/i.test(text) || /\.(ass|ssa)$/i.test(name)) return "ass";
  return "srt";
}

/** `0:01:02,5` and `00:01:02.500` alike, as WebVTT writes a time. */
function srtTimesToVtt(text: string): string {
  return text.replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g, (_, h: string, m: string, s: string, ms: string) => `${h.padStart(2, "0")}:${m}:${s}.${ms.padEnd(3, "0")}`);
}

/** ASS's `H:MM:SS.cc`. */
function assTime(text: string): number | undefined {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(text.trim());
  if (!match) return undefined;
  const [, h, m, s, frac] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${frac}`);
}

/** The dialogue of an ASS/SSA file: its italics kept as `<i>`, its other override tags, drawings and comments left out. */
function readAss(text: string): VttCue[] {
  const cues: VttCue[] = [];
  let fields: string[] | undefined;
  let inEvents = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = /^\[Events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^Format\s*:/i.test(line)) {
      fields = line.replace(/^Format\s*:/i, "").split(",").map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue\s*:/i.test(line) || !fields) continue;
    const values = line.replace(/^Dialogue\s*:/i, "").split(",");
    // (The text is the last field and may itself hold commas.)
    const textAt = fields.indexOf("text");
    const parts = [...values.slice(0, textAt), values.slice(textAt).join(",")];
    const start = assTime(parts[fields.indexOf("start")] ?? "");
    const end = assTime(parts[fields.indexOf("end")] ?? "");
    let body = parts[textAt] ?? "";
    if (start === undefined || end === undefined) continue;
    // (A drawing, `{\p1}...`, is shapes, not words.)
    if (/\{[^}]*\\p[1-9]/.test(body)) continue;
    body = body
      .replace(/\{[^}]*\\i1[^}]*\}/g, "<i>")
      .replace(/\{[^}]*\\i0[^}]*\}/g, "</i>")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ");
    if (body.trim()) cues.push({ start, end, text: body });
  }
  return cues;
}

/** The lines of a subtitle file in the order a browser lists them (SRT and VTT read the way the screens read them: see `parseVtt`). */
export function readSubtitle(text: string, format: SubtitleFormat = formatOf(text)): VttCue[] {
  if (format === "ass") return inCueOrder(readAss(text));
  if (format === "vtt") return inCueOrder(parseVtt(text));
  return inCueOrder(parseVtt(`WEBVTT\n\n${srtTimesToVtt(text.replace(/^﻿/, "").trim())}`));
}

function srtStamp(at: number): string {
  const ms = Math.max(0, Math.round(at * 1000));
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor((ms % 3_600_000) / 60_000))}:${pad(Math.floor((ms % 60_000) / 1000))},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: readonly VttCue[]): string {
  const out: string[] = [];
  let n = 0;
  for (const cue of cues) {
    const text = cue.text.split("\n").filter((line) => line.trim() !== "");
    if (text.length === 0) continue;
    out.push(String(++n), `${srtStamp(cue.start)} --> ${srtStamp(cue.end)}`, ...text, "");
  }
  return out.join("\r\n");
}

export function writeSubtitle(cues: readonly VttCue[], format: "srt" | "vtt", note?: string): string {
  return format === "vtt" ? toVtt(cues, note) : toSrt(cues);
}
