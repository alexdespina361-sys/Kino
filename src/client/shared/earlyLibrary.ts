const FRESH_MS = 60_000;
let early: { answer: Promise<Response>; at: number } | null = null;

export function askLibraryEarly(): void {
  if (early) return;
  const answer = fetch("/api/library");
  answer.catch(() => undefined);
  early = { answer, at: Date.now() };
}

export function libraryAnswer(init?: RequestInit): Promise<Response> {
  const mine = early;
  early = null;
  if (mine && !init && Date.now() - mine.at < FRESH_MS) return mine.answer;
  return fetch("/api/library", init);
}