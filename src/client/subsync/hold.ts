const held = new WeakSet<object>();

export const isHeld = (track: object): boolean => held.has(track);
export const hold = (track: object): void => void held.add(track);
export const release = (track: object): void => void held.delete(track);

let edits = 0;
export const cuesMoved = (): void => void (edits += 1);

interface TimedCue {
  startTime: number;
  endTime: number;
}
interface CueIndex {
  length: number;
  first: unknown;
  last: unknown;
  edits: number;
  cues: TimedCue[];
  starts: number[];
  longest: number;
}
const indexes = new WeakMap<object, CueIndex>();

export function cuesAt<T extends TimedCue>(owner: object, list: { readonly length: number; readonly [at: number]: T }, time: number, into: T[]): void {
  const length = list.length;
  if (!length) return;
  let index = indexes.get(owner);
  if (!index || index.length !== length || index.first !== list[0] || index.last !== list[length - 1] || index.edits !== edits) {
    const cues = Array.from({ length }, (_, at) => list[at]!).sort((a, b) => a.startTime - b.startTime);
    let longest = 0;
    for (const cue of cues) longest = Math.max(longest, cue.endTime - cue.startTime);
    index = { length, first: list[0], last: list[length - 1], edits, cues, starts: cues.map((cue) => cue.startTime), longest };
    indexes.set(owner, index);
  }
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.starts[mid]! <= time) lo = mid + 1;
    else hi = mid;
  }
  let from = lo;
  while (from > 0 && index.starts[from - 1]! >= time - index.longest) from--;
  for (let at = from; at < lo; at++) if (time < index.cues[at]!.endTime) into.push(index.cues[at] as T);
}

const unlabelled = new WeakSet<object>();

export const hasNoLanguage = (track: object): boolean => unlabelled.has(track);
export const markNoLanguage = (track: object): void => void unlabelled.add(track);
