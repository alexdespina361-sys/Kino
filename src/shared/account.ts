import { z } from "zod";

/**
 * Accounts, profiles and what is kept for them. Shared by the server and both screens, so a change to what is stored is one
 * edit. Everything a profile keeps (what was watched, My List, settings) is a list of small items with a `key` and an `at`,
 * and two copies of the same list are combined item by item, newest first (see `mergeCollection`), so the copies on a phone,
 * a TV and the server always settle on the same answer, whatever order they met in.
 */

/* ------------------------------ accounts and profiles ------------------------------ */

export const MAX_PROFILES = 5;
export const PROFILE_NAME_MAX = 16;
export const PASSWORD_MIN = 8;

/** The pictures a profile can have: drawn in client/account/Avatar.tsx. */
export const AVATAR_IDS = ["fox", "cat", "panda", "owl", "bear", "rabbit", "frog", "penguin", "robot", "alien", "ghost", "monster"] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];
export const AvatarIdSchema = z.enum(AVATAR_IDS);

/** The languages of the website itself. */
export const UI_LANGUAGES = ["en", "ro", "it"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const UiLanguageSchema = z.enum(UI_LANGUAGES);

/** The colours a profile can give the website. The first is the one everybody starts with. */
export const ACCENTS = ["red", "blue", "purple", "green", "orange", "pink"] as const;
export type Accent = (typeof ACCENTS)[number];
export const AccentSchema = z.enum(ACCENTS);

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "invalid_email");
export const NewPasswordSchema = z.string().min(PASSWORD_MIN, "weak_password").max(200, "weak_password");
/** Who is asking: the screen the sign-in is for, so the list of devices can say "TV" or "Phone". */
export const DeviceKindSchema = z.enum(["tv", "remote", "browser"]);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const RegisterSchema = z.object({ email: EmailSchema, password: NewPasswordSchema, device: DeviceKindSchema.optional() });
export const LoginSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(200), device: DeviceKindSchema.optional() });

export const ProfileNameSchema = z.string().trim().min(1, "invalid_name").max(PROFILE_NAME_MAX, "invalid_name");
export const ProfileSchema = z.object({ id: z.string().max(60), name: ProfileNameSchema, avatar: AvatarIdSchema });
export type Profile = z.infer<typeof ProfileSchema>;
export const NewProfileSchema = z.object({ name: ProfileNameSchema, avatar: AvatarIdSchema });
export const ProfilePatchSchema = NewProfileSchema.partial();

export const AccountSchema = z.object({ id: z.string().max(60), email: z.string().max(254) });
export const MeSchema = z.object({ account: AccountSchema, profiles: z.array(ProfileSchema).max(MAX_PROFILES) });
export type Me = z.infer<typeof MeSchema>;

/** Whether new accounts can be made here (a server that is shared with friends may close it once they have one). */
export const RegistrationSchema = z.enum(["open", "closed"]);
export type Registration = z.infer<typeof RegistrationSchema>;
/** The first thing a screen asks: who is signed in (nobody: `me` is null) and may somebody new sign up. */
export const SessionStateSchema = z.object({ me: MeSchema.nullable(), registration: RegistrationSchema });
export type SessionState = z.infer<typeof SessionStateSchema>;

/** A device asking to be signed in by a phone that already is: what it is and how long the request lasts. */
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

/** The name a first profile gets from an e-mail address: "alex.popescu@x.com" -> "Alex". */
export function nameFromEmail(email: string): string {
  const word = email.split("@")[0]?.split(/[._+-]/)[0]?.replace(/[^\p{L}\p{N}]/gu, "") ?? "";
  if (!word) return "Me";
  return (word.charAt(0).toUpperCase() + word.slice(1)).slice(0, PROFILE_NAME_MAX);
}

/** The picture a new profile gets when its maker has not chosen one: the first one not taken yet. */
export const nextAvatar = (taken: readonly string[]): AvatarId => AVATAR_IDS.find((id) => !taken.includes(id)) ?? AVATAR_IDS[0];

/* ------------------------------ what a profile keeps ------------------------------ */

const KeySchema = z.string().min(1).max(400);
const AtSchema = z.number().finite();

/** A removed item stays behind as just its key and the time it was removed, so other copies learn of it instead of bringing it back. */
const tombstone = z.object({ key: KeySchema, at: AtSchema, deleted: z.literal(true) });
const orRemoved = <T extends z.ZodType>(schema: T) => z.union([tombstone, schema]);

/** What was watched, one card per film or show: the "Continue watching" row. */
const ProgressLive = z.object({
  key: KeySchema,
  at: AtSchema,
  title: z.string().max(300),
  /** The link that plays it again (an episode's own page, for a show). */
  url: z.string().max(2048),
  image: z.string().max(2048).optional(),
  /** A wide picture of it, for the TV's wide cards and banner. */
  backdrop: z.string().max(2048).optional(),
  year: z.number().int().optional(),
  /** Where it stopped, in the film or in that episode. */
  position: z.number().finite().min(0),
  duration: z.number().finite().min(0),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  /** Played to the end: it leaves "Continue watching" (a show carries on with its next episode) but is remembered. */
  done: z.boolean().optional(),
});
export const ProgressItemSchema = orRemoved(ProgressLive);
export type ProgressItem = z.infer<typeof ProgressItemSchema>;
export type LiveProgress = z.infer<typeof ProgressLive>;

/** Which episodes of a show were watched, to mark the episode lists (the same facts as `WatchedEntry`). */
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

/** My List: the titles somebody saved for later. */
const ListLive = z.object({
  key: KeySchema,
  at: AtSchema,
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

/** How a profile likes the website. Each setting is its own item, so changing one on the phone never undoes another changed on the TV. */
export const SETTING_SCHEMAS = {
  lang: UiLanguageSchema,
  accent: AccentSchema,
  autoplayNext: z.boolean(),
  /** The subtitle languages that matter to this profile, in order: the subtitle lists show them first. */
  subtitleLanguages: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(12),
  /** Leave every other subtitle language out of the lists. */
  onlySubtitleLanguages: z.boolean(),
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;
export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];
export type Settings = { [K in SettingKey]?: z.infer<(typeof SETTING_SCHEMAS)[K]> };

const SettingLive = z.object({ key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]), at: AtSchema, value: z.unknown() });
export const SettingItemSchema = z.union([z.object({ key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]), at: AtSchema, deleted: z.literal(true) }), SettingLive]);
export type SettingItem = z.infer<typeof SettingItemSchema>;

/** The settings that are set: values that are not a real choice are ignored, so an old or hand-edited copy cannot break the page. */
export function resolveSettings(items: readonly SettingItem[]): Settings {
  const settings: Record<string, unknown> = {};
  for (const item of items) {
    if ("deleted" in item && item.deleted) continue;
    const parsed = SETTING_SCHEMAS[item.key].safeParse((item as { value?: unknown }).value);
    if (parsed.success) settings[item.key] = parsed.data;
  }
  return settings as Settings;
}

export const LIMITS = { progress: 60, watched: 600, list: 200, settings: SETTING_KEYS.length } as const;

/** Everything one profile keeps, as the two screens hold it and as it travels. */
export interface ProfileData {
  progress: ProgressItem[];
  watched: WatchedItem[];
  list: ListItem[];
  settings: SettingItem[];
}
export const emptyData = (): ProfileData => ({ progress: [], watched: [], list: [], settings: [] });

/** What a screen sends to bring the server up to date and ask what it missed. `since` is the last `rev` it was told of. */
export const SyncRequestSchema = z.object({
  since: z.number().int().min(0),
  progress: z.array(ProgressItemSchema).max(LIMITS.progress * 3).default([]),
  watched: z.array(WatchedItemSchema).max(LIMITS.watched + 100).default([]),
  list: z.array(ListItemSchema).max(LIMITS.list + 50).default([]),
  settings: z.array(SettingItemSchema).max(40).default([]),
});
export type SyncRequest = z.input<typeof SyncRequestSchema>;

export const SyncResponseSchema = z.object({
  /** The server's counter after this exchange; the next request says `since: rev`. */
  rev: z.number().int().min(0),
  /** The server had less than the screen did (it lost its data): send everything again. */
  reset: z.boolean().optional(),
  progress: z.array(ProgressItemSchema),
  watched: z.array(WatchedItemSchema),
  list: z.array(ListItemSchema),
  settings: z.array(SettingItemSchema),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

/* ------------------------------ keys ------------------------------ */

/** A link without the part after `#`, which never changes what it plays. */
export const canonicalUrl = (url: string): string => url.split("#")[0]!;

/** One card per show (all episodes share it), one per film or other link. */
export const progressKey = (page: { show?: string | undefined; url: string }): string => (page.show ? `show:${page.show}` : `url:${canonicalUrl(page.url)}`);
export const watchedKey = (entry: { show: string; season: number; episode: number }): string => `${entry.show}|${entry.season}x${entry.episode}`;
/** A title in My List is told apart by the link that plays it. */
export const listKey = (url: string): string => `url:${canonicalUrl(url)}`;

/* ------------------------------ combining copies ------------------------------ */

export interface SyncItem {
  key: string;
  at: number;
  deleted?: true;
}

/**
 * The same item in two copies: the newer one wins. At the same moment a removal wins, and after that the longer text does,
 * which means nothing except that every copy picks the same one whichever way round it compares them.
 */
export function newerOf<T extends SyncItem>(a: T, b: T): T {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (Boolean(a.deleted) !== Boolean(b.deleted)) return a.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export interface MergeOptions<T extends SyncItem> {
  /** How many live items to keep: the newest. */
  limit: number;
  /** The winner of two live copies may borrow what only the loser has (a picture, a year). */
  fill?: (winner: T, loser: T) => T;
  /** Removals are kept this long so other copies hear of them; older ones are forgotten. */
  tombstoneMs?: number;
  now?: number;
}

const TOMBSTONE_MS = 45 * 24 * 3600 * 1000;
const MAX_TOMBSTONES = 150;

/** Two copies of one list become one, newest first. Neither input is changed. */
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

/** The newer progress wins, but keeps the picture or year it was missing. */
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

/** Two copies of everything a profile keeps, combined. */
export function mergeData(a: ProfileData, b: ProfileData, now = Date.now()): ProfileData {
  return {
    progress: mergeCollection(a.progress, b.progress, { limit: LIMITS.progress, now, fill: (w, l) => fillProgress(w as LiveProgress, l as LiveProgress) as ProgressItem }),
    watched: mergeCollection(a.watched, b.watched, { limit: LIMITS.watched, now }),
    list: mergeCollection(a.list, b.list, { limit: LIMITS.list, now, fill: (w, l) => fillListItem(w as LiveListItem, l as LiveListItem) as ListItem }),
    settings: mergeCollection(a.settings, b.settings, { limit: LIMITS.settings, now }),
  };
}

/** Whether a collection item is a live one (not a removal). */
export const isLive = <T extends SyncItem>(item: T): item is T & { deleted?: undefined } => !item.deleted;
