/**
 * The library's first rows, asked for as a TV's page starts (main.tsx) instead of once the TV's code has come down and drawn its first screen: the
 * download of the list and the download of the code go side by side, and the first rows wait for one of them less (measured 18 Nov on a slow TV's CPU).
 * The answer is handed once, to the first that asks for it within a minute; any other ask (Retry, after a video that failed, a page opened later) goes to
 * the server as it always did.
 */
const FRESH_MS = 60_000;
let early: { answer: Promise<Response>; at: number } | null = null;

/** Asks the server for the library now, to be taken by `libraryAnswer`. */
export function askLibraryEarly(): void {
  if (early) return;
  const answer = fetch("/api/library");
  answer.catch(() => undefined); // (a failure is the taker's to see, or nobody's)
  early = { answer, at: Date.now() };
}

/** The answer to `fetch("/api/library", init)`: the one asked for early when there is one still fresh and nothing special is asked, else a new one. */
export function libraryAnswer(init?: RequestInit): Promise<Response> {
  const mine = early;
  early = null;
  if (mine && !init && Date.now() - mine.at < FRESH_MS) return mine.answer;
  return fetch("/api/library", init);
}