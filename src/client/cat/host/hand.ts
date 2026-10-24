/**
 * Petting with a pointer. A mouse that rests on the cat for a moment strokes it (one that only passes over does not), and goes on stroking for as
 * long as it stays; a press (a click, a tap) strokes at once; and when the pointer leaves, the hand is taken away. Pure: the times in, what to tell
 * the cat out, so it can be tested without a screen.
 */

import type { Clip } from "../types";

/** How long a mouse rests on the cat before it is stroked, and how often a hand that stays tells the cat so again (the cat lets go a little after the last word). */
export const DWELL_MS = 320;
export const REPEAT_MS = 1000;

/**
 * Whether a hand may be put on the cat in this posture at all: not on one that hauls itself up over a lip (the frame is the point it ends up at, and the picture hangs below it, so a box there would
 * be on nothing), nor on one going up the face of a card to a lip (it is busy, as it is in the climb it ends in, and is not taken off the face).
 */
export const handFits = (clip: Clip): boolean => clip !== "climb" && clip !== "scale";

export type HandSays = "pet" | "end" | null;

export class Hand {
  private since = -1;
  private last = -1e9;
  private on = false;

  /** Every frame, with the time and whether the pointer is over the cat now. */
  step(now: number, over: boolean): HandSays {
    if (!over) {
      const was = this.on;
      this.since = -1;
      this.on = false;
      return was ? "end" : null;
    }
    if (this.since < 0) this.since = now;
    if (!this.on) {
      if (now - this.since < DWELL_MS) return null;
      this.on = true;
      this.last = now;
      return "pet";
    }
    if (now - this.last >= REPEAT_MS) {
      this.last = now;
      return "pet";
    }
    return null;
  }

  /** A press on the cat: it is stroked now, whatever the wait. */
  press(now: number): "pet" {
    this.on = true;
    this.since = now;
    this.last = now;
    return "pet";
  }

  /** Whether a hand is on the cat. */
  get stroking(): boolean {
    return this.on;
  }
}
