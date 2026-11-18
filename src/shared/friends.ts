import { z } from "zod";
import { AvatarSeenSchema, ListItemSchema, ListNameItemSchema, ProfileNameSchema, RatingItemSchema, TagNumberSchema, type Settings } from "./account";
import { isHttpUrl } from "./media";

export const MAX_FRIENDS = 50;
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAX_OPEN_INVITES = 5;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
export const INBOX_MAX = 100;
export const INBOX_KEEP_MS = 30 * 24 * 3600 * 1000;
export const INBOX_PER_SENDER = 20;
export const REQUEST_KEEP_MS = 30 * 24 * 3600 * 1000;
export const MAX_REQUESTS = 30;
export const PARTY_INVITE_KEEP_MS = 12 * 3600 * 1000;
export const FRIEND_NOTE_MAX = 200;
export const PLAN_MIN_AHEAD_MS = 5 * 60 * 1000;
export const PLAN_MAX_AHEAD_MS = 30 * 24 * 3600 * 1000;
export const PLAN_OPEN_PER_PAIR = 3;
export const PLAN_OPEN_PER_SENDER = 10;
export const PLAN_KEEP_AFTER_MS = 2 * 3600 * 1000;
export const PLAN_SETTLE_AHEAD_MS = 30 * 60 * 1000;
export const ACTIVITY_KEEP_MS = 14 * 24 * 3600 * 1000;
export const ACTIVITY_MIN_SECONDS = 60;
export const ACTIVITY_PER_FRIEND = 4;
export const ACTIVITY_MAX = 30;
export const WATCHING_NOW_MS = 15 * 60 * 1000;
export const ONLINE_MS = 90_000;

export const FRIEND_DEFAULTS = {
  friends: false,
  friendsLists: true,
  friendsRatings: true,
  friendsGive: false,
  friendsGet: false,
  friendsInbox: true,
  friendsPresence: true,
  friendsMessages: true,
} as const;
export type FriendSetting = keyof typeof FRIEND_DEFAULTS;
export const FRIEND_SETTINGS = Object.keys(FRIEND_DEFAULTS) as FriendSetting[];
export type FriendChoices = { [K in FriendSetting]: boolean };

export function friendChoices(settings: Settings): FriendChoices {
  const choice = (key: FriendSetting): boolean => settings[key] ?? FRIEND_DEFAULTS[key];
  const gives = settings.friends === false ? false : choice("friendsGive");
  return {
    friends: settings.friendsOff !== true && settings.child !== true,
    friendsLists: choice("friendsLists"),
    friendsRatings: settings.ratings === false ? false : choice("friendsRatings"),
    friendsGive: gives,
    friendsGet: gives,
    friendsInbox: choice("friendsInbox"),
    friendsPresence: choice("friendsPresence"),
    friendsMessages: choice("friendsMessages"),
  };
}

export const ratingsShown = (_settings: Settings): boolean => true;

export function friendSwitchWrites(settings: Settings, key: FriendSetting, on: boolean): Array<[FriendSetting | "ratings", boolean]> {
  const writes: Array<[FriendSetting | "ratings", boolean]> = [[key, on]];
  if (on && key === "friendsGive" && settings.friends === false) writes.push(["friends", true]);
  if (on && key === "friendsRatings" && settings.ratings === false) writes.push(["ratings", true]);
  return writes;
}

export type SunsetSwitch = "friendsLists" | "friendsRatings" | "friendsInbox" | "friendsPresence" | "friendsMessages" | "newsPopups";
const SUNSET_SWITCHES: readonly SunsetSwitch[] = ["friendsLists", "friendsRatings", "friendsInbox", "friendsPresence", "friendsMessages", "newsPopups"];

export const sunsetSwitches = (settings: Settings): SunsetSwitch[] => SUNSET_SWITCHES.filter((key) => settings[key] === false || (key === "friendsRatings" && settings.ratings === false));

export function takesMessages(settings: Settings): boolean {
  const choices = friendChoices(settings);
  return choices.friends && choices.friendsMessages;
}

export function sharesLists(settings: Settings): boolean {
  const choices = friendChoices(settings);
  return choices.friends && choices.friendsLists;
}

export function sharesRatings(settings: Settings): boolean {
  const choices = friendChoices(settings);
  return choices.friends && choices.friendsRatings;
}

export const tagLabel = (name: string, tag: number): string => `${name}#${tag}`;

export const nameKey = (name: string): string => plainText(name).normalize("NFC").toLowerCase();

export function parseTag(text: string): { name: string; tag: number } | undefined {
  const at = text.lastIndexOf("#");
  if (at < 1) return undefined;
  const digits = text.slice(at + 1).trim();
  const name = plainText(text.slice(0, at));
  if (!name || !/^\d{1,6}$/.test(digits)) return undefined;
  const tag = Number(digits);
  return tag >= 1 ? { name, tag } : undefined;
}

export const sameTag = (a: { name: string; tag?: number | undefined }, b: { name: string; tag?: number | undefined }): boolean =>
  a.tag !== undefined && a.tag === b.tag && nameKey(a.name) === nameKey(b.name);

export function plainText(value: string): string {
  const cleaned = wellFormedText(value)
    .replace(/[\t-\r]/g, " ")
    .replace(/[­ᅟᅠ⠀ㅤﾠ]/gu, "")
    .replace(/[\p{Cc}؜​‎‏‪-‮⁠-⁯﻿]/gu, "")
    .replace(/(\p{M}{4})\p{M}+/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(cleaned) ? cleaned : "";
}

export function isWellFormedText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function wellFormedText(value: string): string {
  if (isWellFormedText(value)) return value;
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const next = value.charCodeAt(i + 1);
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += value[i]! + value[i + 1]!;
      i++;
    } else out += code >= 0xd800 && code <= 0xdfff ? "�" : value[i]!;
  }
  return out;
}

export function foreignPicture(value: string | undefined, ownHost: string | undefined): string | undefined {
  if (!value || !isHttpUrl(value)) return undefined;
  const hostname = (host: string) => host.replace(/:\d+$/, "").toLowerCase();
  const url = new URL(value);
  if (isPrivateHost(url.hostname)) return undefined;
  return ownHost && hostname(url.host) === hostname(ownHost) ? undefined : value;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("[") || !host.includes(".")) return true;
  if (/\.(local|localhost|internal|lan|home|corp|intranet|private)$/.test(host) || host.endsWith(".home.arpa")) return true;
  const quad = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!quad) return false;
  const [a, b, c] = [Number(quad[1]), Number(quad[2]), Number(quad[3])] as [number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

const IdSchema = z.string().min(1).max(60);
const PictureSchema = z.string().max(2048);
const LinkSchema = z.string().max(2048).refine(isHttpUrl, "invalid_request").refine(isWellFormedText, "invalid_request");
const SentPictureSchema = LinkSchema;
const shownText = (min: number, max: number) => z.string().max(1000).transform(plainText).pipe(z.string().min(min).max(max));

export const FriendSchema = z.object({
  id: IdSchema,
  name: ProfileNameSchema,
  avatar: AvatarSeenSchema,
  tag: TagNumberSchema.optional(),
  since: z.number(),
  on: z.boolean(),
  lists: z.boolean(),
  ratings: z.boolean(),
  activity: z.boolean(),
  inbox: z.boolean(),
  online: z.boolean().optional(),
  lastOnline: z.number().int().nonnegative().optional(),
});
export type Friend = z.infer<typeof FriendSchema>;

export const RecommendationSchema = z.object({
  kind: z.literal("recommend"),
  title: shownText(1, 300),
  url: LinkSchema,
  image: SentPictureSchema.optional(),
  backdrop: SentPictureSchema.optional(),
  year: z.number().int().min(1800).max(2200).optional(),
  type: z.enum(["movie", "series"]).optional(),
  note: shownText(0, FRIEND_NOTE_MAX).optional(),
});
export const PartyInviteSchema = z.object({
  kind: z.literal("party"),
  code: z.string().regex(/^\d{6}$/),
  endsAt: z.number().finite(),
});
export const TogetherSchema = z.object({ kind: z.literal("together") });
export const PlanSchema = z.object({ kind: z.literal("plan"), when: z.number().int().positive(), note: shownText(0, FRIEND_NOTE_MAX).optional() });
export const PlanAnswerSchema = z.enum(["yes", "no"]);
export type PlanAnswer = z.infer<typeof PlanAnswerSchema>;
export type Message = z.infer<typeof RecommendationSchema> | z.infer<typeof PartyInviteSchema> | z.infer<typeof TogetherSchema> | z.infer<typeof PlanSchema>;

const To = { to: z.array(IdSchema).min(1).max(MAX_FRIENDS) };
export const SendSchema = z.discriminatedUnion("kind", [
  RecommendationSchema.extend(To),
  PartyInviteSchema.extend(To),
  TogetherSchema.extend(To),
  PlanSchema.extend({ to: z.array(IdSchema).length(1) }),
]);
export type SendRequest = z.infer<typeof SendSchema>;
export const SentSchema = z.object({ sent: z.array(IdSchema), declined: z.array(IdSchema) });
export type Sent = z.infer<typeof SentSchema>;

const Delivered = { id: z.string().min(1).max(40), at: z.number(), from: IdSchema, read: z.boolean() };
export const InboxItemSchema = z.discriminatedUnion("kind", [
  RecommendationSchema.extend(Delivered),
  PartyInviteSchema.extend(Delivered).extend({ open: z.boolean().optional() }),
  TogetherSchema.extend(Delivered),
  PlanSchema.extend(Delivered).extend({ answer: PlanAnswerSchema.optional() }),
]);
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const ActivityItemSchema = z.object({
  friend: IdSchema,
  key: z.string().max(400),
  title: z.string().max(300),
  url: z.string().max(2048),
  image: PictureSchema.optional(),
  backdrop: PictureSchema.optional(),
  year: z.number().int().optional(),
  at: z.number(),
  done: z.boolean().optional(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  percent: z.number().int().min(0).max(100).optional(),
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const FriendProgressSchema = z.object({
  link: z.string().max(2048),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  percent: z.number().int().min(0).max(100).optional(),
  done: z.boolean().optional(),
});
export type FriendProgress = z.infer<typeof FriendProgressSchema>;

export const OpenInviteSchema = z.object({ code: z.string().max(20), expiresAt: z.number() });
export type OpenInvite = z.infer<typeof OpenInviteSchema>;

export const PersonSchema = z.object({ id: IdSchema, name: ProfileNameSchema, avatar: AvatarSeenSchema, tag: TagNumberSchema });
export type Person = z.infer<typeof PersonSchema>;
export const RequestSchema = z.object({ from: PersonSchema, at: z.number() });
export type FriendRequest = z.infer<typeof RequestSchema>;
export const SentRequestSchema = z.object({ to: PersonSchema, at: z.number() });
export type SentRequest = z.infer<typeof SentRequestSchema>;

export const ChatNoticeSchema = z.object({ friend: IdSchema, count: z.number().int().positive(), at: z.number() });
export type ChatNotice = z.infer<typeof ChatNoticeSchema>;

export const FriendsStateSchema = z.object({
  friends: z.array(FriendSchema),
  inbox: z.array(z.unknown()).transform((items) => items.flatMap((item) => { const known = InboxItemSchema.safeParse(item); return known.success ? [known.data] : []; })),
  activity: z.array(ActivityItemSchema),
  invites: z.array(OpenInviteSchema),
  requests: z.array(RequestSchema),
  sent: z.array(SentRequestSchema),
  chat: z.array(ChatNoticeSchema).optional(),
});
export type FriendsState = z.infer<typeof FriendsStateSchema>;

export const KeptFriendSchema = FriendSchema.pick({ id: true, name: true, avatar: true, since: true });
export type KeptFriend = z.infer<typeof KeptFriendSchema>;
export const KeptFriendsSchema = z.object({ friends: z.array(KeptFriendSchema) });
export type KeptFriends = z.infer<typeof KeptFriendsSchema>;

export const InviteViewSchema = z.object({ code: z.string().max(20), from: z.object({ name: ProfileNameSchema, avatar: AvatarSeenSchema }) });
export type InviteView = z.infer<typeof InviteViewSchema>;
export const AcceptSchema = z.object({ code: z.string().min(1).max(40) });
export const AcceptedSchema = z.object({ friend: FriendSchema });
export const InvitedSchema = z.object({ code: z.string().max(20), expiresAt: z.number() });

export const TagViewSchema = PersonSchema.omit({ id: true });
export type TagView = z.infer<typeof TagViewSchema>;
export const AskSchema = z.object({ tag: z.string().min(1).max(60) });
export const AskedSchema = z.object({ status: z.enum(["sent", "friends"]), friend: FriendSchema.optional() });
export type AskOutcome = z.infer<typeof AskedSchema>;
export const ScreenProofSchema = z.object({ proof: z.string().min(1).max(100) });

export const FriendListsSchema = z.object({ listNames: z.array(ListNameItemSchema), list: z.array(ListItemSchema), progress: z.array(FriendProgressSchema).optional() });
export type FriendLists = z.infer<typeof FriendListsSchema>;
export const FriendRatingsSchema = z.object({ ratings: z.array(RatingItemSchema), progress: z.array(FriendProgressSchema).optional() });
export type FriendRatings = z.infer<typeof FriendRatingsSchema>;

export function activityVerb(item: Pick<ActivityItem, "at" | "done">, now: number): "watching" | "watched" | "finished" {
  if (item.done) return "finished";
  return now - item.at < WATCHING_NOW_MS ? "watching" : "watched";
}

export const reachable = (friends: readonly Friend[]): Friend[] => friends.filter((friend) => friend.on && friend.inbox);

export const partyOpen = (invitation: { open?: boolean | undefined; endsAt: number }, now: number): boolean => invitation.open ?? invitation.endsAt > now;

export type PlanItem = Extract<InboxItem, { kind: "plan" }>;

export function planTimeProblem(when: number, now: number): "too_soon" | "too_far" | undefined {
  if (when < now + PLAN_MIN_AHEAD_MS) return "too_soon";
  return when > now + PLAN_MAX_AHEAD_MS ? "too_far" : undefined;
}

export const planAsks = (item: Pick<PlanItem, "answer" | "when">, now: number): boolean => item.answer === undefined && item.when > now;

export const planDue = (item: Pick<PlanItem, "answer" | "when">, now: number): boolean => item.answer === "yes" && item.when <= now && now < item.when + PLAN_KEEP_AFTER_MS;

export const canAskTogether = (friend: Friend): boolean => friend.on && friend.inbox;

export const friendLink = (code: string, origin: string): string => `${origin}/?friend=${code}`;
