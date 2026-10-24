// How the cat spends its time, over many seeds (development tooling, not part of the app): the share of its time on each kind of place and each act, what it
// chooses, how often it moves and how far. The pages are made up (the simulator's: two rows of posters and the foot of the screen; or the TV's own library as
// the cat reads it, see tv-library.fixture.ts) and nothing happens on them unless `busy` says so: it is the cat's own life that is measured.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/behaviour.mts [--seeds=40] [--seconds=900] [--page=tv|sim|busy|both] [--temperament=a,b,...] [--quiet]
//
// --page: `tv` the library of the 1280x720 TV, `sim` the simulator's page at 1920x1080, `busy` the simulator's page with a viewer (the focus moves, a pointer
// wanders, the rows are scrolled, a hand touches the cat now and then), `both` is tv and busy. --temperament: one or more (`baseline` is the cat before
// there were two): each is a table of its own, and the numbers of the first are the ones the others are said against.

import { CatEngine } from "../../src/client/cat/engine/engine.ts";
import { browseWorld, defaultPage, runSession } from "../../src/client/cat/engine/sim.ts";
import { tvLibrary } from "../../src/client/cat/engine/tv-library.fixture.ts";
import type { World } from "../../src/client/cat/types.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const found = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return found ? [found[1]!, found[2] ?? "1"] : [arg, "1"];
  }),
);
const seeds = Number(args.seeds ?? 40);
const seconds = Number(args.seconds ?? 900);
const page = String(args.page ?? "both");
const temperaments = String(args.temperament ?? "baseline").split(",");
const fps = 30;

interface Run {
  /** Seconds in sight, by kind of place ("shelfTop", "fallbackFloor", "air"). */
  places: Record<string, number>;
  /** Seconds by what the cat is doing. */
  acts: Record<string, number>;
  choices: Record<string, number>;
  hops: number;
  /** Body lengths walked or run. */
  walked: number;
  /** Seconds in sight. */
  seen: number;
  /** The seconds of every stay on the foot of the screen, one after the other. */
  floorStays: number[];
  /** Seconds on each shelf (by name), for a page that does not change. */
  rows: Record<string, number>;
  /** Seconds it was running (the clip). */
  running: number;
  /** Seconds it spent in a rest, a sleep or a scene of its own (a wash, a stretch). */
  still: number;
}

const make = (seed: number, temperament: string) => new (CatEngine as unknown as new (seed: number, options?: object) => CatEngine)(seed, temperament === "baseline" ? undefined : { temperament });

/** A cat alone on a page that stays as it is. */
function alone(world: World, seed: number, temperament: string): Run {
  const engine = make(seed, temperament);
  const dt = 1 / fps;
  const run: Run = { places: {}, acts: {}, choices: {}, hops: 0, walked: 0, seen: 0, floorStays: [], rows: {}, running: 0, still: 0 };
  const L = world.bodyLength;
  const kinds = new Map(world.surfaces.map((s) => [s.id, s.kind] as const));
  let lastChoice = "";
  let wasJumping = false;
  let onFloorFor = 0;
  let odometer = 0;
  for (let i = 0; i < seconds * fps; i++) {
    const frame = engine.update(world, dt);
    const dbg = engine.debug();
    if (dbg.choice !== lastChoice) {
      lastChoice = dbg.choice;
      run.choices[dbg.choice] = (run.choices[dbg.choice] ?? 0) + 1;
    }
    const jumping = dbg.act === "jump";
    if (jumping && !wasJumping) run.hops++;
    wasJumping = jumping;
    if (i > 0) run.walked += Math.max(0, frame.odometer - odometer) / L;
    odometer = frame.odometer;
    if (frame.appear <= 0.5) {
      if (onFloorFor > 0) run.floorStays.push(onFloorFor);
      onFloorFor = 0;
      continue;
    }
    run.seen += dt;
    run.acts[dbg.act] = (run.acts[dbg.act] ?? 0) + dt;
    const kind = frame.grounded && dbg.surfaceId ? (kinds.get(dbg.surfaceId) ?? "other") : "air";
    run.places[kind] = (run.places[kind] ?? 0) + dt;
    if (frame.grounded && dbg.surfaceId) run.rows[dbg.surfaceId] = (run.rows[dbg.surfaceId] ?? 0) + dt;
    if (kind === "fallbackFloor") onFloorFor += dt;
    else if (kind !== "air" && onFloorFor > 0) {
      run.floorStays.push(onFloorFor);
      onFloorFor = 0;
    }
    if (frame.clip === "run") run.running += dt;
    if (dbg.act.startsWith("rest") || dbg.act === "sleep" || dbg.act.startsWith("shot")) run.still += dt;
  }
  if (onFloorFor > 0) run.floorStays.push(onFloorFor);
  return run;
}

/** A cat on the simulator's page with a viewer: the focus moves, a pointer wanders, the rows are scrolled, a hand touches the cat. */
function busy(seed: number, temperament: string): Run {
  const stats = runSession({ seed, seconds, chaos: { focus: true, mouse: true, touch: true, scroll: true, slide: true }, ...(temperament === "baseline" ? {} : { temperament }) } as Parameters<typeof runSession>[0]);
  const floorStays: number[] = [];
  return { places: stats.places, acts: stats.acts, choices: stats.choices, hops: stats.hops, walked: 0, seen: Object.values(stats.places).reduce((a, b) => a + b, 0), floorStays, rows: {}, running: 0, still: 0 };
}

const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const sem = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1) / values.length);
};

function table(label: string, runs: Run[]): Map<string, number> {
  const out = new Map<string, number>();
  const per = (pick: (run: Run) => number): number[] => runs.map(pick);
  const share = (pick: (run: Run) => number): number[] => runs.map((run) => (run.seen > 0 ? (100 * pick(run)) / run.seen : 0));
  const row = (name: string, values: number[], unit = "%", digits = 1): void => {
    out.set(name, mean(values));
    if (!args.quiet) console.log(`  ${name.padEnd(30)} ${mean(values).toFixed(digits).padStart(7)} ${unit}  (+-${sem(values).toFixed(digits)})`);
  };
  if (!args.quiet) console.log(`\n${label}: ${runs.length} cats x ${seconds} s`);
  row("on a shelf", share((r) => r.places.shelfTop ?? 0));
  row("on the foot of the screen", share((r) => r.places.fallbackFloor ?? 0));
  row("in the air", share((r) => r.places.air ?? 0));
  const names = [...new Set(runs.flatMap((r) => Object.keys(r.rows)))].sort();
  for (const name of names) row(`  ${name}`, share((r) => r.rows[name] ?? 0));
  const stays = runs.flatMap((r) => r.floorStays);
  row("foot stays per hour", per((r) => (r.floorStays.length * 3600) / Math.max(1, r.seen)), "", 1);
  row("a stay on the foot, seconds", stays.length > 0 ? stays : [0], "s", 1);
  row("the longest stay on the foot", per((r) => Math.max(0, ...r.floorStays)), "s", 0);
  row("hops per minute", per((r) => (r.hops * 60) / Math.max(1, r.seen)), "", 2);
  row("walked, body lengths a minute", per((r) => (r.walked * 60) / Math.max(1, r.seen)), "", 1);
  row("running", share((r) => r.running));
  row("resting, sleeping or in a scene", share((r) => r.still));
  row("asleep", share((r) => r.acts.sleep ?? 0));
  row("walking about", share((r) => (r.acts.walk ?? 0) + (r.acts.stalk ?? 0)));
  const choices = new Map<string, number[]>();
  for (const name of new Set(runs.flatMap((r) => Object.keys(r.choices)))) choices.set(name, per((r) => ((r.choices[name] ?? 0) * 60) / Math.max(1, r.seen)));
  if (!args.quiet) console.log("  what it chose, a minute:");
  for (const [name, values] of [...choices].sort((a, b) => mean(b[1]) - mean(a[1]))) row(`  ${name || "-"}`, values, "", 2);
  return out;
}

const tables = new Map<string, Map<string, number>>();
for (const temperament of temperaments) {
  const kinds: Array<[string, (seed: number) => Run]> = [];
  if (page === "tv" || page === "both") kinds.push(["the TV's library", (seed) => alone(tvLibrary, seed, temperament)]);
  if (page === "sim") kinds.push(["the simulator's page (1920x1080)", (seed) => alone(browseWorld(defaultPage()), seed, temperament)]);
  if (page === "busy" || page === "both") kinds.push(["the simulator's page with a viewer", (seed) => busy(seed, temperament)]);
  for (const [name, one] of kinds) {
    const runs: Run[] = [];
    for (let seed = 1; seed <= seeds; seed++) runs.push(one(seed));
    tables.set(`${temperament} / ${name}`, table(`${temperament} / ${name}`, runs));
  }
}
if (temperaments.length > 1) {
  console.log("\nagainst the first:");
  const first = temperaments[0]!;
  for (const [key, result] of tables) {
    const [temperament, ...rest] = key.split(" / ");
    if (temperament === first) continue;
    const base = tables.get(`${first} / ${rest.join(" / ")}`);
    if (!base) continue;
    console.log(`  ${key}`);
    for (const [name, value] of result) {
      const was = base.get(name) ?? 0;
      if (Math.abs(value - was) < 0.05 * Math.max(1, Math.abs(was))) continue;
      console.log(`    ${name.padEnd(30)} ${was.toFixed(2).padStart(8)} -> ${value.toFixed(2).padStart(8)}`);
    }
  }
}
