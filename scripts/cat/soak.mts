// Soak test of the cat's brain (the cat lab): many long sessions on a page that is scrolled, resized, covered by menus, left for a film, hidden,
// touched, stroked and picked up by a hand at random (for the three characters of cat, see src/client/cat/engine/temperament.ts), each checked for what must never happen (see runSession in src/client/cat/engine/sim.ts). Development
// tooling, not part of the app.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/soak.mts [firstSeed=13] [lastSeed=212] [secondsPerSession=600] [kinds]
//
// `kinds` is a regular expression for the names of the kinds of afternoon to run (all of them when it is not given): `stroke` for those with a hand that strokes the cat.

import { runSession } from "../../src/client/cat/engine/sim.ts";

const all = { scroll: true, focus: true, resize: true, modal: true, film: true, touch: true, route: true, visibility: true, hand: true, slide: true };
const [, , fromArg = "13", toArg = "212", secondsArg = "600", kindsArg = ""] = process.argv;
const wanted = new RegExp(kindsArg);
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
  // (a hand that strokes the cat and dashes at it, as well as picking it up, for the cat as it was and for each character: the ragdoll has had enough of it, the ginger has not)
  ["stroke", { chaos: { ...all, mouse: true, stroke: true } }],
  ["stroke-ginger", { chaos: { ...all, mouse: true, stroke: true }, temperament: "ginger" }],
  ["stroke-ragdoll", { chaos: { ...all, mouse: true, stroke: true }, temperament: "ragdoll" }],
  ["stroke-ragdoll-60fps", { chaos: { ...all, mouse: true, stroke: true }, temperament: "ragdoll", fps: 60 }],
  ["stroke-ragdoll-quiet", { chaos: { ...all, mouse: true, stroke: true }, temperament: "ragdoll", quiet: true }],
  ["stroke-ragdoll-reduced", { chaos: { ...all, mouse: true, stroke: true }, temperament: "ragdoll", reducedMotion: true }],
  ["stroke-ginger-names", { chaos: { ...all, mouse: true, stroke: true }, temperament: "ginger", names: true }],
];
let bad = 0;
const started = Date.now();
/** What the cats chose to do of their own accord, over every session (how many times each). */
const chosen: Record<string, number> = {};
for (const [name, extra] of variants) {
  if (!wanted.test(name)) continue;
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
