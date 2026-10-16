/**
 * How close to the end of an episode the next one is looked up and its first pieces are fetched, in seconds. Far enough ahead for both to be
 * done when the Up Next card (the last 15 seconds) counts down, and near enough that nobody who stops halfway has paid for them: they used
 * to be fetched when an episode began, which cost every episode that was not watched to its end the lookup and a few megabytes of film.
 */
export const PRELOAD_NEXT_WITHIN_S = 120;

/** Whether the picture is a known length and has come within `PRELOAD_NEXT_WITHIN_S` of its end (a short one is within it from the start). */
export function nearTheEnd(position: number, duration: number): boolean {
  return duration > 30 && position >= duration - PRELOAD_NEXT_WITHIN_S;
}
