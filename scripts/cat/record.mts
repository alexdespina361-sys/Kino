// Records what the behaviour engine makes a cat do on the made-up page of the simulator (rows of posters like the TV's home): the frames the renderer
// would be given, one per tick, as JSON. The cat lab's film strips (scripts/cat/glsheet.mjs film) draw them.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/record.mts <seed> <seconds> <out.json> [time=event[:argument] ...]
//
// The events are what the page could say, at a time (seconds): `5=cat.pet`, `9=cat.petEnd`, `12=cat.command:sleep`, `20=cat.call:900,700`,
// `30=player.play`, `4=cat.point:p1:r1c3` (show the viewer that poster). A hand has its own words: `6=cat.grab` takes hold of the cat at its scruff where it is (`6=cat.grab:900,700` takes hold of a
// place), `6.5=hand:1000,650@2` takes the hand there over two seconds (it is told at every tick for as long as it holds the cat), and
// `9=cat.drop` lets go. Development tooling: nothing in the app imports this file.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CatEngine } from "../../src/client/cat/engine/engine";
import { browseWorld, defaultPage } from "../../src/client/cat/engine/sim";
import type { CatEvent, Vec } from "../../src/client/cat/types";

const [seedArg = "1", secondsArg = "60", out = ".kino-cat/session.json", ...script] = process.argv.slice(2);
const seed = Number(seedArg);
const fps = 30;

type Entry = { at: number; event: CatEvent } | { at: number; hand: { to: Vec; seconds: number } };
const parse = (entry: string): Entry => {
  const [time = "0", rest = ""] = entry.split("=");
  // (the first colon ends the event's name: an argument may have more, as a poster's name has: `4=cat.point:p1:r1c3`)
  const colon = rest.indexOf(":");
  const type = colon < 0 ? rest : rest.slice(0, colon);
  const arg = colon < 0 ? "" : rest.slice(colon + 1);
  const at = Number(time);
  if (type === "cat.point") return { at, event: { type, targetId: arg } };
  if (type === "hand") {
    const [where = "0,0", seconds = "0"] = arg.split("@");
    const [x, y] = where.split(",").map(Number);
    return { at, hand: { to: { x: x ?? 0, y: y ?? 0 }, seconds: Number(seconds) } };
  }
  if (type === "cat.command") return { at, event: { type, command: arg as "sit" | "sleep" | "play" | "away" | "come" } };
  if (type === "cat.call" || type === "cat.pet" || type === "cat.grab") {
    const [x, y] = arg.split(",").map(Number);
    const at2 = x !== undefined && y !== undefined ? { x, y } : undefined;
    if (type === "cat.call") return { at, event: { type, at: at2 ?? { x: 0, y: 0 } } };
    if (type === "cat.grab") return { at, event: { type, at: at2 ?? { x: NaN, y: NaN } } };
    return { at, event: { type, ...(at2 ? { at: at2 } : {}) } };
  }
  return { at, event: { type } as CatEvent };
};
const events = script.map(parse).sort((a, b) => a.at - b.at);

const engine = new CatEngine(seed);
const page = defaultPage();
const world = browseWorld(page);
engine.send({ type: "route.enter", page: "library:home" });
const frames: Array<Record<string, unknown>> = [];
let next = 0;
const steps = Math.round(Number(secondsArg) * fps);
/** Where the hand is while it holds the cat, and the way it is going (smoothly: a hand starts and stops). */
let hand: Vec | null = null;
let route: { from: Vec; to: Vec; start: number; seconds: number } | null = null;
let last = engine.frame;
for (let i = 0; i < steps; i++) {
  const t = i / fps;
  while (next < events.length && events[next]!.at <= t) {
    const entry = events[next++]!;
    if ("hand" in entry) {
      if (hand) route = { from: { ...hand }, to: entry.hand.to, start: t, seconds: entry.hand.seconds };
      continue;
    }
    if (entry.event.type === "cat.grab") {
      // (a grab with no place is at the cat's scruff, where it is)
      const asked = entry.event.at;
      hand = Number.isFinite(asked.x) ? { ...asked } : { x: last.x, y: last.y - 0.6 * world.bodyLength };
      entry.event = { type: "cat.grab", at: hand };
    }
    if (entry.event.type === "cat.drop") {
      hand = null;
      route = null;
    }
    engine.send(entry.event);
  }
  if (hand && route) {
    const k = route.seconds > 0 ? Math.min(1, (t - route.start) / route.seconds) : 1;
    const e = k * k * (3 - 2 * k);
    hand = { x: route.from.x + (route.to.x - route.from.x) * e, y: route.from.y + (route.to.y - route.from.y) * e };
    if (k >= 1) route = null;
  }
  if (hand) engine.send({ type: "cat.carry", at: hand });
  const frame = engine.update(world, 1 / fps);
  last = frame;
  frames.push({ ...frame, act: engine.debug().act, surface: engine.debug().surfaceId, ...(hand ? { hand: { ...hand } } : {}) });
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ fps, bodyLength: world.bodyLength, frames }));
console.log(`wrote ${out}: ${frames.length} frames, body ${world.bodyLength}px, acts: ${[...new Set(frames.map((f) => f.act))].join(", ")}`);
