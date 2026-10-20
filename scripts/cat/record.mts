// Records what the behaviour engine makes a cat do on the made-up page of the simulator (rows of posters like the TV's home): the frames the renderer
// would be given, one per tick, as JSON. The cat lab's film strips (scripts/cat/glsheet.mjs film) draw them.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/record.mts <seed> <seconds> <out.json> [time=event[:argument] ...]
//
// The events are what the page could say, at a time (seconds): `5=cat.pet`, `9=cat.petEnd`, `12=cat.command:sleep`, `20=cat.call:900,700`,
// `30=player.play`. Development tooling: nothing in the app imports this file.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CatEngine } from "../../src/client/cat/engine/engine";
import { browseWorld, defaultPage } from "../../src/client/cat/engine/sim";
import type { CatEvent } from "../../src/client/cat/types";

const [seedArg = "1", secondsArg = "60", out = ".kino-cat/session.json", ...script] = process.argv.slice(2);
const seed = Number(seedArg);
const fps = 30;

const parse = (entry: string): { at: number; event: CatEvent } => {
  const [time = "0", rest = ""] = entry.split("=");
  const [type = "", arg = ""] = rest.split(":");
  const at = Number(time);
  if (type === "cat.command") return { at, event: { type, command: arg as "sit" | "sleep" | "play" | "away" | "come" } };
  if (type === "cat.call" || type === "cat.pet") {
    const [x, y] = arg.split(",").map(Number);
    return { at, event: type === "cat.call" ? { type, at: { x: x ?? 0, y: y ?? 0 } } : { type, ...(x !== undefined && y !== undefined ? { at: { x, y } } : {}) } };
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
for (let i = 0; i < steps; i++) {
  const t = i / fps;
  while (next < events.length && events[next]!.at <= t) engine.send(events[next++]!.event);
  const frame = engine.update(world, 1 / fps);
  frames.push({ ...frame, act: engine.debug().act, surface: engine.debug().surfaceId });
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ fps, bodyLength: world.bodyLength, frames }));
console.log(`wrote ${out}: ${frames.length} frames, body ${world.bodyLength}px, acts: ${[...new Set(frames.map((f) => f.act))].join(", ")}`);
