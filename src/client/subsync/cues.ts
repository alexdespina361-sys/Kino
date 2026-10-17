/** One subtitle line: seconds (in the file's own time before it is aligned, in the video's after) and the text with its markup. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };

/** The few entities WebVTT allows, decoded (the aligner would otherwise "hear" `amp`). The markup is left: the aligner skips it itself. */
export function plainText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|lrm|rlm);/g, (_, name: string) => entities[name] ?? "");
}

/** A line of song: sung words are heard by the recogniser but sit in the subtitles of any other language too, so they prove nothing about a track. */
export const isMusic = (cue: Cue): boolean => /[♪♫]/.test(cue.text);
