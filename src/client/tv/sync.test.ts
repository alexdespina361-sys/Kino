import { describe, expect, it, vi } from "vitest";
import {
  CLOCK_CONFIRM_S,
  CLOCK_WINDOW_S,
  FAR_SEEK_S,
  Follower,
  GIVE_UP_S,
  HARD_SEEK_S,
  HostClock,
  NUDGE,
  NUDGE_FROM_S,
  NUDGE_UNTIL_S,
  PAUSED_TOLERANCE_S,
  RESUME_SEEK_S,
  SEEK_COOLDOWN_MS,
  THIN_BUFFER_S,
  WAIT_TOLERANCE_S,
  describeSync,
  leaderNow,
  syncStats,
  syncStep,
  type HostReport,
  type SyncLocal,
  type SyncTarget,
} from "./sync";

const leader = (patch: Partial<SyncTarget> = {}): SyncTarget => ({ playing: true, time: 100, rate: 1, ...patch });
// (By default a picture with plenty downloaded, the leader's place included.)
const me = (patch: Partial<SyncLocal> = {}): SyncLocal => ({ playing: true, time: 100, rate: 1, buffering: false, ahead: 60, targetBuffered: true, ...patch });
/** A picture playing with next to nothing downloaded ahead: about to wait for data. */
const thin = (patch: Partial<SyncLocal> = {}): SyncLocal => me({ ahead: THIN_BUFFER_S - 1, targetBuffered: false, ...patch });
const LONG_AGO = SEEK_COOLDOWN_MS * 10;

describe("leaderNow", () => {
  it("is where the host has got to since the report: a playing host moved on while the report was on its way", () => {
    expect(leaderNow({ playing: true, time: 100, rate: 1, lag: 0.2 })).toBeCloseTo(100.2);
    expect(leaderNow({ playing: true, time: 100, rate: 2, lag: 0.2 })).toBeCloseTo(100.4); // (at its own speed)
  });

  it("is the place itself for a host that is paused, and for a report that does not say how old it is", () => {
    expect(leaderNow({ playing: false, time: 100, rate: 1, lag: 0.2 })).toBe(100);
    expect(leaderNow({ playing: true, time: 100, rate: 1 })).toBe(100);
  });
});

describe("syncStep", () => {
  it("leaves a picture that is in step alone", () => {
    expect(syncStep(leader(), me({ time: 100.1 }), LONG_AGO)).toEqual({ play: true, rate: 1 });
  });

  it("plays a little slower when ahead and a little faster when behind", () => {
    expect(syncStep(leader(), me({ time: 100.6 }), LONG_AGO)).toEqual({ play: true, rate: 1 - NUDGE });
    expect(syncStep(leader(), me({ time: 99.4 }), LONG_AGO)).toEqual({ play: true, rate: 1 + NUDGE });
  });

  it("keeps the leader's speed as the base of a nudge", () => {
    expect(syncStep(leader({ rate: 2 }), me({ time: 99.5, rate: 2 }), LONG_AGO).rate).toBeCloseTo(2 * (1 + NUDGE));
  });

  it("jumps to the leader when too far apart, either way", () => {
    expect(syncStep(leader(), me({ time: 100 + HARD_SEEK_S + 1 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
    expect(syncStep(leader(), me({ time: 100 - HARD_SEEK_S - 1 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
  });

  it("does not jump again while the last jump is still filling, but keeps nudging", () => {
    const step = syncStep(leader(), me({ time: 90 }), SEEK_COOLDOWN_MS - 1);
    expect(step.seek).toBeUndefined();
    expect(step.rate).toBe(1 + NUDGE);
  });

  it("does not chase the leader while its own picture is waiting for data", () => {
    expect(syncStep(leader(), me({ time: 99.4, buffering: true }), LONG_AGO)).toEqual({ play: true, rate: 1 });
  });

  it("pauses with the leader, and moves only if it is not near where the leader stopped", () => {
    expect(syncStep(leader({ playing: false }), me({ time: 100 + PAUSED_TOLERANCE_S - 0.05 }), LONG_AGO)).toEqual({ play: false, rate: 1 });
    expect(syncStep(leader({ playing: false }), me({ time: 100 + PAUSED_TOLERANCE_S + 0.05 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
    expect(syncStep(leader({ playing: false }), me({ time: 103 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
  });

  it("shows the frame the host stopped on: a paused picture a fifth of a second off is moved", () => {
    expect(syncStep(leader({ playing: false }), me({ time: 100.2 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
    expect(syncStep(leader({ playing: false }), me({ time: 99.8 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
  });

  it("starts playing again when the leader does", () => {
    expect(syncStep(leader(), me({ playing: false }), LONG_AGO).play).toBe(true);
  });

  describe("a picture that stopped with the host and is told to start again", () => {
    it("goes to the exact place at once if it is behind and has it: it would otherwise start a report's age behind and take seconds to catch up", () => {
      expect(syncStep(leader(), me({ playing: false, time: 100 - RESUME_SEEK_S - 0.1 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
    });

    it("does not go back in time when it is ahead: it plays on, a little slower, until the host is where it is", () => {
      expect(syncStep(leader(), me({ playing: false, time: 100 + RESUME_SEEK_S + 0.1 }), LONG_AGO)).toEqual({ play: true, rate: 1 - NUDGE });
      expect(syncStep(leader(), me({ playing: false, time: 100.8 }), LONG_AGO)).toEqual({ play: true, rate: 1 - NUDGE });
    });

    it("leaves a small difference to the nudge, goes nowhere it has not downloaded, and keeps to the cooldown after a jump", () => {
      expect(syncStep(leader(), me({ playing: false, time: 100 - RESUME_SEEK_S + 0.05 }), LONG_AGO)).toEqual({ play: true, rate: 1 });
      expect(syncStep(leader(), me({ playing: false, time: 99.7, targetBuffered: false }), LONG_AGO)).toEqual({ play: true, rate: 1 + NUDGE });
      expect(syncStep(leader(), me({ playing: false, time: 99.7 }), SEEK_COOLDOWN_MS - 1)).toEqual({ play: true, rate: 1 + NUDGE });
    });
  });

  describe("a little apart", () => {
    it("does not start a nudge for a guess that is a little off", () => {
      // (What is left of a report's age once the host's place has been brought up to date is the guess being a little off.)
      expect(syncStep(leader(), me({ time: 100 + NUDGE_FROM_S - 0.05 }), LONG_AGO)).toEqual({ play: true, rate: 1 });
      expect(syncStep(leader(), me({ time: 100 - NUDGE_FROM_S + 0.05 }), LONG_AGO)).toEqual({ play: true, rate: 1 });
    });

    it("goes on with a nudge it has started until the pictures are close, then stops", () => {
      const slow = 1 - NUDGE;
      expect(syncStep(leader(), me({ time: 100.25, rate: slow }), LONG_AGO)).toEqual({ play: true, rate: slow });
      expect(syncStep(leader(), me({ time: 100 + NUDGE_UNTIL_S + 0.05, rate: slow }), LONG_AGO)).toEqual({ play: true, rate: slow });
      expect(syncStep(leader(), me({ time: 100 + NUDGE_UNTIL_S - 0.02, rate: slow }), LONG_AGO)).toEqual({ play: true, rate: 1 });
      const fast = 1 + NUDGE;
      expect(syncStep(leader(), me({ time: 99.75, rate: fast }), LONG_AGO)).toEqual({ play: true, rate: fast });
      expect(syncStep(leader(), me({ time: 100 - NUDGE_UNTIL_S + 0.02, rate: fast }), LONG_AGO)).toEqual({ play: true, rate: 1 });
    });

    it("takes the leader's own speed, however fast, for no nudge: it starts only at the wider distance", () => {
      expect(syncStep(leader({ rate: 2 }), me({ rate: 2, time: 100 + NUDGE_FROM_S - 0.05 }), LONG_AGO)).toEqual({ play: true, rate: 2 });
    });
  });

  describe("a picture that is about to run dry", () => {
    it("is not made to play faster, whatever the distance", () => {
      expect(syncStep(leader(), thin({ time: 99.4 }), LONG_AGO)).toEqual({ play: true, rate: 1 });
      expect(syncStep(leader(), thin({ time: 99.4, rate: 1 + NUDGE }), LONG_AGO)).toEqual({ play: true, rate: 1 }); // (and a speed-up it had is taken back)
    });

    it("may still play slower when it is ahead: that only lets the leader catch up", () => {
      expect(syncStep(leader(), thin({ time: 100.6 }), LONG_AGO)).toEqual({ play: true, rate: 1 - NUDGE });
    });

    it("is not sent to a place it has not downloaded: it would wait there and be sent again", () => {
      expect(syncStep(leader(), thin({ time: 95 }), LONG_AGO)).toEqual({ play: true, rate: 1 });
      expect(syncStep(leader(), me({ time: 95, buffering: true, targetBuffered: false }), LONG_AGO)).toEqual({ play: true, rate: 1 });
    });

    it("does go to a place it already has: that costs nothing, and brings it back in step", () => {
      expect(syncStep(leader(), thin({ time: 95, targetBuffered: true }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
      expect(syncStep(leader(), me({ time: 95, buffering: true, targetBuffered: true }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
    });

    it("gives up waiting for the picture to arrive when it is far behind", () => {
      expect(syncStep(leader(), thin({ time: 100 - GIVE_UP_S + 1 }), LONG_AGO).seek).toBeUndefined();
      expect(syncStep(leader(), thin({ time: 100 - GIVE_UP_S - 1 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
    });

    it("goes back to a place it still has when it is ahead, and plays slower instead when it has let go of it", () => {
      // (Ahead of a leader that waited: the way back is behind this picture, which has it unless it let go of it.)
      expect(syncStep(leader(), thin({ time: 103, targetBuffered: true }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
      expect(syncStep(leader(), thin({ time: 103 }), LONG_AGO)).toEqual({ play: true, rate: 1 - NUDGE });
    });

    it("keeps to the cooldown after a jump even when it may go", () => {
      expect(syncStep(leader(), thin({ time: 95, targetBuffered: true }), SEEK_COOLDOWN_MS - 1).seek).toBeUndefined();
    });
  });

  describe("a picture that is not playing yet", () => {
    it("goes straight to the place, whatever it has downloaded: it has nothing to run dry, and what it loaded was the wrong place", () => {
      // (A screen that has just joined loads from where the leader was a moment ago and waits there for the first report.)
      expect(syncStep(leader(), thin({ playing: false, time: 90 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
      expect(syncStep(leader(), me({ playing: false, time: 90, ahead: 0, targetBuffered: false }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
    });
  });

  describe("a host that only waits for data", () => {
    const waiting = (patch: Partial<SyncTarget> = {}) => leader({ playing: false, waiting: true, ...patch });

    it("is waited for where the picture is: a hiccup of the host's does not send the guest back to its frame", () => {
      expect(syncStep(waiting(), me({ time: 100.4 }), 0)).toEqual({ play: false, rate: 1 });
      expect(syncStep(waiting(), me({ time: 99.6 }), 0)).toEqual({ play: false, rate: 1 });
      expect(syncStep(waiting(), me({ time: 100 + WAIT_TOLERANCE_S - 0.1 }), 0)).toEqual({ play: false, rate: 1 });
    });

    it("is gone to when it is farther off than that (the guest has that place to download anyway), whichever way", () => {
      expect(syncStep(waiting(), me({ time: 100 + WAIT_TOLERANCE_S + 0.5 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
      expect(syncStep(waiting(), me({ time: 100 - WAIT_TOLERANCE_S - 0.5 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
    });

    it("is not what a pause is: somebody's pause still shows the frame it stopped on", () => {
      expect(syncStep(leader({ playing: false }), me({ time: 100.4 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
      expect(syncStep(leader({ playing: false, waiting: false }), me({ time: 100.4 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
    });
  });

  describe("a host whose place is read from one report only", () => {
    const unsure = (patch: Partial<SyncTarget> = {}) => leader({ settled: false, ...patch });

    it("does not send a picture that is ahead back in time: the report may have been held up on the way, and the jump would have to be undone", () => {
      expect(syncStep(unsure(), me({ time: 103 }), LONG_AGO)).toEqual({ play: true, rate: 1 - NUDGE });
      expect(syncStep(leader({ settled: true }), me({ time: 103 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
      expect(syncStep(leader(), me({ time: 103 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 }); // (no word on it: it is taken as settled)
    });

    it("does send it when it is so far ahead that no late report explains it", () => {
      expect(syncStep(unsure(), me({ time: 100 + FAR_SEEK_S + 1 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
    });

    it("still sends a picture that is behind forward at once: a late report never makes the host look ahead", () => {
      expect(syncStep(unsure(), me({ time: 97 }), LONG_AGO)).toEqual({ play: true, seek: 100, rate: 1 });
    });
  });
});

/** The host's report at `at` seconds on the guest's clock, for a host that plays on from second 100 at the speed of the clock and a link that takes `delay`. */
const report = (at: number, delay = 0.05, patch: Partial<HostReport> = {}): HostReport => ({ playing: true, time: 100 + at - delay, rate: 1, lag: 0.05, ...patch });
/** Where the host really is at `at`. */
const truth = (at: number) => 100 + at;

describe("HostClock", () => {
  it("reads the host's place from a report as leaderNow does, and goes on with the host's speed until the next", () => {
    const clock = new HostClock();
    expect(clock.read({ playing: true, time: 100, rate: 1, lag: 0.2 }, 5)).toBeCloseTo(100.2);
    expect(clock.read({ playing: true, time: 100, rate: 1, lag: 0.2 }, 6)).toBeCloseTo(101.2); // (the same report, a second later: the host has gone on)
    expect(clock.read({ playing: true, time: 100, rate: 2, lag: 0.2 }, 5)).toBeCloseTo(100.4); // (at its own speed)
  });

  it("reads where the host is from the report that was held up least, not from the last", () => {
    const clock = new HostClock();
    expect(clock.read(report(0.05), 0.05)).toBeCloseTo(truth(0.05));
    expect(clock.read(report(1.05), 1.05)).toBeCloseTo(truth(1.05));
    // The next report took two seconds to arrive: it says the host is two seconds behind where it is.
    expect(clock.read(report(4, 2), 4)).toBeCloseTo(truth(4));
    expect(clock.read(report(5, 0.05), 5)).toBeCloseTo(truth(5));
  });

  it("is not moved by reports that come late together, however many", () => {
    const clock = new HostClock();
    clock.read(report(0.05), 0.05);
    clock.read(report(1.05), 1.05);
    // Held up for three seconds, they arrive together; the last of them is the least late.
    expect(clock.read(report(5, 3), 5)).toBeCloseTo(truth(5));
    expect(clock.read(report(5, 3.0), 5)).toBeCloseTo(truth(5));
    expect(clock.read(report(5.01, 2.0), 5.01)).toBeCloseTo(truth(5.01));
  });

  it("does not take a queue that is emptying (each report less late than the one before) for the host having gone back", () => {
    const clock = new HostClock();
    clock.read(report(0.05), 0.05);
    clock.read(report(1.05), 1.05);
    clock.read(report(2.05), 2.05);
    let at = 10;
    for (const delay of [4, 3.2, 2.1, 1.4]) {
      expect(clock.read(report(at, delay), at)).toBeCloseTo(truth(at));
      at += 0.6;
    }
  });

  it("follows a host that went back once two reports from different moments say it did, and not before", () => {
    const clock = new HostClock();
    clock.read(report(0.05), 0.05);
    clock.read(report(1.05), 1.05);
    clock.read(report(2.05), 2.05);
    const back = (at: number) => ({ playing: true, time: truth(at) - 30 - 0.05, rate: 1, lag: 0.05 }); // the host jumped back 30 seconds at 2.5
    expect(clock.read(back(3.05), 3.05)).toBeCloseTo(truth(3.05)); // one report: the old place goes on
    expect(clock.read(back(3.1), 3.1)).toBeCloseTo(truth(3.1)); // another, but right behind it: one late delivery, not a second look
    expect(clock.read(back(4.05), 4.05)).toBeCloseTo(truth(4.05) - 30); // from another moment, and the same: it did
    expect(clock.settled).toBe(true);
    expect(clock.read(back(5.05), 5.05)).toBeCloseTo(truth(5.05) - 30);
  });

  it("does not doubt a report that is only later than most when all of them are late by something different: that is the link's way", () => {
    const clock = new HostClock();
    // Each is a little later than the one that made the spread so far (each is within twice of what they differ by), the best being the first.
    for (const [at, delay] of [[0.05, 0.05], [1.05, 0.39], [2.05, 0.72], [3.05, 1.35]] as const) expect(clock.read(report(at, delay), at)).toBeCloseTo(truth(at));
    // Late by 1.2 s, against a best that was late by 0.05: behind by less than the reports differ among themselves, and not in doubt.
    expect(clock.read(report(4, 1.2), 4)).toBeCloseTo(truth(4));
    expect(clock.read(report(5, 1.2), 5)).toBeCloseTo(truth(5)); // (two of them, a second apart: still no host that went back)
  });

  it("does take two reports that are late by the same, a second apart, for a host that went back when the reports before them were all on time", () => {
    const clock = new HostClock();
    clock.read(report(0.05), 0.05);
    clock.read(report(1.05), 1.05);
    expect(clock.read(report(3, 0.9), 3)).toBeCloseTo(truth(3)); // one: in doubt
    expect(clock.read(report(4, 0.9), 4)).toBeCloseTo(truth(4) - 0.85); // two: from another moment, and the same
  });

  it("forgets the reports of long ago", () => {
    const clock = new HostClock();
    clock.read(report(0.05), 0.05);
    const later = CLOCK_WINDOW_S + 1;
    // The host has been playing slower for a while: what the first report said about its speed is not to be believed any more.
    expect(clock.read({ playing: true, time: truth(0.05) + 5, rate: 1, lag: 0.05 }, later)).toBeCloseTo(truth(0.05) + 5 + 0.05);
  });

  it("is only a place for a host that holds still, and starts again when it goes on, or goes at another speed", () => {
    const clock = new HostClock();
    clock.read(report(0.05), 0.05);
    clock.read(report(1.05), 1.05);
    expect(clock.settled).toBe(true);
    expect(clock.read({ playing: false, time: 50, rate: 1, lag: 0.05 }, 2)).toBe(50);
    expect(clock.settled).toBe(false);
    expect(clock.read({ playing: true, time: 50, rate: 1, lag: 0.05 }, 3)).toBeCloseTo(50.05); // (the old reports are of no use for a host that was somewhere else)
    expect(clock.read({ playing: true, time: 60, rate: 1.5, lag: 0 }, 4)).toBeCloseTo(60);
  });

  it("is settled only when reports from different moments agree", () => {
    const clock = new HostClock();
    expect(clock.settled).toBe(false);
    clock.read(report(0.05), 0.05);
    expect(clock.settled).toBe(false);
    clock.read(report(0.2), 0.2);
    expect(clock.settled).toBe(false); // (a moment apart is not enough)
    clock.read(report(0.05 + CLOCK_CONFIRM_S), 0.05 + CLOCK_CONFIRM_S);
    expect(clock.settled).toBe(true);
  });

  it("can be reset, for another film", () => {
    const clock = new HostClock();
    clock.read(report(0.05), 0.05);
    clock.read(report(1.05), 1.05);
    clock.reset();
    expect(clock.settled).toBe(false);
    expect(clock.read({ playing: true, time: 5, rate: 1, lag: 0 }, 2)).toBeCloseTo(5);
  });
});

describe("Follower", () => {
  const picture = (patch: Partial<Omit<SyncLocal, "targetBuffered">> = {}) => ({ playing: true, time: 100, rate: 1, buffering: false, ahead: 60, ...patch });
  const everything = () => true;

  it("keeps a picture that is in step as it is", () => {
    const follower = new Follower();
    expect(follower.step(report(1), picture({ time: truth(1) }), 1, everything)).toEqual({ play: true, rate: 1 });
  });

  it("sends a picture that is behind to where the host is, once, and lets it fill before it sends it again", () => {
    const follower = new Follower();
    const first = follower.step(report(1), picture({ time: truth(1) - 5 }), 1, everything);
    expect(first.seek).toBeCloseTo(truth(1));
    expect(follower.step(report(2), picture({ time: truth(2) - 5 }), 2, everything).seek).toBeUndefined();
    expect(follower.step(report(2 + SEEK_COOLDOWN_MS / 1000 + 0.1), picture({ time: truth(5.2) - 5 }), 2 + SEEK_COOLDOWN_MS / 1000 + 0.1, everything).seek).toBeDefined();
  });

  it("does not send a picture back in time on one report, but does on a second from another moment", () => {
    const follower = new Follower();
    const ahead = (at: number) => picture({ time: truth(at) + 3 });
    const first = follower.step(report(1), ahead(1), 1, everything);
    expect(first.seek).toBeUndefined();
    expect(first.rate).toBeLessThan(1);
    expect(follower.step(report(2), ahead(2), 2, everything).seek).toBeCloseTo(truth(2));
  });

  it("asks whether the place it read for the host is downloaded, not the place the report named", () => {
    const follower = new Follower();
    const has = vi.fn(() => true);
    follower.step({ playing: true, time: 100, rate: 1, lag: 0.5 }, picture(), 1, has);
    expect(has).toHaveBeenCalledWith(100.5);
  });

  it("waits for a host that waits, where it is", () => {
    const follower = new Follower();
    expect(follower.step({ playing: false, time: truth(3), rate: 1, waiting: true }, picture({ time: truth(3) + 0.3 }), 3, everything)).toEqual({ play: false, rate: 1 });
  });

  it("forgets what it read of the host when the film changes", () => {
    const follower = new Follower();
    follower.step(report(1), picture({ time: truth(1) }), 1, everything);
    follower.step(report(2), picture({ time: truth(2) }), 2, everything);
    follower.reset();
    // Another film, the host at 90 s and so is this picture. With the old reads kept the host would be read to be at about 103, and this picture sent there.
    expect(follower.step({ playing: true, time: 90, rate: 1, lag: 0 }, picture({ time: 90 }), 3, everything)).toEqual({ play: true, rate: 1 });
  });

  it("keeps count of what it did, for the debug panel", () => {
    Object.assign(syncStats, { reports: 0, seeks: 0, rewinds: 0, speedChanges: 0, waits: 0, drift: 0, settled: false });
    const follower = new Follower();
    follower.step(report(1), picture({ time: truth(1) + 0.4 }), 1, everything); // a little ahead: slows down
    follower.step({ playing: false, time: truth(2), rate: 1, waiting: true }, picture({ time: truth(2) }), 2, everything); // the host waits
    follower.step(report(10), picture({ time: truth(10) - 6 }), 10, everything); // far behind: jumps
    expect(syncStats).toMatchObject({ reports: 3, seeks: 1, rewinds: 0, speedChanges: 1, waits: 1 });
    expect(syncStats.drift).toBeCloseTo(-6.05, 1);
  });
});

describe("describeSync", () => {
  it("says nothing for a page that follows nobody", () => {
    expect(describeSync({ reports: 0, seeks: 0, rewinds: 0, speedChanges: 0, waits: 0, drift: 0, settled: false })).toBeNull();
  });

  it("says in a line how far from the host the picture is, and what it has had to do about it", () => {
    const line = describeSync({ reports: 42, seeks: 3, rewinds: 1, speedChanges: 14, waits: 2, drift: -0.123, settled: true });
    expect(line).toBe("sync: 42 reports  now −0.12s from the host  jumps 3 (1 back)  speed changes 14  host waits 2");
    expect(describeSync({ reports: 1, seeks: 0, rewinds: 0, speedChanges: 0, waits: 0, drift: 0.4, settled: false })).toContain("+0.40s from the host (not settled)");
  });
});
