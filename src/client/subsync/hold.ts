const held = new WeakSet<object>();

export const isHeld = (track: object): boolean => held.has(track);
export const hold = (track: object): void => void held.add(track);
export const release = (track: object): void => void held.delete(track);

const unlabelled = new WeakSet<object>();

export const hasNoLanguage = (track: object): boolean => unlabelled.has(track);
export const markNoLanguage = (track: object): void => void unlabelled.add(track);
