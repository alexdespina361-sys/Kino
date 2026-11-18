export interface Cue {
  start: number;
  end: number;
  text: string;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };

export function plainText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|lrm|rlm);/g, (_, name: string) => entities[name] ?? "");
}

export const isMusic = (cue: Cue): boolean => /[♪♫]/.test(cue.text);
