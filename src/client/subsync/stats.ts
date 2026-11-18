const fresh = () => ({
  started: false,
  status: "",
  pieces: 0,
  decodedSeconds: 0,
  decodeMs: 0,
  vadSeconds: 0,
  vadMs: 0,
  recogniser: "none" as "none" | "starting" | "running" | "failed" | "stopped" | "not needed",
  windows: 0,
  words: 0,
  heardSeconds: 0,
  speed: 0,
  hearMs: 0,
  solves: 0,
  solveMs: 0,
  placed: 0,
  lines: 0,
  methods: {} as Record<string, number>,
  tests: 0,
  verdict: "",
  share: 0,
  switches: 0,
  bridged: false,
  shared: "",
  sent: 0,
  offered: 0,
  gaveUp: "",
  sound: "",
  heard: "",
  covered: "",
  lost: "",
});

export function spans(ranges: ReadonlyArray<{ from: number; to: number }>): string {
  return ranges.map((range) => `${Math.floor(range.from)}-${Math.ceil(range.to)}`).join(" ");
}

export const alignerStats = fresh();
export type AlignerStats = typeof alignerStats;

export function resetAlignerStats(): void {
  Object.assign(alignerStats, fresh());
}

const METHOD_NAMES: Record<string, string> = { "whistle+silero": "words", dub: "dub", silero: "voice" };

export function describeAligner(stats: AlignerStats): string | null {
  if (!stats.started) return null;
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const ways = Object.entries(stats.methods)
    .filter(([, count]) => count > 0)
    .map(([method, count]) => `${METHOD_NAMES[method] ?? method} ${count}`)
    .join(", ");
  const parts = [
    `aligner: ${stats.status || "starting"}${stats.gaveUp ? ` (${stats.gaveUp})` : ""}`,
    `sound ${stats.pieces} pieces, ${Math.round(stats.decodedSeconds)}s decoded in ${seconds(stats.decodeMs)}, ${Math.round(stats.vadSeconds)}s through the voice detector in ${seconds(stats.vadMs)}`,
    `recogniser ${stats.recogniser}: ${stats.words} words, ${stats.windows} windows (${Math.round(stats.heardSeconds)}s)${stats.speed > 0 ? ` at ${stats.speed.toFixed(1)}x` : ""}${stats.hearMs > 0 ? ` in ${seconds(stats.hearMs)}` : ""}`,
    `solves ${stats.solves}${ways ? ` (${ways})` : ""}${stats.solveMs > 0 ? ` in ${seconds(stats.solveMs)}` : ""}, ${stats.placed}/${stats.lines} lines placed${stats.bridged ? " (from the English track)" : ""}`,
    `tests ${stats.tests}${stats.verdict ? `: ${stats.verdict} ${stats.share.toFixed(2)}` : ""}, switches ${stats.switches}`,
    ...(stats.shared ? [`shared timing: ${stats.shared}${stats.sent > 0 ? `, left ${stats.sent} lines` : ""}`] : []),
    ...(stats.offered > 0 ? [`offered for Kino Official ${stats.offered}`] : []),
    ...(stats.sound || stats.covered ? [`sound ${stats.sound || "-"}, heard ${stats.heard || "-"}, timed ${stats.covered || "-"}`] : []),
    ...(stats.lost ? [`pieces ${stats.lost}`] : []),
  ];
  return parts.join("  ");
}
