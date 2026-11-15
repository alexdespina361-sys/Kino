import { goodEnoughToOffer, OFFICIAL_MIN_LINES, type OfficialOfferLine } from "../../shared";
import type { Cue } from "./cues";

/** What a screen knows of a file it has timed, as far as an offer goes (see `shared/official.ts`). */
export interface TimedFile {
  /** The lines as the file has them. */
  cues: readonly Cue[];
  /** Where each line is on the film now. */
  placed: readonly Cue[];
  /** Lines placed by a solve, or taken from a timing another screen left once it was believed. */
  solved: ReadonlySet<number>;
  /** Lines placed by the recogniser's words: this screen's own, and those of a believed timing that had words. */
  worded: ReadonlySet<number>;
}

const cs = (seconds: number) => Math.max(0, Math.round(seconds * 100));

/** The lines of an offer of the file, or nothing while the file is not timed well enough to make a Kino Official subtitle of. */
export function offerLines(file: TimedFile): OfficialOfferLine[] | undefined {
  if (file.cues.length < OFFICIAL_MIN_LINES) return undefined;
  const lines = file.cues.map((cue, index): OfficialOfferLine => {
    const at = file.placed[index];
    if (!at || !file.solved.has(index)) return null;
    const start = cs(at.start);
    return [cs(cue.start), start, Math.max(start + 1, cs(at.end)), file.worded.has(index) ? 1 : 0];
  });
  return goodEnoughToOffer(lines) ? lines : undefined;
}
