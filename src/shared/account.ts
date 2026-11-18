import { z } from "zod";

export const MAX_PROFILES = 5;
export const PROFILE_NAME_MAX = 16;
export const PASSWORD_MIN = 0;

export const AVATAR_IDS = [
  ...(["fox", "cat", "panda", "owl", "bear", "rabbit", "frog", "penguin", "robot", "alien", "ghost", "monster"] as const),
  ...(["popcorn", "clapper", "reel", "ticket", "camera", "star", "ninja", "wizard", "astronaut", "pirate", "vampire", "dragon"] as const),
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];
export const AvatarIdSchema = z.enum(AVATAR_IDS);
export const AvatarSeenSchema = AvatarIdSchema.catch(AVATAR_IDS[0]);

export const UI_LANGUAGES = ["en", "ro", "it"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const UiLanguageSchema = z.enum(UI_LANGUAGES);

export const ACCENTS = ["red", "blue", "purple", "green", "orange", "pink"] as const;
export type Accent = (typeof ACCENTS)[number];
export const AccentSchema = z.enum(ACCENTS);

export const LoginNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "invalid_email")
  .max(254, "invalid_email")
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, "invalid_email")
  .transform((name) => name.normalize("NFC"));
export const NewPasswordSchema = z.string().min(PASSWORD_MIN, "weak_password").max(200, "weak_password");
export const DeviceKindSchema = z.enum(["tv", "remote", "browser"]);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const RegisterSchema = z.object({ email: LoginNameSchema, password: NewPasswordSchema, device: DeviceKindSchema.optional(), name: z.lazy(() => ProfileNameSchema).optional() });
export const LoginSchema = z.object({ email: LoginNameSchema, password: z.string().max(200), device: DeviceKindSchema.optional() });

export const ProfileNameSchema = z.string().trim().min(1, "invalid_name").max(PROFILE_NAME_MAX, "invalid_name");
export const TagNumberSchema = z.number().int().min(1).max(999_999);
export const ProfileSchema = z.object({
  id: z.string().max(60),
  name: ProfileNameSchema,
  avatar: AvatarSeenSchema,
  tag: TagNumberSchema.optional(),
  setup: z.enum(["all", "more"]).optional().catch(undefined),
});
export type Profile = z.infer<typeof ProfileSchema>;
export const NewProfileSchema = z.object({ name: ProfileNameSchema, avatar: AvatarIdSchema });
export const ProfilePatchSchema = NewProfileSchema.partial().extend({ setup: z.literal("done").optional() });

export const AccountSchema = z.object({
  id: z.string().max(60),
  email: z.string().max(254),
  google: z.literal(true).optional(),
  googleOnly: z.literal(true).optional(),
  childPin: z.literal(true).optional(),
});

export const CHILD_PIN_LENGTH = 4;
export const ChildPinSchema = z.string().regex(/^\d{4}$/);
export const ChildPinChangeSchema = z.object({ next: ChildPinSchema.nullable(), pin: ChildPinSchema.optional(), password: z.string().max(200).optional() });
export type ChildPinChange = z.infer<typeof ChildPinChangeSchema>;
export const MeSchema = z.object({ account: AccountSchema, profiles: z.array(ProfileSchema).max(MAX_PROFILES) });
export type Me = z.infer<typeof MeSchema>;

export const RegistrationSchema = z.enum(["open", "closed"]);
export type Registration = z.infer<typeof RegistrationSchema>;
export const SessionStateSchema = z.object({ me: MeSchema.nullable(), registration: RegistrationSchema, google: z.boolean().optional() });
export type SessionState = z.infer<typeof SessionStateSchema>;

export const GOOGLE_OUTCOMES = ["denied", "failed", "closed", "busy", "taken", "unavailable", "linked", "reauth"] as const;
export type GoogleOutcome = (typeof GOOGLE_OUTCOMES)[number];

export const LINK_TTL_MS = 5 * 60 * 1000;
export const LinkStartSchema = z.object({ device: DeviceKindSchema.optional() });
export const LinkStartedSchema = z.object({ code: z.string(), secret: z.string(), expiresAt: z.number() });
export const LinkViewSchema = z.object({ code: z.string(), kind: DeviceKindSchema, label: z.string(), expiresAt: z.number() });
export type LinkView = z.infer<typeof LinkViewSchema>;
export const LinkPollSchema = z.object({ code: z.string().max(40), secret: z.string().max(100) });
export const LinkOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("waiting") }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("gone") }),
  z.object({ status: z.literal("approved"), me: MeSchema }),
]);
export type LinkOutcome = z.infer<typeof LinkOutcomeSchema>;

export const SessionInfoSchema = z.object({
  id: z.string().max(60),
  label: z.string().max(100),
  kind: DeviceKindSchema,
  createdAt: z.number(),
  lastSeenAt: z.number(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const DEVICE_NAME_MAX = 40;
export const SessionRenameSchema = z.object({ label: z.string().trim().min(1, "invalid_name").max(DEVICE_NAME_MAX, "invalid_name") });

export const avatarName = (avatar: AvatarId): string => avatar.charAt(0).toUpperCase() + avatar.slice(1);

export const nextAvatar = (taken: readonly string[]): AvatarId => AVATAR_IDS.find((id) => !taken.includes(id)) ?? AVATAR_IDS[0];

const KeySchema = z.string().min(1).max(400);
const AtSchema = z.number().finite();

const tombstone = z.object({ key: KeySchema, at: AtSchema, deleted: z.literal(true) });
const orRemoved = <T extends z.ZodType>(schema: T) => z.union([tombstone, schema]);

const ProgressLive = z.object({
  key: KeySchema,
  at: AtSchema,
  title: z.string().max(300),
  url: z.string().max(2048),
  image: z.string().max(2048).optional(),
  backdrop: z.string().max(2048).optional(),
  year: z.number().int().optional(),
  position: z.number().finite().min(0),
  duration: z.number().finite().min(0),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  done: z.boolean().optional(),
});
export const ProgressItemSchema = orRemoved(ProgressLive);
export type ProgressItem = z.infer<typeof ProgressItemSchema>;
export type LiveProgress = z.infer<typeof ProgressLive>;

const WatchedLive = z.object({
  key: KeySchema,
  at: AtSchema,
  show: z.string().max(300),
  season: z.number().int(),
  episode: z.number().int(),
  position: z.number().finite().min(0),
  duration: z.number().finite().min(0),
  done: z.boolean(),
});
export const WatchedItemSchema = orRemoved(WatchedLive);
export type WatchedItem = z.infer<typeof WatchedItemSchema>;
export type LiveWatched = z.infer<typeof WatchedLive>;

export const DEFAULT_LIST = "favourites";
export const LIST_NAME_MAX = 24;
export const MAX_LISTS = 12;
const ListIdSchema = z.string().min(1).max(60);
export const ListNameSchema = z.string().trim().min(1, "invalid_name").max(LIST_NAME_MAX, "invalid_name");

const ListLive = z.object({
  key: KeySchema,
  at: AtSchema,
  list: ListIdSchema.optional(),
  id: z.string().max(200),
  title: z.string().max(300),
  url: z.string().max(2048),
  image: z.string().max(2048).optional(),
  backdrop: z.string().max(2048).optional(),
  year: z.number().int().optional(),
  description: z.string().max(400).optional(),
});
export const ListItemSchema = orRemoved(ListLive);
export type ListItem = z.infer<typeof ListItemSchema>;
export type LiveListItem = z.infer<typeof ListLive>;

const ListNameLive = z.object({
  key: ListIdSchema,
  at: AtSchema,
  name: ListNameSchema,
  order: z.number().int().min(0).max(MAX_LISTS).optional(),
});
export const ListNameItemSchema = orRemoved(ListNameLive);
export type ListNameItem = z.infer<typeof ListNameItemSchema>;
export type LiveListName = z.infer<typeof ListNameLive>;

export const RATING_NOTE_MAX = 400;
export const MAX_SCORE = 10;
const RatingLive = z.object({
  key: KeySchema,
  at: AtSchema,
  title: z.string().max(300),
  url: z.string().max(2048),
  image: z.string().max(2048).optional(),
  backdrop: z.string().max(2048).optional(),
  year: z.number().int().optional(),
  kind: z.enum(["movie", "series"]).optional(),
  section: z.enum(["cartoon", "anime"]).optional(),
  season: z.number().int().min(1).max(200).optional(),
  score: z.number().int().min(1).max(MAX_SCORE),
  note: z.string().max(RATING_NOTE_MAX).optional(),
  ratedAt: AtSchema,
  watchedAt: AtSchema.optional(),
  percent: z.number().int().min(0).max(100).optional(),
  seen: z.number().int().min(0).max(5000).optional(),
  of: z.number().int().min(1).max(5000).optional(),
});
export const RatingItemSchema = orRemoved(RatingLive);
export type RatingItem = z.infer<typeof RatingItemSchema>;
export type LiveRating = z.infer<typeof RatingLive>;

export const ratingKey = (url: string, season?: number): string => `rate:${titleLink(url)}${season ? `|s${season}` : ""}`;

export const SETTING_SCHEMAS = {
  lang: UiLanguageSchema,
  accent: AccentSchema,
  autoplayNext: z.boolean(),
  autoSkip: z.boolean(),
  animeAudio: z.enum(["jp", "eng"]),
  tapToPause: z.boolean(),
  subtitleLanguages: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(12),
  onlySubtitleLanguages: z.boolean(),
  ratings: z.boolean(),
  friends: z.boolean(),
  friendsOff: z.boolean(),
  child: z.boolean(),
  friendsLists: z.boolean(),
  friendsRatings: z.boolean(),
  friendsGive: z.boolean(),
  friendsGet: z.boolean(),
  friendsInbox: z.boolean(),
  friendsPresence: z.boolean(),
  friendsMessages: z.boolean(),
  newsPopups: z.boolean(),
  adaptiveQuality: z.boolean(),
  sections: z.array(z.enum(["movie", "series", "cartoon", "anime"])).min(1).max(4),
  titleNotices: z.boolean(),
  publicWatching: z.boolean(),
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;
export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];
export type Settings = { [K in SettingKey]?: z.infer<(typeof SETTING_SCHEMAS)[K]> };

const SettingLive = z.object({ key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]), at: AtSchema, value: z.unknown() });
export const SettingItemSchema = z.union([z.object({ key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]), at: AtSchema, deleted: z.literal(true) }), SettingLive]);
export type SettingItem = z.infer<typeof SettingItemSchema>;

export function resolveSettings(items: readonly SettingItem[]): Settings {
  const settings: Record<string, unknown> = {};
  for (const item of items) {
    if ("deleted" in item && item.deleted) continue;
    const parsed = SETTING_SCHEMAS[item.key].safeParse((item as { value?: unknown }).value);
    if (parsed.success) settings[item.key] = parsed.data;
  }
  return settings as Settings;
}

export const SAVED_PICTURES_MAX = 60;
const SavedLive = z.object({ key: KeySchema.regex(/^(gif|sticker):/), at: AtSchema, text: z.string().min(1).max(400) });
export const SavedItemSchema = orRemoved(SavedLive);
export type SavedItem = z.infer<typeof SavedItemSchema>;
export type LiveSaved = z.infer<typeof SavedLive>;

export const LIMITS = { progress: 60, watched: 600, list: 400, listNames: MAX_LISTS, ratings: 500, settings: SETTING_KEYS.length, saved: SAVED_PICTURES_MAX } as const;

export interface ProfileData {
  progress: ProgressItem[];
  watched: WatchedItem[];
  list: ListItem[];
  listNames: ListNameItem[];
  ratings: RatingItem[];
  settings: SettingItem[];
  saved: SavedItem[];
}
export const emptyData = (): ProfileData => ({ progress: [], watched: [], list: [], listNames: [], ratings: [], settings: [], saved: [] });
export const COLLECTIONS = ["progress", "watched", "list", "listNames", "ratings", "settings", "saved"] as const satisfies readonly (keyof ProfileData)[];
export type CollectionName = (typeof COLLECTIONS)[number];

export const SyncRequestSchema = z.object({
  since: z.number().int().min(0),
  progress: z.array(ProgressItemSchema).max(LIMITS.progress * 3).default([]),
  watched: z.array(WatchedItemSchema).max(LIMITS.watched + 100).default([]),
  list: z.array(ListItemSchema).max(LIMITS.list + 160).default([]),
  listNames: z.array(ListNameItemSchema).max(LIMITS.listNames + 160).default([]),
  ratings: z.array(RatingItemSchema).max(LIMITS.ratings + 160).default([]),
  settings: z.array(SettingItemSchema).max(40).default([]),
  saved: z.array(SavedItemSchema).max(LIMITS.saved + 160).default([]),
});
export type SyncRequest = z.input<typeof SyncRequestSchema>;

export const SyncResponseSchema = z.object({
  rev: z.number().int().min(0),
  reset: z.boolean().optional(),
  progress: z.array(ProgressItemSchema),
  watched: z.array(WatchedItemSchema),
  list: z.array(ListItemSchema),
  listNames: z.array(ListNameItemSchema).default([]),
  ratings: z.array(RatingItemSchema).default([]),
  settings: z
    .array(z.unknown())
    .transform((items) => items.flatMap((item) => {
      const known = SettingItemSchema.safeParse(item);
      return known.success ? [known.data] : [];
    })),
  saved: z
    .array(z.unknown())
    .default([])
    .transform((items) => items.flatMap((item) => {
      const known = SavedItemSchema.safeParse(item);
      return known.success ? [known.data] : [];
    })),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

export const canonicalUrl = (url: string): string => url.split("#")[0]!;

export const progressKey = (page: { show?: string | undefined; url: string }): string => (page.show ? `show:${page.show}` : `url:${canonicalUrl(page.url)}`);
export const watchedKey = (entry: { show: string; season: number; episode: number }): string => `${entry.show}|${entry.season}x${entry.episode}`;
export const titleLink = (url: string): string => canonicalUrl(url).replace(/([?&])s=\d+&e=\d+(?=&|$)/, "$1s=1&e=1");
export const listKey = (url: string, list: string = DEFAULT_LIST): string => (list === DEFAULT_LIST ? `url:${titleLink(url)}` : `${list}|url:${titleLink(url)}`);

export interface SyncItem {
  key: string;
  at: number;
  deleted?: true;
}

export function newerOf<T extends SyncItem>(a: T, b: T): T {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (Boolean(a.deleted) !== Boolean(b.deleted)) return a.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export interface MergeOptions<T extends SyncItem> {
  limit: number;
  fill?: (winner: T, loser: T) => T;
  tombstoneMs?: number;
  now?: number;
}

const TOMBSTONE_MS = 45 * 24 * 3600 * 1000;
const MAX_TOMBSTONES = 150;

export function mergeCollection<T extends SyncItem>(a: readonly T[], b: readonly T[], options: MergeOptions<T>): T[] {
  const byKey = new Map<string, T>();
  for (const item of [...a, ...b]) {
    const have = byKey.get(item.key);
    if (!have) {
      byKey.set(item.key, item);
      continue;
    }
    const winner = newerOf(have, item);
    const loser = winner === have ? item : have;
    byKey.set(item.key, options.fill && !winner.deleted && !loser.deleted ? options.fill(winner, loser) : winner);
  }
  const now = options.now ?? Date.now();
  const oldest = now - (options.tombstoneMs ?? TOMBSTONE_MS);
  const all = [...byKey.values()].sort((x, y) => y.at - x.at || (x.key < y.key ? -1 : 1));
  const live = all.filter((item) => !item.deleted).slice(0, options.limit);
  const gone = all.filter((item) => item.deleted && item.at >= oldest).slice(0, MAX_TOMBSTONES);
  return [...live, ...gone].sort((x, y) => y.at - x.at || (x.key < y.key ? -1 : 1));
}

export function fillProgress(winner: LiveProgress, loser: LiveProgress): LiveProgress {
  const image = winner.image ?? loser.image;
  const backdrop = winner.backdrop ?? loser.backdrop;
  const year = winner.year ?? loser.year;
  if (image === winner.image && backdrop === winner.backdrop && year === winner.year) return winner;
  return { ...winner, ...(image ? { image } : {}), ...(backdrop ? { backdrop } : {}), ...(year !== undefined ? { year } : {}) };
}
export function fillListItem(winner: LiveListItem, loser: LiveListItem): LiveListItem {
  const image = winner.image ?? loser.image;
  const backdrop = winner.backdrop ?? loser.backdrop;
  const description = winner.description ?? loser.description;
  if (image === winner.image && backdrop === winner.backdrop && description === winner.description) return winner;
  return { ...winner, ...(image ? { image } : {}), ...(backdrop ? { backdrop } : {}), ...(description ? { description } : {}) };
}

export function mergeData(a: ProfileData, b: ProfileData, now = Date.now()): ProfileData {
  return {
    progress: mergeCollection(a.progress, b.progress, { limit: LIMITS.progress, now, fill: (w, l) => fillProgress(w as LiveProgress, l as LiveProgress) as ProgressItem }),
    watched: mergeCollection(a.watched, b.watched, { limit: LIMITS.watched, now }),
    list: mergeCollection(a.list, b.list, { limit: LIMITS.list, now, fill: (w, l) => fillListItem(w as LiveListItem, l as LiveListItem) as ListItem }),
    listNames: mergeCollection(a.listNames, b.listNames, { limit: LIMITS.listNames, now }),
    ratings: mergeCollection(a.ratings, b.ratings, { limit: LIMITS.ratings, now }),
    settings: mergeCollection(a.settings, b.settings, { limit: LIMITS.settings, now }),
    saved: mergeCollection(a.saved ?? [], b.saved ?? [], { limit: LIMITS.saved, now }),
  };
}

export const isLive = <T extends SyncItem>(item: T): item is T & { deleted?: undefined } => !item.deleted;

export interface ListInfo {
  id: string;
  name?: string;
}

export const listOf = (item: { list?: string | undefined }): string => item.list ?? DEFAULT_LIST;

export const savedKeys = (items: readonly { url: string; list?: string | undefined }[]): Set<string> => new Set(items.map((item) => listKey(item.url, listOf(item))));

export function resolveLists(items: readonly ListNameItem[]): ListInfo[] {
  const named = items.filter(isLive) as LiveListName[];
  const first = named.find((item) => item.key === DEFAULT_LIST);
  const placed = (item: LiveListName) => item.order ?? Number.MAX_SAFE_INTEGER;
  const others = named.filter((item) => item.key !== DEFAULT_LIST).sort((a, b) => (placed(a) === placed(b) ? (a.key < b.key ? -1 : 1) : placed(a) < placed(b) ? -1 : 1));
  return [{ id: DEFAULT_LIST, ...(first ? { name: first.name } : {}) }, ...others.map(({ key, name }) => ({ id: key, name }))].slice(0, MAX_LISTS);
}

export const newListId = (now = Date.now()): string => `l${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
