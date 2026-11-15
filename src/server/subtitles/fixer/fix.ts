import { createHash } from "node:crypto";
import type { OfficialLang } from "../../../shared";
import type { Vad } from "../../../client/subsync/core";
import { CLEAN_RULES, cleanCues } from "../clean";
import { inCueOrder, type VttCue } from "../vtt";
import { checkLine, type Polisher, type Strength } from "./polish";
import { runSeconv } from "./seconv";
import { timeToSound } from "./sync";

/**
 * The subtitle fixer (docs/subtitle-fixer.md): an existing file made better, step by step, every change written down and the file itself
 * kept. The same tidying as a Kino Official file (`clean.ts`), then what is asked for: Subtitle Edit's fixes, the screens' aligner on the
 * film's sound, a language model's wording. Each step can be left out; without any of them it needs nothing but this code.
 */
export const FIXER_VERSION = 1;

export interface FixOptions {
  lang: OfficialLang;
  /** Subtitle Edit's `seconv` (true: found as `SECONV` or on the PATH). */
  seconv?: boolean | string;
  /** The film's sound, from its start (`soundOf` reads it from a file), and the voice detector to hear it with (`sileroVad`). */
  sound?: { pieces: AsyncIterable<Float32Array> | Iterable<Float32Array>; vad: Vad };
  polish?: { polisher: Polisher; strength: Strength; batch?: number };
  log?: (line: string) => void;
}

export interface LineChange {
  /** Line of the fixed file, and of the file it was made from. */
  line: number;
  from: number;
  by: string[];
  before: { start: number; end: number; text: string };
  after: { start: number; end: number; text: string };
}

export interface FixReport {
  v: 1;
  fixer: number;
  cleanRules: number;
  /** sha256 of the file's text, so that the same file is not done twice. */
  source: string;
  lines: { in: number; out: number };
  steps: Array<{ step: string; done: boolean; note: string }>;
  dropped: Array<{ from: number; start: number; text: string }>;
  changes: LineChange[];
  timing?: { placed: number; of: number; shift: number | null; median: number; largest: number; methods: Record<string, number>; heard: number };
  /** Lines of the model's that were turned away, and why. */
  refused: Array<{ line: number; text: string; why: string }>;
}

interface Work extends VttCue {
  from: number;
  by: Set<string>;
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export async function fixSubtitle(source: readonly VttCue[], sourceText: string, options: FixOptions): Promise<{ cues: VttCue[]; report: FixReport }> {
  const log = options.log ?? (() => {});
  const steps: FixReport["steps"] = [];
  const refused: FixReport["refused"] = [];
  let timing: FixReport["timing"];

  // 1. Tidy: credits and advertising, code pages, dashes, spaces (the Kino Official rules).
  const cleaned = cleanCues(source, options.lang);
  let work: Work[] = cleaned.cues.map((cue, i) => {
    const from = cleaned.from[i] as number;
    return { ...cue, from, by: new Set(cue.text !== source[from]!.text ? ["tidy"] : []) };
  });
  steps.push({ step: "tidy", done: true, note: `rules ${CLEAN_RULES}: ${cleaned.dropped.length} left out, ${cleaned.changed} changed` });

  // 2. Subtitle Edit's fixes (its timing ones only when the sound will not time the file).
  if (options.seconv) {
    const done = await runSeconv(work, { lang: options.lang, timing: !options.sound, ...(typeof options.seconv === "string" ? { bin: options.seconv } : {}) });
    if ("failed" in done) steps.push({ step: "subtitle-edit", done: false, note: done.failed });
    else {
      work = work.map((line, i) => mark(line, done.cues[i]!, "subtitle-edit"));
      steps.push({ step: "subtitle-edit", done: true, note: `rules: ${done.rules.join(", ")}` });
    }
    log(`subtitle-edit: ${steps[steps.length - 1]!.note}`);
  }

  // 3. The screens' aligner on the film's sound.
  if (options.sound) {
    const timed = await timeToSound(work, options.sound.pieces, options.sound.vad);
    const moves = timed.cues.map((cue, i) => Math.abs(cue.start - work[i]!.start)).sort((a, b) => a - b);
    timing = {
      placed: timed.placed,
      of: work.length,
      shift: timed.shift === null ? null : round(timed.shift),
      median: round(moves[moves.length >> 1] ?? 0),
      largest: round(moves[moves.length - 1] ?? 0),
      methods: timed.methods,
      heard: Math.round(timed.heard),
    };
    work = work.map((line, i) => mark(line, timed.cues[i]!, "aligner"));
    steps.push({ step: "aligner", done: timed.placed > 0, note: `${timed.placed} of ${work.length} lines placed, shift ${timing.shift ?? "none"} s, median move ${timing.median} s` });
    log(`aligner: ${steps[steps.length - 1]!.note}`);
  }

  // 4. Wording, by a model, line by line with the lines around it; only what passes the checks.
  if (options.polish) {
    const { polisher, strength } = options.polish;
    const size = options.polish.batch ?? 20;
    let taken = 0;
    for (let at = 0; at < work.length; at += size) {
      const lines = work.slice(at, at + size).map((line) => line.text);
      let answer: string[];
      try {
        answer = await polisher.polish({ lang: options.lang, strength, lines, before: work.slice(Math.max(0, at - 3), at).map((l) => l.text), after: work.slice(at + size, at + size + 3).map((l) => l.text) });
      } catch (error) {
        steps.push({ step: "polish", done: false, note: `${polisher.name} failed at line ${at}: ${error instanceof Error ? error.message : String(error)}` });
        break;
      }
      if (answer.length !== lines.length) {
        refused.push({ line: at, text: `${answer.length} lines for ${lines.length}`, why: "not one for one" });
        continue;
      }
      answer.forEach((text, k) => {
        const line = work[at + k]!;
        const tidy = text.replace(/\r\n?/g, "\n").trim();
        if (tidy === line.text) return;
        const why = checkLine(line.text, tidy, options.lang, strength);
        if (why) refused.push({ line: at + k, text: tidy, why });
        else {
          work[at + k] = mark(line, { ...line, text: tidy }, "polish");
          taken++;
        }
      });
    }
    if (!steps.some((s) => s.step === "polish")) steps.push({ step: "polish", done: true, note: `${polisher.name}, ${strength}: ${taken} lines reworded, ${refused.length} turned away` });
  }

  // 5. What every file must be: a line ends after it starts, in the order a browser shows them.
  let mended = 0;
  work = work.map((line) => {
    if (line.end > line.start + 0.05) return line;
    mended++;
    return mark(line, { ...line, end: line.start + Math.min(7, 1 + line.text.length / 17) }, "valid");
  });
  const ordered = inCueOrder(work) as Work[];
  steps.push({ step: "validate", done: true, note: `${mended} lines given an end after their start` });

  const changes: LineChange[] = [];
  ordered.forEach((line, i) => {
    const before = source[line.from]!;
    if (line.by.size === 0 && before.text === line.text && before.start === line.start && before.end === line.end) return;
    changes.push({
      line: i,
      from: line.from,
      by: [...line.by],
      before: { start: round(before.start), end: round(before.end), text: before.text },
      after: { start: round(line.start), end: round(line.end), text: line.text },
    });
  });
  return {
    cues: ordered.map(({ start, end, text }) => ({ start, end, text })),
    report: {
      v: 1,
      fixer: FIXER_VERSION,
      cleanRules: CLEAN_RULES,
      source: sha256(sourceText),
      lines: { in: source.length, out: ordered.length },
      steps,
      dropped: cleaned.dropped.map((from) => ({ from, start: round(source[from]!.start), text: source[from]!.text })),
      changes,
      ...(timing ? { timing } : {}),
      refused,
    },
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** `line` with what `next` has, `step` noted where something changed. */
function mark(line: Work, next: VttCue, step: string): Work {
  const changed = next.text !== line.text || Math.abs(next.start - line.start) > 0.0005 || Math.abs(next.end - line.end) > 0.0005;
  return changed ? { ...line, start: next.start, end: next.end, text: next.text, by: new Set([...line.by, step]) } : line;
}
