import { describe, expect, it } from "vitest";
import { Follower, leaderNow, syncStep, type HostReport, type SyncLocal, type SyncStep } from "./sync";

/*
 * A guest that follows a host over a link that is not perfect, in virtual time (ten minutes in a few milliseconds), with the guest's own
 * code (`Follower`) doing the following. The host reports once a second and at every change; each report goes host -> server -> guest,
 * each leg delayed by half the round trip plus jitter, now and then held up for a long while (a burst), in order like a TCP connection.
 * The server says how long a report takes (`lag`, from the round trips as they are with nothing in the way), as the real one does.
 *
 * What it measures is what a person sees of "lag" on the guest's screen: how often the picture jumps (and how often back), how often
 * its speed changes (a nudge), how much of the time the "catching up" line is up, how far from the host it is, and how soon it follows
 * what the host does. The seeds are fixed, so the numbers are the same every run.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Link {
  /** The two ends' round trips to the server when nothing is in the way (seconds). */
  hostRtt: number;
  guestRtt: number;
  /** The average of the extra wait of each leg (exponential), in seconds. */
  jitter: number;
  /** The chance that a message is held up for a long while, and for how long at most. */
  burstP: number;
  burstS: number;
}

const LINKS = {
  good: { hostRtt: 0.03, guestRtt: 0.04, jitter: 0.005, burstP: 0, burstS: 0 },
  ordinary: { hostRtt: 0.04, guestRtt: 0.07, jitter: 0.02, burstP: 0, burstS: 0 },
  jittery: { hostRtt: 0.04, guestRtt: 0.12, jitter: 0.06, burstP: 0.01, burstS: 1.5 }, // (a phone on a mobile network)
  bad: { hostRtt: 0.05, guestRtt: 0.2, jitter: 0.12, burstP: 0.03, burstS: 3 }, // (a crowded cell)
} satisfies Record<string, Link>;

interface Event {
  at: number;
  /** The host's picture waits for data for this long. */
  stall?: number;
  /** The host's own jump in the film, in seconds (negative: back). */
  jump?: number;
  /** The host is paused (by anybody) for this long. */
  pause?: number;
}

/** How a guest answers a report: the guest's own code, or (for comparison) the way it was, which went by the last report alone. */
type Answer = (report: HostReport, local: Omit<SyncLocal, "targetBuffered">, now: number) => SyncStep;

const production = (): Answer => {
  const follower = new Follower();
  return (report, local, now) => follower.step(report, local, now, () => true);
};

const lastReportOnly = (): Answer => {
  let lastSeekAt = -Infinity;
  return (report, local, now) => {
    const step = syncStep({ playing: report.playing, time: leaderNow(report), rate: report.rate }, { ...local, targetBuffered: true }, (now - lastSeekAt) * 1000);
    if (step.seek !== undefined) lastSeekAt = now;
    return step;
  };
};

interface Outcome {
  jumps: number;
  jumpsBack: number;
  /** How many seconds of the film the guest was sent back over, all told. */
  rewound: number;
  speedChanges: number;
  catchingShare: number;
  frozenShare: number;
  driftP95: number;
  /** How far from the host the guest's picture was, on average, while both were moving and nothing had happened for a few seconds (the host's doings, the guest's own jump): what a jump leaves it at. */
  settledGap: number;
  /** How long after each jump of the host's the guest was within a second of it (seconds), by the size of the jump. */
  follow: Record<string, number>;
}

/**
 * How long a picture takes to start moving once it is told to play (seconds): the host's after a pause, and the guest's after it is told to play
 * or to jump. Screens differ in it. And how long the guest's picture takes to land once it is sent to another place while it plays.
 */
interface Start {
  host: number;
  guest: number;
  seek?: number;
}

function watch(link: Link, events: Event[], answer: Answer, seed = 1, seconds = 600, start: Start = { host: 0, guest: 0 }): Outcome {
  const random = rng(seed);
  const landing = rng(seed + 1000); // (the landing times have a stream of their own, so that the links' are the same whatever they are)
  const exponential = (mean: number) => -mean * Math.log(1 - random());
  const leg = (rtt: number) => rtt / 2 + exponential(link.jitter) + (random() < link.burstP ? 0.5 + random() * link.burstS : 0);
  const STEP = 0.01;
  const lag = (link.hostRtt + link.guestRtt) / 2;

  const host = { time: 100, stalledUntil: -1, pausedUntil: -1, movesAt: 0 };
  const guest = { time: 100, rate: 1, playing: true, seekingUntil: -1, movesAt: 0 };
  let wasPaused = false;
  let lastSent = "";
  let hubAt = 0;
  let guestAt = 0;
  const onTheWay: Array<{ at: number; report: HostReport }> = [];
  const count = { jumps: 0, jumpsBack: 0, rewound: 0, speedChanges: 0, catching: 0, frozen: 0, samples: 0 };
  const drifts: number[] = [];
  const settled: number[] = [];
  let quietFrom = 0; // (the host has done nothing since)
  const watching: Array<{ at: number; label: string }> = [];
  const follow: Record<string, number> = {};
  let catching = false;
  let next = 0;
  const sorted = [...events].sort((a, b) => a.at - b.at);

  const emit = (now: number, force: boolean, waiting: boolean, paused: boolean) => {
    const key = `${waiting}|${paused}|${host.time.toFixed(3)}`;
    if (!force && key === lastSent) return; // (the real engine says nothing when nothing changed)
    lastSent = key;
    const report: HostReport = { playing: !waiting && !paused, time: host.time, rate: 1, lag, ...(waiting ? { waiting: true } : {}) };
    hubAt = Math.max(hubAt, now + leg(link.hostRtt));
    guestAt = Math.max(guestAt, hubAt + leg(link.guestRtt));
    onTheWay.push({ at: guestAt, report });
  };

  for (let now = 0; now < seconds; now += STEP) {
    let event = false;
    while (sorted[next] && sorted[next]!.at <= now) {
      const e = sorted[next++]!;
      quietFrom = Math.max(quietFrom, now + (e.stall ?? e.pause ?? 0));
      if (e.stall !== undefined) host.stalledUntil = now + e.stall;
      if (e.pause !== undefined) host.pausedUntil = now + e.pause;
      if (e.jump !== undefined) {
        host.time += e.jump;
        watching.push({ at: now, label: `${e.jump > 0 ? "+" : ""}${e.jump}` });
        event = true;
      }
    }
    const waiting = now < host.stalledUntil;
    const paused = now < host.pausedUntil;
    if (wasPaused && !paused) host.movesAt = now + start.host; // (told to play: the report goes out at once, the picture moves a moment later)
    wasPaused = paused;
    const before = lastSent.split("|");
    if (!waiting && !paused && now >= host.movesAt) host.time += STEP;
    const changed = before[0] !== String(waiting) || before[1] !== String(paused);
    if (changed || event) emit(now, true, waiting, paused);
    else if (Math.abs(now - Math.round(now)) < STEP / 2) emit(now, false, waiting, paused);

    const seeking = now < guest.seekingUntil;
    if (guest.playing && !seeking && now >= guest.movesAt) guest.time += STEP * guest.rate;

    while (onTheWay.length && onTheWay[0]!.at <= now) {
      const { report } = onTheWay.shift()!;
      const local = { playing: guest.playing, time: guest.time, rate: guest.rate, buffering: seeking, ahead: 60 };
      const step = answer(report, local, now);
      if (step.seek !== undefined) {
        count.jumps += 1;
        if (step.seek < guest.time) {
          count.jumpsBack += 1;
          count.rewound += guest.time - step.seek;
        }
        guest.time = step.seek;
        guest.seekingUntil = now + (start.seek === undefined ? 0.05 : start.seek * (0.7 + 0.6 * landing()));
      }
      if (Math.abs(step.rate - guest.rate) > 0.001) {
        count.speedChanges += 1;
        guest.rate = step.rate;
      }
      if (step.play && !guest.playing && start.guest > 0) guest.movesAt = now + start.guest * (0.7 + 0.6 * random());
      guest.playing = step.play;
      catching = report.playing && (step.seek !== undefined || Math.abs(step.rate - report.rate) > 0.001);
    }

    if (Math.abs(now * 10 - Math.round(now * 10)) < STEP * 5) {
      count.samples += 1;
      drifts.push(Math.abs(guest.time - host.time));
      if (now >= quietFrom + 3 && now >= Math.max(guest.seekingUntil, guest.movesAt) + 1.5 && guest.playing && guest.rate === 1 && now >= host.movesAt) settled.push(guest.time - host.time);
      if (catching) count.catching += 1;
      if (!guest.playing && !waiting && !paused) count.frozen += 1;
      for (let i = watching.length - 1; i >= 0; i--) {
        if (Math.abs(guest.time - host.time) < 1 && now > watching[i]!.at + STEP) {
          follow[watching[i]!.label] = Number((now - watching[i]!.at).toFixed(1));
          watching.splice(i, 1);
        }
      }
    }
  }
  drifts.sort((a, b) => a - b);
  return {
    jumps: count.jumps,
    jumpsBack: count.jumpsBack,
    rewound: count.rewound,
    speedChanges: count.speedChanges,
    catchingShare: count.catching / count.samples,
    frozenShare: count.frozen / count.samples,
    driftP95: drifts[Math.floor(drifts.length * 0.95)]!,
    settledGap: settled.reduce((sum, gap) => sum + Math.abs(gap), 0) / Math.max(1, settled.length),
    follow,
  };
}

const every = (period: number, make: (at: number) => Event, total = 600): Event[] => {
  const out: Event[] = [];
  for (let at = period; at < total; at += period) out.push(make(at));
  return out;
};
/** The host's picture runs dry now and then: a hiccup of a third of a second every 40 s, a stall of two seconds every 90 s. */
const STALLS = [...every(40, (at) => ({ at, stall: 0.3 })), ...every(90, (at) => ({ at, stall: 2 }))];
/** Somebody at the host's end steers: back 30 s, a pause of ten, forward a minute, a pause of three, forward 4 s, back 5 s. */
const STEERING: Event[] = [{ at: 100, jump: -30 }, { at: 200, pause: 10 }, { at: 300, jump: 60 }, { at: 400, pause: 3 }, { at: 450, jump: 4 }, { at: 500, jump: -5 }];

/** Somebody at the host's end pauses now and then, for a few seconds at a time: eleven pauses in ten minutes. */
const PAUSES: Event[] = [
  [10, 10],
  [30, 3],
  [70, 20],
  [130, 5],
  [170, 2],
  [230, 8],
  [290, 4],
  [350, 15],
  [410, 3],
  [470, 6],
  [530, 12],
].map(([at, pause]) => ({ at: at!, pause: pause! }));

const SEEDS = [1, 2, 3];

describe("a guest following a host over a link that is not perfect", () => {
  it("(reading only the last report, a guest on a poor link jumped and changed speed all the time: this is what the sync is measured against)", () => {
    const old = watch(LINKS.jittery, [], lastReportOnly());
    expect(old.jumps).toBeGreaterThanOrEqual(5);
    expect(old.speedChanges).toBeGreaterThanOrEqual(40);
    expect(old.catchingShare).toBeGreaterThan(0.05);
    const worse = watch(LINKS.bad, [], lastReportOnly());
    expect(worse.jumps).toBeGreaterThanOrEqual(20);
    expect(worse.catchingShare).toBeGreaterThan(0.4);
    expect(worse.driftP95).toBeGreaterThan(1);
  });

  describe("watching along with nothing happening at the host's end", () => {
    it("never needs to move on a good link or an ordinary one", () => {
      for (const link of [LINKS.good, LINKS.ordinary]) {
        const result = watch(link, [], production());
        expect(result.jumps).toBe(0);
        expect(result.speedChanges).toBeLessThanOrEqual(2);
        expect(result.driftP95).toBeLessThan(0.15);
      }
    });

    it("stays in step on a phone on a mobile network: no jumps, a few speed changes in ten minutes, the catching-up line all but never", () => {
      for (const seed of SEEDS) {
        const result = watch(LINKS.jittery, [], production(), seed);
        expect(result.jumps).toBe(0);
        expect(result.speedChanges).toBeLessThanOrEqual(10);
        expect(result.catchingShare).toBeLessThan(0.03);
        expect(result.driftP95).toBeLessThan(0.2);
      }
    });

    it("all but stays in step on a crowded cell: held-up reports hardly ever move the picture (the way it was, it jumped fifty times in ten minutes)", () => {
      for (const seed of SEEDS) {
        const result = watch(LINKS.bad, [], production(), seed);
        expect(result.jumps).toBeLessThanOrEqual(3);
        expect(result.rewound).toBeLessThan(6);
        expect(result.speedChanges).toBeLessThanOrEqual(40);
        expect(result.catchingShare).toBeLessThan(0.1);
        expect(result.driftP95).toBeLessThan(0.35);
      }
    });
  });

  describe("when the host's picture runs dry now and then", () => {
    it("waits where it is, instead of going back to the host's frame each time: no jump back on a good link, an ordinary one, or a mobile one", () => {
      for (const link of [LINKS.good, LINKS.ordinary, LINKS.jittery]) {
        for (const seed of SEEDS) {
          const result = watch(link, STALLS, production(), seed);
          expect(result.jumpsBack).toBe(0);
          expect(result.driftP95).toBeLessThan(0.3); // (a mobile link has it at 0.19-0.26, with the jumps aimed on or not: the link's own unevenness)
        }
      }
    });

    it("hardly ever jumps on a crowded cell either (the way it was, it jumped dozens of times)", () => {
      for (const seed of SEEDS) expect(watch(LINKS.bad, STALLS, production(), seed).jumps).toBeLessThanOrEqual(10);
      expect(watch(LINKS.bad, STALLS, lastReportOnly()).jumps).toBeGreaterThan(30);
    });

    it("is stopped for little more than the host is (the time that the host's go-ahead takes to arrive)", () => {
      expect(watch(LINKS.ordinary, STALLS, production()).frozenShare).toBeLessThan(0.01);
      expect(watch(LINKS.jittery, STALLS, production()).frozenShare).toBeLessThan(0.015);
    });
  });

  describe("when the screens take a moment to start moving after they are told to play", () => {
    // The host's report goes out the moment it is told to play, but its picture moves a little later, and how much later depends on the screen (a TV is slower than a phone).
    // The report said where the host starts from, which is not where its clock is: read as if it were, every guest was ahead of the host by that moment, and slowed down for it.
    const STARTS: Array<[string, Start]> = [
      ["a slow host and a quick guest", { host: 0.3, guest: 0.1 }],
      ["two screens that take the same", { host: 0.12, guest: 0.12 }],
    ];

    it("does not make a guest speed up or slow down after every pause of the host's (the way it was, it did after most of them)", () => {
      for (const [name, start] of STARTS) {
        for (const seed of SEEDS) {
          expect(watch(LINKS.ordinary, PAUSES, production(), seed, 600, start).speedChanges, `${name}, ordinary link, seed ${seed}`).toBeLessThanOrEqual(2);
          expect(watch(LINKS.jittery, PAUSES, production(), seed, 600, start).speedChanges, `${name}, mobile link, seed ${seed}`).toBeLessThanOrEqual(12);
        }
      }
    });
  });

  describe("when the guest's jumps take a moment to land", () => {
    // A picture sent to where the host is lands a moment later, when the host has gone on: it stayed behind by that moment after every jump (inside
    // what is not worth a nudge nothing puts it right, and the less a guest nudges the longer it stays). The guest looks at how far from the host
    // each jump leaves it, and aims that much further on at the next one.
    const HOPS = every(40, (at) => ({ at, jump: Math.round(at / 40) % 2 ? -20 : 20 }));
    const SCREENS: Array<[string, Start]> = [
      ["a computer", { host: 0.07, guest: 0.07, seek: 0.07 }],
      ["a TV that takes longer", { host: 0.12, guest: 0.12, seek: 0.12 }],
      ["a slow one", { host: 0.05, guest: 0.2, seek: 0.2 }],
    ];

    it("leaves the picture well inside the moment a jump takes from the host's, instead of the whole moment behind it (on a good link or an ordinary one)", () => {
      for (const link of [LINKS.good, LINKS.ordinary]) {
        for (const [name, start] of SCREENS) {
          for (const seed of SEEDS) {
            const { settledGap } = watch(link, HOPS, production(), seed, 600, start);
            expect(settledGap, `${name}, seed ${seed}`).toBeLessThan(start.seek! * 0.6); // (without it, the moment itself and a little more)
          }
        }
      }
    });

    it("does not make a guest on a mobile link change speed to get there (what is left there is the link's own unevenness)", () => {
      for (const [name, start] of SCREENS) {
        for (const seed of SEEDS) {
          const result = watch(LINKS.jittery, HOPS, production(), seed, 600, start);
          expect(result.settledGap, `${name}, seed ${seed}`).toBeLessThan(0.13);
          expect(result.speedChanges, `${name}, seed ${seed}`).toBeLessThanOrEqual(10);
        }
      }
    });
  });

  describe("when somebody at the host's end steers", () => {
    it("goes along with a jump forward at once, and with a jump back within a few seconds", () => {
      for (const link of [LINKS.good, LINKS.ordinary, LINKS.jittery]) {
        const { follow } = watch(link, STEERING, production());
        expect(follow["+60"]).toBeLessThanOrEqual(1);
        expect(follow["+4"]).toBeLessThanOrEqual(1);
        expect(follow["-30"]).toBeLessThanOrEqual(3);
        expect(follow["-5"]).toBeLessThanOrEqual(3);
      }
    });

    it("still follows on a crowded cell, only later", () => {
      const { follow } = watch(LINKS.bad, STEERING, production());
      for (const label of Object.keys(follow)) expect(follow[label]).toBeLessThanOrEqual(8);
      expect(Object.keys(follow)).toHaveLength(4);
    });

    it("stops with the host at its frame when the host pauses, and does not go back over the film for it", () => {
      const result = watch(LINKS.jittery, [{ at: 100, pause: 10 }, { at: 200, pause: 3 }], production());
      expect(result.rewound).toBeLessThan(1); // (a few tenths of a second, to show the frame the host stopped on)
    });
  });
});
