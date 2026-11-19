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
  asked: number;
  order: TimedCue[];
  times: number[];
  cues: TimedCue[];
  starts: number[];
  longest: number;
}
const indexes = new WeakMap<object, CueIndex>();
export const CHECK_EVERY = 8;

function unchanged(index: CueIndex, list: { readonly length: number; readonly [at: number]: TimedCue }): boolean {
  for (let at = 0; at < index.length; at++) {
    const cue = list[at]!;
    if (cue !== index.order[at] || cue.startTime !== index.times[2 * at] || cue.endTime !== index.times[2 * at + 1]) return false;
  }
  return true;
}

export function cuesAt<T extends TimedCue>(owner: object, list: { readonly length: number; readonly [at: number]: T }, time: number, into: T[]): void {
  const length = list.length;
  if (!length) return;
  let index = indexes.get(owner);
  if (index && ++index.asked % CHECK_EVERY === 0 && index.length === length && !unchanged(index, list)) index = undefined;
  if (!index || index.length !== length || index.first !== list[0] || index.last !== list[length - 1] || index.edits !== edits) {
    const order = Array.from({ length }, (_, at) => list[at]!);
    const times = order.flatMap((cue) => [cue.startTime, cue.endTime]);
    const cues = [...order].sort((a, b) => a.startTime - b.startTime);
    let longest = 0;
    for (const cue of cues) longest = Math.max(longest, cue.endTime - cue.startTime);
    index = { length, first: list[0], last: list[length - 1], edits, asked: 0, order, times, cues, starts: cues.map((cue) => cue.startTime), longest };
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
