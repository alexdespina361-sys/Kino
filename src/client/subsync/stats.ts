/**
 * What the subtitle aligner has done on this page, for the `?debug` panel (a TV that nobody on the team can hold: see shared/debug.ts).
 * A page plays one film at a time, so there is one set of numbers; `SyncSession` writes them, as plain assignments.
 */
const fresh = () => ({
  /** A session has started on this page (until then the panel says nothing of the aligner). */
  started: false,
  status: "",
  /** Pieces of the film's sound the tap handed over, and the seconds of it that were decoded (and how long that took, in ms). */
  pieces: 0,
  decodedSeconds: 0,
  decodeMs: 0,
  /** Seconds of sound the voice detector went through (and how long that took, in ms). */
  vadSeconds: 0,
  vadMs: 0,
  recogniser: "none" as "none" | "starting" | "running" | "failed" | "stopped" | "not needed",
  /** Windows the recogniser heard, the words in them, and how many seconds of sound it got through per second (the last windows). */
  windows: 0,
  words: 0,
  heardSeconds: 0,
  speed: 0,
  /** Solves done, and of the track on screen: the lines placed by them and the lines it has. */
  solves: 0,
  placed: 0,
  lines: 0,
  /** Tests of the track on screen against the words (the last one's verdict and share), tracks switched to, and whether it is timed from an English one. */
  tests: 0,
  verdict: "",
  share: 0,
  switches: 0,
  bridged: false,
  /** Where the timing that other screens left for the track on screen stands (empty when there is no server to ask), and how many lines this screen has left for them. */
  shared: "",
  sent: 0,
  /** Why the aligner gave up on this film, if it did. */
  gaveUp: "",
});

export const alignerStats = fresh();
export type AlignerStats = typeof alignerStats;

/** A new film: the numbers start again. */
export function resetAlignerStats(): void {
  Object.assign(alignerStats, fresh());
}

/** The aligner's doings in a line, or null while it has not started (this page plays nothing the aligner works on). */
export function describeAligner(stats: AlignerStats): string | null {
  if (!stats.started) return null;
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const parts = [
    `aligner: ${stats.status || "starting"}${stats.gaveUp ? ` (${stats.gaveUp})` : ""}`,
    `sound ${stats.pieces} pieces, ${Math.round(stats.decodedSeconds)}s decoded in ${seconds(stats.decodeMs)}, ${Math.round(stats.vadSeconds)}s through the voice detector in ${seconds(stats.vadMs)}`,
    `recogniser ${stats.recogniser}: ${stats.words} words, ${stats.windows} windows (${Math.round(stats.heardSeconds)}s)${stats.speed > 0 ? ` at ${stats.speed.toFixed(1)}x` : ""}`,
    `solves ${stats.solves}, ${stats.placed}/${stats.lines} lines placed${stats.bridged ? " (from the English track)" : ""}`,
    `tests ${stats.tests}${stats.verdict ? `: ${stats.verdict} ${stats.share.toFixed(2)}` : ""}, switches ${stats.switches}`,
    ...(stats.shared ? [`shared timing: ${stats.shared}${stats.sent > 0 ? `, left ${stats.sent} lines` : ""}`] : []),
  ];
  return parts.join("  ");
}
