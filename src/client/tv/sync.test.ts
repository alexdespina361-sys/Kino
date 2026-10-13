import { describe, expect, it } from "vitest";
import { GIVE_UP_S, HARD_SEEK_S, NUDGE, NUDGE_FROM_S, NUDGE_UNTIL_S, SEEK_COOLDOWN_MS, THIN_BUFFER_S, syncStep, type SyncLocal, type SyncTarget } from "./sync";

const leader = (patch: Partial<SyncTarget> = {}): SyncTarget => ({ playing: true, time: 100, rate: 1, ...patch });
// (By default a picture with plenty downloaded, the leader's place included.)
const me = (patch: Partial<SyncLocal> = {}): SyncLocal => ({ playing: true, time: 100, rate: 1, buffering: false, ahead: 60, targetBuffered: true, ...patch });
/** A picture playing with next to nothing downloaded ahead: about to wait for data. */
const thin = (patch: Partial<SyncLocal> = {}): SyncLocal => me({ ahead: THIN_BUFFER_S - 1, targetBuffered: false, ...patch });
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

  describe("a little apart", () => {
    it("does not start a nudge for the moment a report takes to arrive", () => {
      // (Every report is a little old when it arrives, so a picture that is exactly in step looks a little ahead on each.)
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
      expect(syncStep(leader({ rate: 2 }), me({ rate: 2, time: 100.25 }), LONG_AGO)).toEqual({ play: true, rate: 2 });
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
});
