/**
 * What sort of cat it is: a small table of named numbers that the cat's choices read (no choice asks which cat it is). The first table is the cat as it has always been, `BASELINE`; any
 * other is measured against it.
 */
export interface Temperament {
  /**
   * Being held by the scruff: the seconds it hangs calm before it begins to fight, how hard it fights at the most (0..1, see `CatFrame.struggle`) and how long a bout of it lasts before it
   * goes limp (seconds).
   */
  heldCalm: number;
  heldStrength: number;
  heldStamina: number;
  /**
   * What a cat that fought the hand does when it lands, in relative weights: the tail flick and the walk away (`huff`), a wash as if it had meant to land there (`groom`), a fright and a bolt
   * (`startle`), a shake of the whole body (`shake`).
   */
  temper: { huff: number; groom: number; startle: number; shake: number };
}

export const BASELINE: Temperament = {
  heldCalm: 2.2,
  heldStrength: 0.85,
  heldStamina: 3,
  temper: { huff: 0.4, groom: 0.3, startle: 0.1, shake: 0.2 },
};
