/**
 * What sort of cat it is: a small table of named numbers that the cat's choices read (no choice asks which cat it is). `BASELINE` is the cat as it has always been, and the one every test and
 * every tool starts from; the two cats a viewer can choose are measured against it: the ginger cat is friendly, curious and restless, the white and grey ragdoll is grumpy and lazy.
 *
 * Every number that is 1 (or 0, or `Infinity`, where that is the neutral one) leaves what it is about exactly as it was, down to the random numbers drawn: the table of `BASELINE` makes the cat
 * of before, step for step.
 */
export interface Temperament {
  /** Which table this is (for a tool, a test or the console to say); a table made by hand is `"custom"`. */
  name: string;

  /* ---- being held by the scruff ---- */
  /**
   * The seconds it hangs calm before it begins to fight, how hard it fights at the most (0..1, see `CatFrame.struggle`) and how long a bout of it lasts before it goes limp (seconds).
   */
  heldCalm: number;
  heldStrength: number;
  heldStamina: number;
  /**
   * What a cat that fought the hand does when it lands, in relative weights: the tail flick and the walk away (`huff`), a wash as if it had meant to land there (`groom`), a fright and a bolt
   * (`startle`), a shake of the whole body (`shake`).
   */
  temper: { huff: number; groom: number; startle: number; shake: number };

  /* ---- going about ---- */
  /** How fast it walks and runs, as a share of the usual (a leap is a leap: how high and far it goes is not a matter of temperament). */
  speed: number;
  /**
   * Where its energy and its curiosity settle when nothing moves them (the energy swings round the first, see `LIVELY_SWING`), and how fast it tires, as a share of the usual. (A cat's mood
   * starts where those are, and moves with them if the table is changed under it.)
   */
  energy: number;
  curiosity: number;
  drowsiness: number;
  /** How long a rest, a stop on its walk and a nap last, as a share of the usual. */
  stay: number;
  /**
   * How much it cares for each thing it might do, as a share of how much that is worth (`choose` has the names: `wander`, `hop`, `zoomies`, `sleep`, `rest`, `groom`, `pat`, `visit`,
   * `greet`...). What is not named is 1. (Getting up from the foot of the screen, or off a shelf with no room for it, is not a matter of taste: a `hop` that is that is not scaled.)
   */
  likes: Readonly<Record<string, number>>;

  /* ---- being stroked, woken, and dashed at ---- */
  /**
   * How long one hand may stroke it before it has had enough, in seconds (`Infinity`: it never has). Each hand's allowance is drawn from 0.7 to 1.3 of that, a quarter of it while the cat is still
   * sulking, and less the sleepier the cat is. At 0.7 of it the cat warns the hand (the tail flicks, the ears go back).
   */
  petPatience: number;
  /** The chance that a hand that wakes it by stroking it finds it annoyed (it gets up, and goes). */
  wakeGrump: number;
  /** The chance that a cat that has had enough of a hand swats at it before it goes (once, or twice); and, half of that, the chance that it swats at a pointer that dashes at it instead of only starting. */
  swatsHand: number;
  /** How long it stays touchy after a hand has annoyed it, or after it fought one that held it, in seconds. */
  sulk: number;
  /** The chance, at each stroke (and not within 3.5 seconds of the last time), that it is glad of it, with the joy of a lifted tail and ears. */
  petJoy: number;
}

export const BASELINE: Temperament = {
  name: "baseline",
  heldCalm: 2.2,
  heldStrength: 0.85,
  heldStamina: 3,
  temper: { huff: 0.4, groom: 0.3, startle: 0.1, shake: 0.2 },
  speed: 1,
  energy: 0.32,
  curiosity: 0.28,
  drowsiness: 1,
  stay: 1,
  likes: {},
  petPatience: Infinity,
  wakeGrump: 0,
  swatsHand: 0,
  sulk: 0,
  petJoy: 0,
};

/**
 * The ginger cat: friendly, curious, playful and restless. It goes about more and faster, looks into everything, comes over to whoever is there, runs the zoomies, loves to be stroked, never swats a
 * hand, forgives being picked up, and washes or shakes itself off when it is put down annoyed, and does not huff.
 */
export const GINGER: Temperament = {
  ...BASELINE,
  name: "ginger",
  heldCalm: 3.6,
  heldStrength: 0.55,
  heldStamina: 2,
  temper: { huff: 0.1, groom: 0.45, startle: 0.1, shake: 0.35 },
  speed: 1.12,
  energy: 0.42,
  curiosity: 0.4,
  drowsiness: 0.75,
  stay: 0.8,
  likes: { wander: 1.15, hop: 1.2, watch: 1.3, follow: 1.3, inspect: 1.4, greet: 1.5, visit: 1.3, pat: 1.2, bat: 1.3, zoomies: 1.8, rest: 0.85, sleep: 0.7, groom: 0.9, yawn: 0.8 },
  petJoy: 0.5,
};

/**
 * The white and grey ragdoll: grumpy and lazy. It rests, washes and sleeps more, goes about less and slower, hardly ever runs the zoomies, is soon annoyed by a hand and swats it, wakes up cross,
 * fights hard and at once when it is held, and is slow to forgive.
 */
export const RAGDOLL: Temperament = {
  ...BASELINE,
  name: "ragdoll",
  heldCalm: 0.8,
  heldStrength: 1,
  heldStamina: 4.5,
  temper: { huff: 0.65, groom: 0.1, startle: 0.05, shake: 0.2 },
  speed: 0.85,
  energy: 0.22,
  curiosity: 0.2,
  drowsiness: 1.4,
  stay: 1.35,
  likes: { wander: 0.65, hop: 0.7, prowl: 0.5, zoomies: 0.3, follow: 0.7, inspect: 0.7, greet: 0.55, visit: 0.5, pat: 0.6, bat: 0.6, ponder: 0.8, rest: 1.25, sleep: 1.5, groom: 1.3, yawn: 1.3, stretch: 1.1 },
  petPatience: 7,
  wakeGrump: 0.55,
  swatsHand: 0.65,
  sulk: 45,
};

export const TEMPERAMENTS: Readonly<Record<string, Temperament>> = { baseline: BASELINE, ginger: GINGER, ragdoll: RAGDOLL };

/** The temperament of a cat chosen in the settings (`look`): the table of its name, and the baseline for a name it does not know. */
export const temperamentOf = (name: string): Temperament => TEMPERAMENTS[name] ?? BASELINE;

/**
 * How much a cat of this temperament cares for doing something (`likes`; what is not there is as the cat as it was). A leap that is getting up from where the cat should not stay (`forced`: the
 * foot of the screen, a shelf with no room for it) is not a matter of taste: it is worth what it is worth to every cat, and the cats get up at the same pace.
 */
export const tasteFor = (temperament: Temperament, option: string, forced: boolean): number => (forced && option === "hop" ? 1 : (temperament.likes[option] ?? 1));
