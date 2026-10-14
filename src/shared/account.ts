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
/** A password can be anything, as short as one character, or nothing at all (an account with no password is open to anyone who types its name: the sign-up form says so). */
export const PASSWORD_MIN = 0;

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

/**
 * What an account signs in with: any name at all (an e-mail address too: the accounts made when it had to be one still work), only not
 * one that somebody has already. Kept without capitals, so "Robert" and "robert" are the same account. (The field is still called
 * `email` where it travels and is stored, and a name that will not do is still told as `invalid_email`: older pages and saved accounts speak that.)
 */
export const LoginNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "invalid_email")
  .max(254, "invalid_email")
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, "invalid_email")
  .transform((name) => name.normalize("NFC"));
export const NewPasswordSchema = z.string().min(PASSWORD_MIN, "weak_password").max(200, "weak_password");
/** Who is asking: the screen the sign-in is for, so the list of devices can say "TV" or "Phone". */
export const DeviceKindSchema = z.enum(["tv", "remote", "browser"]);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const RegisterSchema = z.object({ email: LoginNameSchema, password: NewPasswordSchema, device: DeviceKindSchema.optional() });
export const LoginSchema = z.object({ email: LoginNameSchema, password: z.string().max(200), device: DeviceKindSchema.optional() });

export const ProfileNameSchema = z.string().trim().min(1, "invalid_name").max(PROFILE_NAME_MAX, "invalid_name");
/** The number that goes with a name, "Sam#2", to tell the profiles of one name apart wherever they are (see `tagLabel`). */
export const TagNumberSchema = z.number().int().min(1).max(999_999);
export const ProfileSchema = z.object({ id: z.string().max(60), name: ProfileNameSchema, avatar: AvatarIdSchema, tag: TagNumberSchema.optional() });
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

/** What a device is called on that list when its owner names it ("Living room TV"), instead of the browser and system it was made out of. */
export const DEVICE_NAME_MAX = 40;
export const SessionRenameSchema = z.object({ label: z.string().trim().min(1, "invalid_name").max(DEVICE_NAME_MAX, "invalid_name") });

/** The name a first profile gets from what the account signs in with: "alex.popescu@x.com" -> "Alex", "robert" -> "Robert", "my tv" -> "My tv", "qa-alpha" -> "Qa alpha". */
export function nameFromEmail(login: string): string {
  const own = login.includes("@") ? (login.split("@")[0]?.split(/[._+-]/)[0] ?? "") : login; // an address gives the part before the @, which is a name; a name is the name
  const word = own.replace(/[._+-]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim(); // (a dash or a dot between words is a space, not nothing: "qa-alpha" is not "qaalpha")
  if (!word) return "Me";
  return (word.charAt(0).toUpperCase() + word.slice(1)).slice(0, PROFILE_NAME_MAX).trim();
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

/** The list every profile has. A title saved with a single press goes in it, and it is there before anybody makes another. */
export const DEFAULT_LIST = "favourites";
export const LIST_NAME_MAX = 24;
/** How many lists a profile can have, that first one included. */
export const MAX_LISTS = 12;
const ListIdSchema = z.string().min(1).max(60);
export const ListNameSchema = z.string().trim().min(1, "invalid_name").max(LIST_NAME_MAX, "invalid_name");

/** My Lists: the titles somebody saved for later, each in one of their lists (a title in two lists is two items). */
const ListLive = z.object({
  key: KeySchema,
  at: AtSchema,
  /** Which list it is in. Absent for `DEFAULT_LIST`, so what was saved before there were lists is in it already. */
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

/** The lists themselves, each with its name. `DEFAULT_LIST` is never made: it is there, and is called "Favourites" in the language of the screen until somebody gives it a name. */
const ListNameLive = z.object({
  key: ListIdSchema,
  at: AtSchema,
  name: ListNameSchema,
  /** Where it stands among the lists after the first, once somebody has moved one (0 is the first of them). Lists that were never placed follow, in the order they were made. */
  order: z.number().int().min(0).max(MAX_LISTS).optional(),
});
export const ListNameItemSchema = orRemoved(ListNameLive);
export type ListNameItem = z.infer<typeof ListNameItemSchema>;
export type LiveListName = z.infer<typeof ListNameLive>;

/** What a profile thought of a film, of a show, or of one season of a show. */
export const RATING_NOTE_MAX = 400;
export const MAX_SCORE = 10;
const RatingLive = z.object({
  key: KeySchema,
  /** The last change of any kind: what the copies settle by. */
  at: AtSchema,
  title: z.string().max(300),
  /** The link that plays the title (a show's first episode's), to open it again from the list of ratings. */
  url: z.string().max(2048),
  image: z.string().max(2048).optional(),
  backdrop: z.string().max(2048).optional(),
  year: z.number().int().optional(),
  kind: z.enum(["movie", "series"]).optional(),
  /** Absent: the whole title (a film, or a show as a whole). */
  season: z.number().int().min(1).max(200).optional(),
  score: z.number().int().min(1).max(MAX_SCORE),
  /** Why, in the person's words. */
  note: z.string().max(RATING_NOTE_MAX).optional(),
  /** When the score was given (a change of the note alone does not move it). */
  ratedAt: AtSchema,
  /** What had been watched when it was rated, worked out by the screen from what the profile watched (see rating.ts): when it was last watched... */
  watchedAt: AtSchema.optional(),
  /** ...how much of a film (the last 5% counts as watched, since credits get skipped)... */
  percent: z.number().int().min(0).max(100).optional(),
  /** ...and for a show or a season how many episodes were watched, out of how many there are when that is known. */
  seen: z.number().int().min(0).max(5000).optional(),
  of: z.number().int().min(1).max(5000).optional(),
});
export const RatingItemSchema = orRemoved(RatingLive);
export type RatingItem = z.infer<typeof RatingItemSchema>;
export type LiveRating = z.infer<typeof RatingLive>;

/** A rating is told apart by the title it is for (a show by its first episode's link, whichever episode it was found by) and, for one season of a show, which. */
export const ratingKey = (url: string, season?: number): string => `rate:${titleLink(url)}${season ? `|s${season}` : ""}`;

/** How a profile likes the website. Each setting is its own item, so changing one on the phone never undoes another changed on the TV. */
export const SETTING_SCHEMAS = {
  lang: UiLanguageSchema,
  accent: AccentSchema,
  autoplayNext: z.boolean(),
  /**
   * A tap or click on the picture pauses and plays it. Off (until turned on) it only shows or hides the controls: the big button in the
   * middle, the bar's own and the remote's OK key pause either way. (A remote that points and clicks like a mouse is the one that notices.)
   */
  tapToPause: z.boolean(),
  /** The subtitle languages that matter to this profile, in order: the subtitle lists show them first. */
  subtitleLanguages: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(12),
  /** Leave every other subtitle language out of the lists. */
  onlySubtitleLanguages: z.boolean(),
  /** Scores and notes for films, shows and seasons (on unless turned off). Turned off, nothing of it shows; what was rated stays. */
  ratings: z.boolean(),
  /**
   * Friends (see friends.ts for what each is when it is not set): the master switch, and what a friend may do while it is on. They are
   * settings of the profile, so the server reads them to know what a friend may be given, and they follow the profile everywhere.
   */
  friends: z.boolean(),
  friendsLists: z.boolean(),
  friendsRatings: z.boolean(),
  friendsGive: z.boolean(),
  friendsGet: z.boolean(),
  friendsInbox: z.boolean(),
  friendsPresence: z.boolean(),
  /**
   * What friends say on the screen when they send something or ask for something (on unless turned off). Off, nothing of it is shown over the
   * page or the film: it waits in the bell (and its number), which is never muted. This is only this screen's manner, so the server does not read it.
   */
  newsPopups: z.boolean(),
  /**
   * The picture's quality follows the connection (on unless turned off): a film starts in the lowest quality, which arrives at once, and goes on in the best the link
   * carries, lower when it cannot keep up and higher when it can. Off, every film is in the highest quality there is, whatever the link. This is only this screen's
   * manner, so the server does not read it.
   */
  adaptiveQuality: z.boolean(),
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

export const LIMITS = { progress: 60, watched: 600, list: 400, listNames: MAX_LISTS, ratings: 500, settings: SETTING_KEYS.length } as const;

/** Everything one profile keeps, as the two screens hold it and as it travels. */
export interface ProfileData {
  progress: ProgressItem[];
  watched: WatchedItem[];
  list: ListItem[];
  listNames: ListNameItem[];
  ratings: RatingItem[];
  settings: SettingItem[];
}
export const emptyData = (): ProfileData => ({ progress: [], watched: [], list: [], listNames: [], ratings: [], settings: [] });
/** The parts of `ProfileData`, which is what a sync goes through one by one. */
export const COLLECTIONS = ["progress", "watched", "list", "listNames", "ratings", "settings"] as const satisfies readonly (keyof ProfileData)[];
export type CollectionName = (typeof COLLECTIONS)[number];

/** What a screen sends to bring the server up to date and ask what it missed. `since` is the last `rev` it was told of. */
export const SyncRequestSchema = z.object({
  since: z.number().int().min(0),
  progress: z.array(ProgressItemSchema).max(LIMITS.progress * 3).default([]),
  watched: z.array(WatchedItemSchema).max(LIMITS.watched + 100).default([]),
  list: z.array(ListItemSchema).max(LIMITS.list + 160).default([]),
  listNames: z.array(ListNameItemSchema).max(LIMITS.listNames + 160).default([]),
  ratings: z.array(RatingItemSchema).max(LIMITS.ratings + 160).default([]),
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
  /** (A server older than the screen has no lists to tell of.) */
  listNames: z.array(ListNameItemSchema).default([]),
  /** (...nor ratings.) */
  ratings: z.array(RatingItemSchema).default([]),
  /** (A server newer than the screen may keep settings the screen has never heard of: those are left out, rather than the whole answer being refused and the screen never syncing again until it is reloaded.) */
  settings: z
    .array(z.unknown())
    .transform((items) => items.flatMap((item) => {
      const known = SettingItemSchema.safeParse(item);
      return known.success ? [known.data] : [];
    })),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

/* ------------------------------ keys ------------------------------ */

/** A link without the part after `#`, which never changes what it plays. */
export const canonicalUrl = (url: string): string => url.split("#")[0]!;

/** One card per show (all episodes share it), one per film or other link. */
export const progressKey = (page: { show?: string | undefined; url: string }): string => (page.show ? `show:${page.show}` : `url:${canonicalUrl(page.url)}`);
export const watchedKey = (entry: { show: string; season: number; episode: number }): string => `${entry.show}|${entry.season}x${entry.episode}`;
/** The link that stands for a whole title: every episode of a show (`?s=3&e=5`) is the show's first one, so a show found by any of them is one title. */
export const titleLink = (url: string): string => canonicalUrl(url).replace(/([?&])s=\d+&e=\d+(?=&|$)/, "$1s=1&e=1");
/** A title in a list is told apart by the link that plays it (a show by its first episode's). In `DEFAULT_LIST` the key is what it was before there were lists. */
export const listKey = (url: string, list: string = DEFAULT_LIST): string => (list === DEFAULT_LIST ? `url:${titleLink(url)}` : `${list}|url:${titleLink(url)}`);

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
    listNames: mergeCollection(a.listNames, b.listNames, { limit: LIMITS.listNames, now }),
    ratings: mergeCollection(a.ratings, b.ratings, { limit: LIMITS.ratings, now }),
    settings: mergeCollection(a.settings, b.settings, { limit: LIMITS.settings, now }),
  };
}

/** Whether a collection item is a live one (not a removal). */
export const isLive = <T extends SyncItem>(item: T): item is T & { deleted?: undefined } => !item.deleted;

/* ------------------------------ lists ------------------------------ */

/** A list as the screens show it. `name` is absent for `DEFAULT_LIST` while nobody has renamed it: the screen calls it "Favourites" in its own language. */
export interface ListInfo {
  id: string;
  name?: string;
}

/** The list a saved title is in. */
export const listOf = (item: { list?: string | undefined }): string => item.list ?? DEFAULT_LIST;

/**
 * What `listKey` gives for each saved title, to tell whether a title is in a list. Worked out from the links, not read from the
 * saved keys: a show saved before shows were one title (under an episode's link) still counts as the show.
 */
export const savedKeys = (items: readonly { url: string; list?: string | undefined }[]): Set<string> => new Set(items.map((item) => listKey(item.url, listOf(item))));

/**
 * The lists of a profile: the first one always, then the others in the order they were put in (`order`), and those that never were
 * in the order they were made (a new id starts with the time, so ids sort that way: a list made after a move goes last).
 */
export function resolveLists(items: readonly ListNameItem[]): ListInfo[] {
  const named = items.filter(isLive) as LiveListName[];
  const first = named.find((item) => item.key === DEFAULT_LIST);
  const placed = (item: LiveListName) => item.order ?? Number.MAX_SAFE_INTEGER;
  const others = named.filter((item) => item.key !== DEFAULT_LIST).sort((a, b) => (placed(a) === placed(b) ? (a.key < b.key ? -1 : 1) : placed(a) < placed(b) ? -1 : 1));
  return [{ id: DEFAULT_LIST, ...(first ? { name: first.name } : {}) }, ...others.map(({ key, name }) => ({ id: key, name }))].slice(0, MAX_LISTS);
}

/** An id for a list somebody makes. */
export const newListId = (now = Date.now()): string => `l${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
