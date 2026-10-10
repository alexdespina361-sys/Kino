import { z } from "zod";
import { CaptionStyleSchema } from "./captions";
import { MAX_ALTERNATES, NormalizedMediaSchema } from "./media";

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

export const CommandSchema = z.discriminatedUnion("type", [
  /** `startAt` resumes a video where it was left off; the TV seeks there as soon as it can. */
  z.object({ type: z.literal("LOAD"), media: NormalizedMediaSchema, startAt: StartAtSchema.optional() }),
  z.object({ type: z.literal("PLAY") }),
  z.object({ type: z.literal("PAUSE") }),
  z.object({ type: z.literal("SEEK"), time: StartAtSchema }),
  /** Relative jump from wherever the TV really is, so quick repeated taps on the phone add up. */
  z.object({ type: z.literal("SKIP"), seconds: z.number().finite().min(-3600).max(3600) }),
  z.object({ type: z.literal("STOP") }),
  z.object({ type: z.literal("SET_QUALITY"), level: z.number().int() }),
  z.object({ type: z.literal("SET_SUBTITLE"), track: z.number().int() }),
  /** Any of the caption look settings; what isn't mentioned stays as it is. */
  z.object({ type: z.literal("SET_CAPTION_STYLE"), style: CaptionStyleSchema.partial() }),
  z.object({ type: z.literal("SET_SPEED"), rate: z.number().finite().min(0.25).max(4) }),
  z.object({ type: z.literal("SET_AUDIO"), track: z.number().int() }),
  /** Play the video from another of its sources (0 is the main one). It carries on from where it was. */
  z.object({ type: z.literal("SET_SOURCE"), index: z.number().int().min(0).max(MAX_ALTERNATES) }),
  z.object({ type: z.literal("TOGGLE_FULLSCREEN") }),
  z.object({ type: z.literal("NEXT_EPISODE") }),
]);
export type Command = z.infer<typeof CommandSchema>;

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
  /** How subtitles look right now, so the phone's style sheet shows the real values. */
  captionStyle: CaptionStyleSchema.optional(),
  quality: z
    .object({
      levels: z.array(PlayerQualityLevelSchema),
      current: z.number().int(),
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

/** A TV watching along, as the phone's list shows it. `id` is for removing it; the TV's own id is its secret and stays on the server. */
export const PartyTvSchema = z.object({ id: z.string().max(100), name: z.string().max(60), online: z.boolean() });
export type PartyTv = z.infer<typeof PartyTvSchema>;

/** Resolver progress shown on the phone: "Finding video..." -> "Video found" -> (TV state takes over). */
export const ResolveStatusSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("resolving") }),
  z.object({ phase: z.literal("found"), media: NormalizedMediaSchema }),
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
  z.object({ type: z.literal("TV_HELLO"), deviceId: z.string().max(100).optional() }),
  z.object({ type: z.literal("TV_STATE"), state: PlayerStateSchema }),
  z.object({ type: z.literal("TV_NEW_CODE") }),
  z.object({ type: z.literal("TV_NEXT_EPISODE") }),
  z.object({ type: z.literal("TV_PLAY_URL"), url: z.string().max(2048) }),
  /** The TV lets go of its phone: it gets a fresh pairing code and the phone goes back to the code screen. */
  z.object({ type: z.literal("TV_UNPAIR") }),
  // Phone
  z.object({ type: z.literal("CTL_HELLO"), controllerId: z.string().max(100).optional() }),
  z.object({ type: z.literal("PAIR"), code: z.string().max(20) }),
  z.object({ type: z.literal("CMD"), command: CommandSchema }),
  /** A page or media URL. The server resolves it to media; the phone never tells the TV what to fetch. */
  z.object({ type: z.literal("PLAY_URL"), url: z.string().max(2048), startAt: StartAtSchema.optional() }),
  /** Forget this TV: it gets a fresh pairing code and the phone goes back to the code screen. */
  z.object({ type: z.literal("UNPAIR") }),
  /** Have another TV watch along: its pairing code, typed on the phone that controls the first TV. */
  z.object({ type: z.literal("ADD_TV"), code: z.string().max(20) }),
  /** Send a TV that is watching along back to its own pairing screen (an `id` from PARTY). */
  z.object({ type: z.literal("REMOVE_TV"), id: z.string().max(100) }),
  // Keepalive from either kind of client. Answered with PONG, so a silently dead connection is noticed.
  z.object({ type: z.literal("PING") }),
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
  }),
  z.object({ type: z.literal("TV_CODE"), pairing: PairingCodeSchema }),
  z.object({ type: z.literal("TV_PAIRED") }),
  z.object({ type: z.literal("TV_CMD"), command: CommandSchema }),
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
  }),
  z.object({ type: z.literal("PARTY"), tvs: z.array(PartyTvSchema).max(MAX_FOLLOWERS) }),
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
