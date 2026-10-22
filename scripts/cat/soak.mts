// Soak test of the cat's brain (the cat lab): many long sessions on a page that is scrolled, resized, covered by menus, left for a film, hidden,
// touched and picked up by a hand at random, each checked for what must never happen (see runSession in src/client/cat/engine/sim.ts). Development
// tooling, not part of the app.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/soak.mts [firstSeed=13] [lastSeed=212] [secondsPerSession=600]

import { runSession } from "../../src/client/cat/engine/sim.ts";

const all = { scroll: true, focus: true, resize: true, modal: true, film: true, touch: true, route: true, visibility: true, hand: true, slide: true };
const [, , fromArg = "13", toArg = "212", secondsArg = "600"] = process.argv;
const from = Number(fromArg);
const to = Number(toArg);
const seconds = Number(secondsArg);
const variants: Array<[string, Parameters<typeof runSession>[0] extends infer O ? Partial<O> : never]> = [
  ["all", { chaos: all }],
  ["all-20fps", { chaos: all, fps: 20 }],
  ["all-60fps", { chaos: all, fps: 60 }],
  ["reduced", { chaos: all, reducedMotion: true }],
  ["quiet", { chaos: all, quiet: true }],
  ["scroll-focus", { chaos: { scroll: true, focus: true, touch: true, hand: true } }],
  ["slide", { chaos: { slide: true, touch: true, focus: true } }],
  ["names", { chaos: all, names: true }],
  // (a finger that flings the page, eight thousand pixels a second, at 60 frames and at 30: the cat is shaken off its shelf and falls)
  ["fling-60fps", { chaos: { ...all, fling: true }, fps: 60 }],
  ["fling-30fps", { chaos: { ...all, fling: true } }],
  ["fling-scroll", { chaos: { scroll: true, focus: true, touch: true, hand: true, fling: true }, fps: 60 }],
];
let bad = 0;
const started = Date.now();
/** What the cats chose to do of their own accord, over every session (how many times each). */
const chosen: Record<string, number> = {};
for (const [name, extra] of variants) {
  let found = 0;
  for (let seed = from; seed <= to; seed++) {
    const stats = runSession({ seed, seconds, ...(extra as object) } as Parameters<typeof runSession>[0]);
    for (const [choice, count] of Object.entries(stats.choices)) chosen[choice] = (chosen[choice] ?? 0) + count;
    if (stats.violations.length > 0) {
      found++;
      bad++;
      if (found <= 3) {
        console.log(`[${name}] seed ${seed}: ${stats.violations.length} violations`);
        for (const v of stats.violations.slice(0, 3)) console.log("    ", v);
        console.log("   context:");
        for (const line of stats.context.slice(-8)) console.log("      ", line);
      }
    }
  }
  console.log(`[${name}] seeds ${from}-${to}: ${found} with violations`);
}
console.log(`chosen: ${Object.entries(chosen).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name || "-"} ${n}`).join(", ")}`);
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s, ${bad} bad runs`);
process.exit(bad > 0 ? 1 : 0);
