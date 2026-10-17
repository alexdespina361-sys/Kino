/**
 * Subtitle tracks that are loaded but not shown yet: another release being tried out, or the English track that a track in another
 * language is timed from. They are "hidden" like the track on screen (that is what makes the browser load a track), so the player's
 * own code has to know which hidden track is the one on screen: `Captions` skips these and the engine does not report them as chosen.
 */
const held = new WeakSet<object>();

export const isHeld = (track: object): boolean => held.has(track);
export const hold = (track: object): void => void held.add(track);
export const release = (track: object): void => void held.delete(track);

/**
 * Subtitle tracks that the provider gave no language for. The page labels them "en", because a track must have a language, but that is
 * not known to be so, and the aligner must not take them for English: it would weigh a Romanian file against English speech, find it
 * wrong and replace it with an English one.
 */
const unlabelled = new WeakSet<object>();

export const hasNoLanguage = (track: object): boolean => unlabelled.has(track);
export const markNoLanguage = (track: object): void => void unlabelled.add(track);
