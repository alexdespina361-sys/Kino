import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { VttCue } from "../vtt";
import { readSubtitle, toSrt } from "./formats";

const run = promisify(execFile);

/**
 * Subtitle Edit's "Fix common errors" (MIT, https://github.com/SubtitleEdit/subtitleedit), run as its own program (`seconv`, v5.4.0 checked).
 * Only rules that mend a line's text or its time on screen, never ones that add, join or drop lines: the fixer keeps every line of the file
 * matched to the file's own (its report, and the aligner, go by line). Names as `seconv list-fce-rules` prints them.
 */
export const SECONV_RULES = [
  "FixMissingSpaces",
  "FixUnneededSpaces",
  "FixCommas",
  "FixDoubleApostrophes",
  "FixDoubleGreaterThan",
  "FixInvalidItalicTags",
  "FixUppercaseIInsideWords",
  "FixAloneLowercaseIToUppercaseI",
  "FixDialogsOnOneLine",
  "Fix3PlusLines",
  "FixLongLines",
  "FixShortLines",
] as const;
/** The timing rules: for a file the aligner does not time (its own timing is better than these guesses, so they run before it). */
export const SECONV_TIMING_RULES = ["FixOverlappingDisplayTimes", "FixShortDisplayTimes", "FixLongDisplayTimes", "FixShortGaps"] as const;

export interface SeconvOptions {
  /** The `seconv` program (else `SECONV` from the environment, else `seconv` on the PATH). */
  bin?: string;
  lang: string;
  timing: boolean;
}

export interface SeconvResult {
  cues: VttCue[];
  /** The rules it was asked to run. */
  rules: string[];
}

export function seconvBin(bin?: string): string {
  return bin ?? process.env.SECONV ?? "seconv";
}

/** The lines as Subtitle Edit leaves them; undefined (and a reason) when it could not run or did not keep the lines one for one. */
export async function runSeconv(cues: readonly VttCue[], options: SeconvOptions): Promise<SeconvResult | { failed: string }> {
  const rules = [...SECONV_RULES, ...(options.timing ? SECONV_TIMING_RULES : [])];
  const dir = await mkdtemp(path.join(tmpdir(), "kino-seconv-"));
  try {
    await writeFile(path.join(dir, "in.srt"), toSrt(cues), "utf8");
    const args = [
      "in.srt",
      "subrip",
      `--input-folder:${dir}`,
      `--output-folder:${dir}`,
      "--output-filename:out.srt",
      "--overwrite",
      "--encoding:utf-8",
      `--fce-language:${options.lang}`,
      `--fix-common-errors-rules:${rules.join(",")}`,
    ];
    try {
      await run(seconvBin(options.bin), args, { timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      return { failed: `seconv did not run: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
    }
    const out = readSubtitle(await readFile(path.join(dir, "out.srt"), "utf8"), "srt");
    if (out.length !== cues.length) return { failed: `seconv made ${out.length} lines of ${cues.length}: left out` };
    return { cues: out, rules };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
