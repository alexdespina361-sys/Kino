import { goodEnoughToOffer, OFFICIAL_MIN_LINES, type OfficialOfferLine } from "../../shared";
import type { Cue } from "./cues";

export interface TimedFile {
  cues: readonly Cue[];
  placed: readonly Cue[];
  solved: ReadonlySet<number>;
  worded: ReadonlySet<number>;
}

const cs = (seconds: number) => Math.max(0, Math.round(seconds * 100));

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
