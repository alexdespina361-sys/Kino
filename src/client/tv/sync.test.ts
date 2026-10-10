import { describe, expect, it } from "vitest";
import { HARD_SEEK_S, NUDGE, SEEK_COOLDOWN_MS, syncStep, type SyncLocal, type SyncTarget } from "./sync";

const leader = (patch: Partial<SyncTarget> = {}): SyncTarget => ({ playing: true, time: 100, rate: 1, ...patch });
const me = (patch: Partial<SyncLocal> = {}): SyncLocal => ({ playing: true, time: 100, rate: 1, buffering: false, ...patch });
const LONG_AGO = SEEK_COOLDOWN_MS * 10;

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
    expect(syncStep(leader({ playing: false }), me({ time: 100.3 }), LONG_AGO)).toEqual({ play: false, rate: 1 });
    expect(syncStep(leader({ playing: false }), me({ time: 103 }), 0)).toEqual({ play: false, seek: 100, rate: 1 });
  });

  it("starts playing again when the leader does", () => {
    expect(syncStep(leader(), me({ playing: false }), LONG_AGO).play).toBe(true);
  });
});
