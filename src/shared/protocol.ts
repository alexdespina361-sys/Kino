import { z } from "zod";
import { AvatarIdSchema, TagNumberSchema } from "./account";
import { CaptionStyleSchema } from "./captions";
import { MAX_ALTERNATES, NormalizedMediaSchema, PlayHintSchema } from "./media";

/* ------------------------------ player ------------------------------ */

export const PlayerQualityLevelSchema = z.object({
  id: z.number().int(),
  label: z.string().max(100),
  height: z.number().int().optional(),
  bitrate: z.number().optional(),
});
export type PlayerQualityLevel = z.infer<typeof PlayerQualityLevelSchema>;

export const PlayerTrackSchema = z.object({
  id: z.number().int(),
  label: z.string().max(100),
  lang: z.string().max(20).optional(),
});
export type PlayerTrack = z.infer<typeof PlayerTrackSchema>;

const StartAtSchema = z.number().finite().min(0).max(86_400);

/** The speeds offered on the phone and on the TV. The TV accepts anything from 0.25× to 4×. */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** What a guest of a watch party can do to the film once the host has made it an admin: the playback, for everyone. */
const PlayCommand = z.object({ type: z.literal("PLAY") });
const PauseCommand = z.object({ type: z.literal("PAUSE") });
const SeekCommand = z.object({ type: z.literal("SEEK"), time: StartAtSchema });
/** Relative jump from wherever the TV really is, so quick repeated taps on the phone add up. */
const SkipCommand = z.object({ type: z.literal("SKIP"), seconds: z.number().finite().min(-3600).max(3600) });
const StopCommand = z.object({ type: z.literal("STOP") });
const NextEpisodeCommand = z.object({ type: z.literal("NEXT_EPISODE") });

export const CommandSchema = z.discriminatedUnion("type", [
  /** `startAt` resumes a video where it was left off; the TV seeks there as soon as it can. */
  z.object({ type: z.literal("LOAD"), media: NormalizedMediaSchema, startAt: StartAtSchema.optional() }),
  PlayCommand,
  PauseCommand,
  SeekCommand,
  SkipCommand,
  StopCommand,
  z.object({ type: z.literal("SET_QUALITY"), level: z.number().int() }),
  z.object({ type: z.literal("SET_SUBTITLE"), track: z.number().int() }),
  /** Any of the caption look settings; what isn't mentioned stays as it is. */
  z.object({ type: z.literal("SET_CAPTION_STYLE"), style: CaptionStyleSchema.partial() }),
  z.object({ type: z.literal("SET_SPEED"), rate: z.number().finite().min(0.25).max(4) }),
  z.object({ type: z.literal("SET_AUDIO"), track: z.number().int() }),
  /** Play the video from another of its sources (0 is the main one). It carries on from where it was. */
  z.object({ type: z.literal("SET_SOURCE"), index: z.number().int().min(0).max(MAX_ALTERNATES) }),
  z.object({ type: z.literal("TOGGLE_FULLSCREEN") }),
  NextEpisodeCommand,
  /** Turn the Up Next card down: the next episode does not start by itself this time (the same as Cancel on the TV). */
  z.object({ type: z.literal("DISMISS_UP_NEXT") }),
  /** The phone signed devices out of the account: the TV looks at its own sign-in now, not at its next regular exchange with the server. */
  z.object({ type: z.literal("REFRESH_ACCOUNT") }),
  z.object({ type: z.literal("SET_SUBTITLE_DELAY"), delay: z.number().finite().min(-60).max(60) }),
]);
export type Command = z.infer<typeof CommandSchema>;

/** The commands an admin guest of a watch party may give (see TV_PARTY_CMD): the film's playback, nothing else of the host's screen. */
export const PartyCommandSchema = z.discriminatedUnion("type", [PlayCommand, PauseCommand, SeekCommand, SkipCommand, StopCommand, NextEpisodeCommand]);
export type PartyCommand = z.infer<typeof PartyCommandSchema>;

export const PlayerStateSchema = z.object({
  state: z.enum(["idle", "loading", "playing", "paused", "error"]),
  currentTime: z.number().finite().min(0),
  duration: z.number().finite().min(0),
  /** Set when state is "error", e.g. SOURCE_NOT_DIRECTLY_PLAYABLE. */
  error: z.string().max(100).optional(),
  /** Playing (or seeking) but waiting for data. Drives the spinner on the TV and the phone. */
  buffering: z.boolean().optional(),
  /** End of the buffered range around the playhead, in seconds. Drives the grey bar. */
  bufferedEnd: z.number().finite().min(0).optional(),
  playbackRate: z.number().finite().min(0.25).max(4).optional(),
  /** The stream of the media this state is about. The phone can know the new video a moment before the TV reports on it. */
  stream: z.string().max(2048).optional(),
  /** The sources of this video, when it has more than one, and which one is playing. */
  sources: z.object({ labels: z.array(z.string().max(60)).max(MAX_ALTERNATES + 1), current: z.number().int().min(0) }).optional(),
  /** The TV page is full screen. Reported so the phone's button shows what it will do. */
  fullscreen: z.boolean().optional(),
  /** The picture played to its end and stays on the last frame. The phone says so instead of "paused". */
  ended: z.boolean().optional(),
  /** The next episode is on its way (the TV shows its Up Next card): it starts in `seconds`, or on request only (null) for a viewer who has that turned off. */
  upNext: z.object({ seconds: z.number().int().min(0).max(120).nullable() }).optional(),
  /** How subtitles look right now, so the phone's style sheet shows the real values. */
  captionStyle: CaptionStyleSchema.optional(),
  /** Subtitle delay in seconds, positive for later, negative for earlier. */
  subtitleDelay: z.number().finite().optional(),
  quality: z
    .object({
      levels: z.array(PlayerQualityLevelSchema),
      /** The quality that was picked, or -1 while the player chooses by itself (what it has chosen is `active`). */
      current: z.number().int(),
      /** The quality the picture is in right now, when it is known. */
      active: z.number().int().optional(),
    })
    .optional(),
  subtitles: z
    .object({
      tracks: z.array(PlayerTrackSchema),
      current: z.number().int(),
    })
    .optional(),
  audio: z
    .object({
      tracks: z.array(PlayerTrackSchema),
      current: z.number().int(),
    })
    .optional(),
});
export type PlayerState = z.infer<typeof PlayerStateSchema>;

export const IDLE_STATE: PlayerState = { state: "idle", currentTime: 0, duration: 0 };

/* ------------------------------ pairing ------------------------------ */

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export const PairingCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  /** Remaining lifetime rather than a timestamp, so clock skew between server and TV is irrelevant. */
  expiresInMs: z.number().int().min(0),
});
export type PairingCode = z.infer<typeof PairingCodeSchema>;

const TvInfoSchema = z.object({
  name: z.string(),
  online: z.boolean(),
  controlCode: z.string().max(20).optional(),
  controllerCount: z.number().int().optional(),
});
export type TvInfo = z.infer<typeof TvInfoSchema>;

/** How many other TVs can watch along with one: a party is the TV the phone controls plus up to this many. */
export const MAX_FOLLOWERS = 5;

/** The longest link a phone or a TV can ask the server to play (a longer one is refused as a message the server cannot read). */
export const MAX_LINK_LENGTH = 2048;

/** The longest a report of the host's position is taken to have been on its way to a guest, in seconds (a longer one is a bad link, not something to correct for). */
export const MAX_LAG_S = 2;

/** Who is signed in on a screen, as the party sees them: the profile's name, picture and tag. Only what the server has checked (see TV_PROFILE), and only for a profile that lets friends find it. */
export const PartyProfileSchema = z.object({ name: z.string().max(60), avatar: AvatarIdSchema, tag: TagNumberSchema });
export type PartyProfile = z.infer<typeof PartyProfileSchema>;

/**
 * A screen in a party, as the lists show it. `id` is for removing it; the screen's own id is its secret and stays on the server.
 * `admin`: a guest whose screen the host has given the playback to, as its own (see TV_PARTY_CMD). The host is always one, and is not marked.
 */
export const PartyTvSchema = z.object({ id: z.string().max(100), name: z.string().max(60), online: z.boolean(), admin: z.boolean().optional(), profile: PartyProfileSchema.optional() });
export type PartyTv = z.infer<typeof PartyTvSchema>;

/** How many TVs one phone can keep on its list. */
export const MAX_PHONE_TVS = 8;

/** One of the TVs a phone has connected to, as its list shows it. `id` is for choosing it; the TV's own id is its secret and stays on the server. */
export const PhoneTvSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(60),
  /** What the screen asked to be called (the profile in use there), when it did: another way to tell two TVs apart. */
  label: z.string().max(60).optional(),
  online: z.boolean(),
  /** The one this phone is controlling now. */
  current: z.boolean(),
});
export type PhoneTv = z.infer<typeof PhoneTvSchema>;

/**
 * The party a TV is in, as it shows it: who is in, and (to the host only) the code the others join with. The host is the
 * screen the others watch along with; everyone else is a guest.
 */
export const PartyViewSchema = z.object({
  role: z.enum(["host", "guest"]),
  /** This TV's own id in the lists below, so they can say which one is "you". */
  you: z.string().max(100),
  host: PartyTvSchema,
  guests: z.array(PartyTvSchema).max(MAX_FOLLOWERS),
  code: PairingCodeSchema.optional(),
});
export type PartyView = z.infer<typeof PartyViewSchema>;

/** Resolver progress shown on the phone: "Finding video..." -> "Video found" -> (TV state takes over). */
export const ResolveStatusSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("resolving") }),
  z.object({ phase: z.literal("found"), media: NormalizedMediaSchema }),
  /** Whoever is at the TV gave up waiting; the phone has nothing more to wait for. */
  z.object({ phase: z.literal("cancelled") }),
  z.object({
    phase: z.literal("failed"),
    reason: z.enum(["invalid_url", "unsupported", "temporary_failure", "tv_offline"]),
    message: z.string().max(300),
  }),
]);
export type ResolveStatus = z.infer<typeof ResolveStatusSchema>;

/* ------------------------------ client -> server ------------------------------ */

export const ClientMessageSchema = z.discriminatedUnion("type", [
  // TV. deviceId doubles as the TV's secret: it is never sent to phones.
  z.object({
    type: z.literal("TV_HELLO"),
    deviceId: z.string().max(100).optional(),
    /** The page has just been opened: this is its first hello, not a reconnect of a page that has been on. A TV that was in the middle of a video is put back on it. */
    opened: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("TV_STATE"),
    state: PlayerStateSchema,
    /** What the TV has on, sent with the report that follows a welcome so that a server which forgot (it was restarted) is told again. */
    media: NormalizedMediaSchema.optional(),
  }),
  z.object({ type: z.literal("TV_NEW_CODE") }),
  z.object({ type: z.literal("TV_NEXT_EPISODE") }),
  z.object({ type: z.literal("TV_PLAY_URL"), url: z.string().max(MAX_LINK_LENGTH), startAt: StartAtSchema.optional(), hint: PlayHintSchema.optional() }),
  /** The TV lets go of its phone: it gets a fresh pairing code and the phone goes back to the code screen. */
  z.object({ type: z.literal("TV_UNPAIR") }),
  /** Whoever is at the TV stopped waiting for a video that will not come: a lookup still running is dropped and what was loading stops. */
  z.object({ type: z.literal("TV_CANCEL") }),
  /** What this screen is called on the others' lists: the profile in use, or nothing for the TV's own name. */
  z.object({ type: z.literal("TV_NAME"), name: z.string().max(60) }),
  /** Whose screen this is: the proof (from `POST /api/profiles/:id/screen`, which only that profile's signed-in account gets) for the profile in use here, or none when nobody is. */
  z.object({ type: z.literal("TV_PROFILE"), proof: z.string().max(100).optional() }),
  /** Start a watch party on this TV: what it plays, the others play along with. Answered with TV_PARTY, which carries the code to join with. */
  z.object({ type: z.literal("TV_PARTY_OPEN") }),
  /** Join the party that a code from its host belongs to. The TV then plays what the host plays. Leaving is TV_UNPAIR. */
  z.object({ type: z.literal("TV_PARTY_JOIN"), code: z.string().max(20) }),
  /** The host sends one guest away (an `id` from TV_PARTY). */
  z.object({ type: z.literal("TV_PARTY_REMOVE"), id: z.string().max(100) }),
  /** The host ends the party: every guest is back on its own. */
  z.object({ type: z.literal("TV_PARTY_CLOSE") }),
  /** The host makes a guest an admin (it can then play, pause, move and stop the film for everyone), or takes that back (an `id` from TV_PARTY). */
  z.object({ type: z.literal("TV_PARTY_ADMIN"), id: z.string().max(100), admin: z.boolean() }),
  /** A guest that is an admin steers the film: the host's screen does what a phone would have it do, and the guests follow it. Taken from no one else. */
  z.object({ type: z.literal("TV_PARTY_CMD"), command: PartyCommandSchema }),
  // Phone
  z.object({ type: z.literal("CTL_HELLO"), controllerId: z.string().max(100).optional() }),
  z.object({ type: z.literal("PAIR"), code: z.string().max(20) }),
  z.object({ type: z.literal("CMD"), command: CommandSchema }),
  /** A page or media URL. The server resolves it to media; the phone never tells the TV what to fetch. */
  z.object({ type: z.literal("PLAY_URL"), url: z.string().max(MAX_LINK_LENGTH), startAt: StartAtSchema.optional(), hint: PlayHintSchema.optional() }),
  /**
   * Forget a TV: the phone is no longer one of its remotes. The one it is controlling when no `id` is given (or one on its list, by an
   * `id` from TVS). A TV left with no phone shows a fresh pairing code; the phone goes back to the code screen if it was the TV it had.
   */
  z.object({ type: z.literal("UNPAIR"), id: z.string().max(100).optional() }),
  /** Control another TV from the list instead (an `id` from TVS). The one it leaves stays paired with this phone and carries on as it was. */
  z.object({ type: z.literal("SWITCH_TV"), id: z.string().max(100) }),
  /** What the TV this phone controls is to be called on the lists (empty: back to its own name). */
  z.object({ type: z.literal("NAME_TV"), name: z.string().max(60) }),
  /** Have another TV watch along: its pairing code, typed on the phone that controls the first TV. */
  z.object({ type: z.literal("ADD_TV"), code: z.string().max(20) }),
  /** Send a TV that is watching along back to its own pairing screen (an `id` from PARTY). */
  z.object({ type: z.literal("REMOVE_TV"), id: z.string().max(100) }),
  /** Ask for the code that lets other screens join this TV's party, starting one if there is none. Answered with PARTY. */
  z.object({ type: z.literal("OPEN_PARTY") }),
  /** End the party this phone's TV hosts: the code stops working and every guest is back on its own. */
  z.object({ type: z.literal("END_PARTY") }),
  /** Make a guest of the party this phone's TV hosts an admin, or take that back (an `id` from PARTY): see TV_PARTY_ADMIN. */
  z.object({ type: z.literal("PARTY_ADMIN"), id: z.string().max(100), admin: z.boolean() }),
  // Keepalive from either kind of client. Answered with PONG, so a silently dead connection is noticed.
  z.object({
    type: z.literal("PING"),
    /** How long the answer to the last PINGs took to come, in milliseconds (the best of the last few). A party uses it to tell how old the position of its host is by the time it gets to a guest. */
    rtt: z.number().finite().min(0).max(60_000).optional(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/* ------------------------------ server -> client ------------------------------ */

export const ServerMessageSchema = z.discriminatedUnion("type", [
  // To TV
  z.object({
    type: z.literal("TV_WELCOME"),
    deviceId: z.string(),
    paired: z.boolean(),
    pairing: PairingCodeSchema.nullable(),
    /** The name of the TV this one is watching along with, if it is. */
    following: z.string().max(60).optional(),
  }),
  /** This TV now watches along with another one: it plays what that one plays, and the other TV's phone controls both. */
  z.object({ type: z.literal("TV_FOLLOWING"), leader: z.string().max(60) }),
  /** Where the TV being followed is, a few times a second. The follower keeps its own picture in step with it. */
  z.object({
    type: z.literal("TV_SYNC"),
    playing: z.boolean(),
    time: z.number().finite().min(0),
    rate: z.number().finite().min(0.25).max(4),
    /** Which stream that position is in (the leader's `PlayerState.stream`). */
    stream: z.string().max(2048).optional(),
    /** About how long this report took to get here, in seconds: half of the leader's round trip to the server and half of this screen's, as each last measured them. A leader that plays has moved on by that much. */
    lag: z.number().finite().min(0).max(MAX_LAG_S).optional(),
    /** Who last set the film going or held it, as that screen is called in the party's lists (`PartyTv.id`): the host's own screen, or a guest that steers. A guest says "Paused by Anna" from it. */
    by: z.string().max(100).optional(),
    /** The film is held only because the leader's picture is waiting for data, not because anybody paused it. */
    waiting: z.boolean().optional(),
    /** The film is held because it played to its end (the leader's `PlayerState.ended`), not because anybody paused it: a guest says it is finished. */
    ended: z.boolean().optional(),
  }),
  /** The party this TV is in has changed (or it has left it: null). Sent again whenever someone joins, leaves or goes offline. */
  z.object({ type: z.literal("TV_PARTY"), party: PartyViewSchema.nullable() }),
  /** A fresh code to show. `control`: not one for the first phone to pair with, but the one that lets another phone in (this TV has a phone already). */
  z.object({ type: z.literal("TV_CODE"), pairing: PairingCodeSchema, control: z.boolean().optional() }),
  /** A phone has connected to this TV: the first one pairs it, a later one joins it. */
  z.object({ type: z.literal("TV_PAIRED") }),
  /** `by`: the guest that steers (see TV_PARTY_CMD) when the command is theirs, as `PartyTv.id`, so the host's screen can say who paused. */
  z.object({ type: z.literal("TV_CMD"), command: CommandSchema, by: z.string().max(100).optional() }),
  /** The phone forgot this TV. Back to the pairing screen with a fresh code. */
  z.object({ type: z.literal("TV_UNPAIRED"), pairing: PairingCodeSchema.nullable() }),
  /** The server is looking up a pasted link; lets the TV say so instead of looking idle. */
  z.object({ type: z.literal("TV_RESOLVING"), active: z.boolean() }),
  // To phone
  z.object({
    type: z.literal("CTL_WELCOME"),
    controllerId: z.string(),
    tv: TvInfoSchema.nullable(),
    media: NormalizedMediaSchema.nullable(),
    state: PlayerStateSchema,
    /** The other TVs watching along. */
    party: z.array(PartyTvSchema).max(MAX_FOLLOWERS).optional(),
    /** Every TV this phone has connected to, the one it controls now among them. */
    tvs: z.array(PhoneTvSchema).optional(),
  }),
  /** The phone's list of TVs, when it changes without the phone having asked (a TV came online or went away, was renamed). */
  z.object({ type: z.literal("TVS"), tvs: z.array(PhoneTvSchema) }),
  /** The guests of the TV's party, and the code to join it with when one is open. */
  z.object({ type: z.literal("PARTY"), tvs: z.array(PartyTvSchema).max(MAX_FOLLOWERS), code: PairingCodeSchema.optional() }),
  z.object({ type: z.literal("TV_STATUS"), online: z.boolean() }),
  z.object({ type: z.literal("MEDIA"), media: NormalizedMediaSchema }),
  z.object({ type: z.literal("STATE"), state: PlayerStateSchema }),
  z.object({ type: z.literal("RESOLVE_STATUS"), status: ResolveStatusSchema }),
  // Both
  z.object({ type: z.literal("PONG") }),
  z.object({ type: z.literal("ERROR"), code: z.string(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Network input is hostile: a bad frame is a null, never an exception. */
function parse<T>(schema: z.ZodType<T>, data: unknown): T | null {
  if (typeof data !== "string") return null;
  try {
    const result = schema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export const parseClientMessage = (data: unknown) => parse(ClientMessageSchema, data);
export const parseServerMessage = (data: unknown) => parse(ServerMessageSchema, data);
