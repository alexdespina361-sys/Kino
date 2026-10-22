/**
 * The contract between the parts of the cat companion (see reports/kino-cat/03-architecture-and-event-contracts.md):
 *
 *   page (DOM adapters) -> World snapshot -> engine (brain + motion) -> CatFrame -> renderer (rig + canvas)
 *
 * Everything the engine knows about the page is a `World` of plain numbers, and everything the renderer knows about the cat is one
 * `CatFrame`, so each side can be tested, and replaced (another art pack, another page), without the other.
 * All coordinates are CSS pixels in the viewport (y grows downward); the cat's position is the point on its ground line under the middle of its body.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------ what the page looks like to the cat ------------------------------ */

/**
 * The kinds of place the cat knows. Walkable ones are `shelfTop` (the line along the tops of a row of posters), `heroLedge`, `playerPerch`
 * and `fallbackFloor`; `recommendationTarget` is a poster to look at or point to; the rest are zones the cat keeps out of.
 */
export type AnchorKind =
  | "shelfTop"
  | "posterTop"
  | "heroLedge"
  | "recommendationTarget"
  | "playerPerch"
  | "fallbackFloor"
  | "catHome"
  | "modalExclusionZone"
  | "subtitleSafeRect"
  | "remoteFocusZone";

/** A place on the page the cat can stand on: a horizontal line `y` from `x0` to `x1`. */
export interface Surface {
  id: string;
  kind: AnchorKind;
  y: number;
  x0: number;
  x1: number;
  /** The wish to be here when nothing else decides (a row's top is better than a card's corner); 0..1. */
  weight: number;
}

/** Something the cat looks at or points to (a poster), with what it is (the catalogue's id, for recommendations). */
export interface Target {
  id: string;
  rect: Rect;
  /** The surface right under it, when there is one: where the cat stands to be next to it. */
  surfaceId?: string;
}

export type PlayerMode = "none" | "loading" | "playing" | "paused" | "ended" | "error";

export interface World {
  viewport: Rect;
  /** How long the cat's body is, in pixels: everything the cat does is measured in these. */
  bodyLength: number;
  surfaces: Surface[];
  /** Where the cat must not be (text, buttons, menus, subtitles, what has the focus). The cat never stands where its body would cover one. */
  keepOut: Rect[];
  targets: Target[];
  /**
   * Words the cat may cross but would rather not settle in front of (the names under the cards). Unlike `keepOut` they cut nothing: a cat that is going to
   * rest for a while looks along its shelf for a spot where its body, in the posture it takes, covers none of them, and takes it if there is one.
   */
  soft?: Rect[];
  /** What has the remote's focus (or the pointer), where the viewer is looking. */
  focus?: Rect;
  /** Where the pointer is, when it moved lately. */
  pointer?: Vec;
  mode: "browse" | "player" | "away";
  player: PlayerMode;
  /** Whether the controls are showing (and the subtitles ride above them). */
  controlsUp: boolean;
  /** Whether the viewer asked for quiet: no roaming, only resting. */
  quiet: boolean;
  /** `prefers-reduced-motion`: the cat only rests, in one place. */
  reducedMotion: boolean;
  /**
   * When the page was last read (the host's clock, in milliseconds), for a host that hands the cat the very same world while the page has not changed: that world, read again and found as it
   * was, has a later `readAt`. The cat takes another `readAt` for another reading of the page (a page that was read and had not moved is one that is still, and not one that has not been read
   * yet). Optional: without it, a world is read afresh when it is another object.
   */
  readAt?: number;
}

/* ------------------------------ what the cat is doing ------------------------------ */

/**
 * The cat's postures and actions, which the renderer draws. One-shot clips (`jump`, `stretch`, `yawn`, and the little scenes `groom`, `scratch`,
 * `knead`, `sniff` and `wiggle`) say how far along they are in `progress`. `stalk` is a walk, low, and slow, at something.
 * (Turning around, appearing and fading are not clips: the renderer works them out from `facing` and `appear`.)
 */
export type Clip =
  | "stand"
  | "walk"
  | "run"
  | "sit"
  | "loaf"
  | "curl"
  | "crouch"
  | "jump"
  | "stretch"
  | "yawn"
  | "groom"
  | "pet"
  | "point"
  | "scratch"
  | "knead"
  | "sniff"
  | "stalk"
  | "wiggle"
  /** Looking down over the edge of a shelf (at where it will land, or at a poster on the shelf below): the front of it lowered, the head out over the edge. */
  | "peek"
  /** A forepaw batting at something (the pointer): the same reach as `point`, repeated. */
  | "tap"
  /** One swat at a poster the cat found for the viewer: the paw drawn back, a quick stroke down onto it (`reach` is where it lands, at `SWAT_HIT` of the way), and drawn back again. */
  | "swat"
  /** Nodding off: a loaf, the head dropping and jerking up again, the eyes heavy. */
  | "doze"
  /** A sleeper changing its position: it half wakes, lifts its head, and curls up again. */
  | "shift";

/**
 * How the cat feels, a face and a tail more than a body: laid over whatever it is doing (a cat can tilt its head as it sits, stands or walks).
 * `tilt` is the quizzical look at whoever is there, `think` a look away and up, `startle` a flinch (ears flat, eyes wide), `joy` a lift (ears up, tail up and
 * quivering), `droop` a letdown (ears out, head low, slow blink).
 */
export type Emote = "none" | "tilt" | "think" | "startle" | "joy" | "droop";

/** How a jump's `progress` is shared out: crouching to push off, the flight, then the landing and settling. */
export const JUMP_TAKEOFF = 0.22;
export const JUMP_LANDING = 0.8;

/** How far through a swat the paw lands: the page answers (the poster gives and rocks) as `progress` passes this. */
export const SWAT_HIT = 0.44;

/** Everything the renderer is told, every frame. */
export interface CatFrame {
  /** The point on the ground under the middle of the body. */
  x: number;
  y: number;
  /** 1: faces right. -1: faces left. */
  facing: 1 | -1;
  clip: Clip;
  /** Seconds since this clip started (for cycles that are not tied to distance). */
  clipTime: number;
  /** 0..1 through a one-shot clip (a jump from the first crouch to the last settling). */
  progress: number;
  /** Pixels walked since the cat was made: the legs' steps are worked out from it, so a foot on the ground does not slide. */
  odometer: number;
  vx: number;
  vy: number;
  grounded: boolean;
  /** A point in the viewport the cat looks at (its eyes first, then its head). */
  look?: Vec;
  /** The cat looks out of the screen, at whoever is there. (Wins over `look`.) */
  viewer: boolean;
  /** For `point`: where the paw reaches to. */
  reach?: Vec;
  /** 0: wide awake, 1: asleep (closed eyes, slow breathing). */
  drowsy: number;
  /** 0..1: how lively the cat is just now (a tail that swishes more, wider eyes, quicker breathing). */
  energy: number;
  /** 0..1: fades the cat in and out (also a little growth). */
  appear: number;
  /** Something has a hand on it: it leans in and closes its eyes. */
  petted: boolean;
  /** A hand has it by the scruff and is carrying it somewhere: it hangs from the hand (`x`,`y` are still its feet, a little below the grip). */
  carried: boolean;
  /** What it feels just now (see `Emote`); none when it does not say. */
  emote?: Emote;
}

/* ------------------------------ what the page tells the cat ------------------------------ */

/** The events the cat reacts to (see EventAdapter in the architecture notes). They are about intent, never about frames. */
export type CatEvent =
  | { type: "cat.enable" }
  | { type: "cat.disable" }
  | { type: "cat.pet"; at?: Vec }
  | { type: "cat.petEnd" }
  /** A hand takes hold of the cat (a pointer pressed on it and then moved), carries it (`at` is where the hand is, said again as it moves) and lets go. */
  | { type: "cat.grab"; at: Vec }
  | { type: "cat.carry"; at: Vec }
  | { type: "cat.drop" }
  | { type: "cat.call"; at: Vec }
  /** What the page found out for the cat: a title that was found (a little bounce of joy) or none (a letdown), for the cat to show it feels. */
  | { type: "cat.react"; kind: "found" | "empty" }
  | { type: "cat.command"; command: "sit" | "sleep" | "play" | "away" | "come" }
  | { type: "route.enter"; page: string }
  | { type: "route.leave" }
  | { type: "catalog.itemFocused"; id: string }
  | { type: "catalog.searchCompleted"; requestId: number; ids: string[] }
  | { type: "cat.point"; targetId: string }
  | { type: "player.play" | "player.pause" | "player.resume" | "player.ended" | "player.error" }
  | { type: "player.enterFullscreen" | "player.exitFullscreen" }
  | { type: "ui.modalOpened" | "ui.modalClosed" }
  | { type: "viewport.resized" }
  | { type: "app.visibility"; visible: boolean }
  | { type: "device.quality"; quality: "full" | "low" };
