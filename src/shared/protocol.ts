import { z } from "zod";
import { AvatarSeenSchema, TagNumberSchema } from "./account";
import { CaptionStyleSchema } from "./captions";
import { MAX_ALTERNATES, NormalizedMediaSchema, PlayHintSchema } from "./media";

export const PlayerQualityLevelSchema = z.object({
  id: z.number().int(),
  label: z.string().max(100),
  height: z.number().int().optional(),
  width: z.number().int().optional(),
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

export const EnhanceModeSchema = z.enum(["off", "2k"]);
export type EnhanceMode = z.infer<typeof EnhanceModeSchema>;
export const EnhanceTierSchema = z.enum(["anime", "sharp"]);
export type EnhanceTier = z.infer<typeof EnhanceTierSchema>;
export const EnhanceProblemSchema = z.enum(["unreadable", "slow", "failed"]);
export type EnhanceProblem = z.infer<typeof EnhanceProblemSchema>;

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const PlayCommand = z.object({ type: z.literal("PLAY") });
const PauseCommand = z.object({ type: z.literal("PAUSE") });
const SeekCommand = z.object({ type: z.literal("SEEK"), time: StartAtSchema });
const SkipCommand = z.object({ type: z.literal("SKIP"), seconds: z.number().finite().min(-3600).max(3600) });
const StopCommand = z.object({ type: z.literal("STOP") });
const NextEpisodeCommand = z.object({ type: z.literal("NEXT_EPISODE") });

export const SubtitleSyncModeSchema = z.enum(["full", "light"]);
export type SubtitleSyncMode = z.infer<typeof SubtitleSyncModeSchema>;

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("LOAD"), media: NormalizedMediaSchema, startAt: StartAtSchema.optional() }),
  PlayCommand,
  PauseCommand,
  SeekCommand,
  SkipCommand,
  StopCommand,
  z.object({ type: z.literal("SET_QUALITY"), level: z.number().int() }),
  z.object({ type: z.literal("SET_ENHANCE"), mode: EnhanceModeSchema }),
  z.object({ type: z.literal("SET_SUBTITLE"), track: z.number().int() }),
  z.object({ type: z.literal("SET_CAPTION_STYLE"), style: CaptionStyleSchema.partial() }),
  z.object({ type: z.literal("SET_SPEED"), rate: z.number().finite().min(0.25).max(4) }),
  z.object({ type: z.literal("SET_AUDIO"), track: z.number().int() }),
  z.object({ type: z.literal("SET_SOURCE"), index: z.number().int().min(0).max(MAX_ALTERNATES) }),
  z.object({ type: z.literal("TOGGLE_FULLSCREEN") }),
  NextEpisodeCommand,
  z.object({ type: z.literal("DISMISS_UP_NEXT") }),
  z.object({ type: z.literal("SKIP_SEGMENT") }),
  z.object({ type: z.literal("REFRESH_ACCOUNT") }),
  z.object({ type: z.literal("SET_SUBTITLE_DELAY"), delay: z.number().finite().min(-60).max(60) }),
  z.object({ type: z.literal("SET_SUBTITLE_SYNC"), on: z.boolean(), mode: SubtitleSyncModeSchema.optional() }),
]);
export type Command = z.infer<typeof CommandSchema>;

export const PartyCommandSchema = z.discriminatedUnion("type", [PlayCommand, PauseCommand, SeekCommand, SkipCommand, StopCommand, NextEpisodeCommand]);
export type PartyCommand = z.infer<typeof PartyCommandSchema>;

export const PlayerStateSchema = z.object({
  state: z.enum(["idle", "loading", "playing", "paused", "error"]),
  currentTime: z.number().finite().min(0),
  duration: z.number().finite().min(0),
  error: z.string().max(100).optional(),
  detail: z.string().max(200).optional(),
  buffering: z.boolean().optional(),
  bufferedEnd: z.number().finite().min(0).optional(),
  playbackRate: z.number().finite().min(0.25).max(4).optional(),
  stream: z.string().max(2048).optional(),
  sources: z.object({ labels: z.array(z.string().max(60)).max(MAX_ALTERNATES + 1), current: z.number().int().min(0) }).optional(),
  fullscreen: z.boolean().optional(),
  ended: z.boolean().optional(),
  upNext: z.object({ seconds: z.number().int().min(0).max(120).nullable() }).optional(),
  skip: z.object({ kind: z.enum(["intro", "recap", "credits"]) }).optional(),
  captionStyle: CaptionStyleSchema.optional(),
  subtitleDelay: z.number().finite().optional(),
  subtitleSync: z.enum(["off", "ready", "syncing", "synced", "unavailable"]).optional(),
  subtitleShift: z.number().finite().min(-600).max(600).optional(),
  subtitleSyncMode: SubtitleSyncModeSchema.optional(),
  quality: z
    .object({
      levels: z.array(PlayerQualityLevelSchema),
      current: z.number().int(),
      active: z.number().int().optional(),
      auto: z.boolean().optional(),
    })
    .optional(),
  enhance: z
    .object({
      offers: z.array(EnhanceModeSchema).max(3),
      current: EnhanceModeSchema,
      tier: EnhanceTierSchema.optional(),
      problem: EnhanceProblemSchema.optional(),
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

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export const PairingCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
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

export const MAX_FOLLOWERS = 5;

export const MAX_LINK_LENGTH = 2048;

export const MAX_LAG_S = 2;

export const PartyProfileSchema = z.object({ name: z.string().max(60), avatar: AvatarSeenSchema, tag: TagNumberSchema });
export type PartyProfile = z.infer<typeof PartyProfileSchema>;

export const PartyTvSchema = z.object({ id: z.string().max(100), name: z.string().max(60), online: z.boolean(), admin: z.boolean().optional(), profile: PartyProfileSchema.optional() });
export type PartyTv = z.infer<typeof PartyTvSchema>;

export const MAX_PHONE_TVS = 8;

export const PhoneTvSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(60),
  label: z.string().max(60).optional(),
  online: z.boolean(),
  current: z.boolean(),
});
export type PhoneTv = z.infer<typeof PhoneTvSchema>;

export const PartyViewSchema = z.object({
  role: z.enum(["host", "guest"]),
  you: z.string().max(100),
  host: PartyTvSchema,
  guests: z.array(PartyTvSchema).max(MAX_FOLLOWERS),
  code: PairingCodeSchema.optional(),
});
export type PartyView = z.infer<typeof PartyViewSchema>;

export const ResolveStatusSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("resolving") }),
  z.object({ phase: z.literal("found"), media: NormalizedMediaSchema }),
  z.object({ phase: z.literal("cancelled") }),
  z.object({
    phase: z.literal("failed"),
    reason: z.enum(["invalid_url", "unsupported", "temporary_failure", "tv_offline"]),
    message: z.string().max(300),
  }),
]);
export type ResolveStatus = z.infer<typeof ResolveStatusSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("TV_HELLO"),
    deviceId: z.string().max(100).optional(),
    opened: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("TV_STATE"),
    state: PlayerStateSchema,
    media: NormalizedMediaSchema.optional(),
  }),
  z.object({ type: z.literal("TV_NEW_CODE") }),
  z.object({ type: z.literal("TV_NEXT_EPISODE") }),
  z.object({ type: z.literal("TV_PLAY_URL"), url: z.string().max(MAX_LINK_LENGTH), startAt: StartAtSchema.optional(), hint: PlayHintSchema.optional() }),
  z.object({ type: z.literal("TV_UNPAIR") }),
  z.object({ type: z.literal("TV_CANCEL") }),
  z.object({
    type: z.literal("TV_STARTED"),
    lookupMs: z.number().int().min(0).max(600_000).optional(),
    loadMs: z.number().int().min(0).max(600_000),
    resumed: z.boolean().optional(),
    manifestMs: z.number().int().min(0).max(600_000).optional(),
    pieceMs: z.number().int().min(0).max(600_000).optional(),
    pieceS: z.number().min(0).max(600).optional(),
    pieceKB: z.number().int().min(0).max(1_000_000).optional(),
    height: z.number().int().min(0).max(10_000).optional(),
    metadataMs: z.number().int().min(0).max(600_000).optional(),
  }),
  z.object({ type: z.literal("TV_NAME"), name: z.string().max(60) }),
  z.object({ type: z.literal("TV_PROFILE"), proof: z.string().max(100).optional() }),
  z.object({ type: z.literal("TV_PARTY_OPEN") }),
  z.object({ type: z.literal("TV_PARTY_JOIN"), code: z.string().max(20) }),
  z.object({ type: z.literal("TV_PARTY_REMOVE"), id: z.string().max(100) }),
  z.object({ type: z.literal("TV_PARTY_CLOSE") }),
  z.object({ type: z.literal("TV_PARTY_ADMIN"), id: z.string().max(100), admin: z.boolean() }),
  z.object({ type: z.literal("TV_PARTY_CMD"), command: PartyCommandSchema }),
  z.object({ type: z.literal("CTL_HELLO"), controllerId: z.string().max(100).optional() }),
  z.object({ type: z.literal("PAIR"), code: z.string().max(20) }),
  z.object({ type: z.literal("CMD"), command: CommandSchema }),
  z.object({ type: z.literal("PLAY_URL"), url: z.string().max(MAX_LINK_LENGTH), startAt: StartAtSchema.optional(), hint: PlayHintSchema.optional() }),
  z.object({ type: z.literal("UNPAIR"), id: z.string().max(100).optional() }),
  z.object({ type: z.literal("SWITCH_TV"), id: z.string().max(100) }),
  z.object({ type: z.literal("NAME_TV"), name: z.string().max(60) }),
  z.object({ type: z.literal("ADD_TV"), code: z.string().max(20) }),
  z.object({ type: z.literal("REMOVE_TV"), id: z.string().max(100) }),
  z.object({ type: z.literal("OPEN_PARTY") }),
  z.object({ type: z.literal("END_PARTY") }),
  z.object({ type: z.literal("PARTY_ADMIN"), id: z.string().max(100), admin: z.boolean() }),
  z.object({
    type: z.literal("PING"),
    rtt: z.number().finite().min(0).max(60_000).optional(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("TV_WELCOME"),
    deviceId: z.string(),
    paired: z.boolean(),
    pairing: PairingCodeSchema.nullable(),
    following: z.string().max(60).optional(),
    leftParty: z.string().max(60).optional(),
  }),
  z.object({ type: z.literal("TV_FOLLOWING"), leader: z.string().max(60) }),
  z.object({
    type: z.literal("TV_SYNC"),
    playing: z.boolean(),
    time: z.number().finite().min(0),
    rate: z.number().finite().min(0.25).max(4),
    stream: z.string().max(2048).optional(),
    lag: z.number().finite().min(0).max(MAX_LAG_S).optional(),
    by: z.string().max(100).optional(),
    waiting: z.boolean().optional(),
    ended: z.boolean().optional(),
  }),
  z.object({ type: z.literal("TV_PARTY"), party: PartyViewSchema.nullable() }),
  z.object({ type: z.literal("TV_CODE"), pairing: PairingCodeSchema, control: z.boolean().optional() }),
  z.object({ type: z.literal("TV_PAIRED") }),
  z.object({ type: z.literal("TV_CMD"), command: CommandSchema, by: z.string().max(100).optional() }),
  z.object({ type: z.literal("TV_UNPAIRED"), pairing: PairingCodeSchema.nullable() }),
  z.object({ type: z.literal("TV_RESOLVING"), active: z.boolean(), hint: PlayHintSchema.optional() }),
  z.object({
    type: z.literal("CTL_WELCOME"),
    controllerId: z.string(),
    tv: TvInfoSchema.nullable(),
    media: NormalizedMediaSchema.nullable(),
    state: PlayerStateSchema,
    party: z.array(PartyTvSchema).max(MAX_FOLLOWERS).optional(),
    tvs: z.array(PhoneTvSchema).optional(),
  }),
  z.object({ type: z.literal("TVS"), tvs: z.array(PhoneTvSchema) }),
  z.object({ type: z.literal("PARTY"), tvs: z.array(PartyTvSchema).max(MAX_FOLLOWERS), code: PairingCodeSchema.optional() }),
  z.object({ type: z.literal("TV_STATUS"), online: z.boolean() }),
  z.object({ type: z.literal("MEDIA"), media: NormalizedMediaSchema }),
  z.object({ type: z.literal("STATE"), state: PlayerStateSchema }),
  z.object({ type: z.literal("RESOLVE_STATUS"), status: ResolveStatusSchema }),
  z.object({ type: z.literal("PONG") }),
  z.object({ type: z.literal("ERROR"), code: z.string(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

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
