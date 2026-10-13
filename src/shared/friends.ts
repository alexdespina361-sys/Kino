import { z } from "zod";
import { AvatarIdSchema, ListItemSchema, ListNameItemSchema, ProfileNameSchema, RatingItemSchema, type Settings } from "./account";
import { isHttpUrl } from "./media";

/**
 * Friends: two profiles that agreed to be, through a code one gave and the other typed (or a link with it). A friend can look at
 * the other's lists and ratings, send titles and watch-party invitations to their inbox, and hear what the other watches, each of
 * those only as far as the other's switches allow. All of it is optional: with `friends` off in the settings of a profile nothing
 * of it shows, is shared or arrives, and the friends themselves are kept for when it is turned on again.
 */

export const MAX_FRIENDS = 50;
/** An invitation (a code to give a friend) is good for this long, and for one friend. */
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
/** How many codes a profile can have out at once: making another takes back the oldest. */
export const MAX_OPEN_INVITES = 5;
/** Written the way people read it aloud: no 0/O or 1/I. The same letters as the codes that sign a TV in. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
/** How many things a friend's inbox keeps (the newest) and for how long. */
export const INBOX_MAX = 100;
export const INBOX_KEEP_MS = 30 * 24 * 3600 * 1000;
/** ...and how many of those can be from one friend, so that one friend cannot fill it and push out what the others sent. */
export const INBOX_PER_SENDER = 20;
/** A watch-party code is no use after the party, so an invitation to one is dropped after this. */
export const PARTY_INVITE_KEEP_MS = 12 * 3600 * 1000;
export const FRIEND_NOTE_MAX = 200;
/** What friends are told of what somebody watched: the last two weeks, from a minute in (a title tried and left is not "watched"). */
export const ACTIVITY_KEEP_MS = 14 * 24 * 3600 * 1000;
export const ACTIVITY_MIN_SECONDS = 60;
export const ACTIVITY_PER_FRIEND = 4;
export const ACTIVITY_MAX = 30;
/** "Is watching" for as long as it was last watched less than this ago. */
export const WATCHING_NOW_MS = 15 * 60 * 1000;
/**
 * "Online" for as long as a screen of the profile asked after its friends less than this ago. (A screen that is open and in view asks every
 * half minute, and not at all once it is out of view, so this is two missed looks.)
 */
export const ONLINE_MS = 90_000;

/* ------------------------------ the switches ------------------------------ */

/** Each is a setting of the profile (see SETTING_SCHEMAS), and this is what it is until it is set. Nothing is on until `friends` is. */
export const FRIEND_DEFAULTS = {
  friends: false,
  /** Friends can look at my lists... */
  friendsLists: true,
  /** ...and at my ratings. */
  friendsRatings: true,
  /** Friends are told what I watch... */
  friendsGive: false,
  /** ...and I am told what they watch. */
  friendsGet: false,
  /** Friends can send me titles and invitations to a watch party. */
  friendsInbox: true,
  /** Friends can see when I am online (and I can see when they are). Off, I am never shown as online: the one switch for "appear offline" and "always offline". */
  friendsPresence: true,
} as const;
export type FriendSetting = keyof typeof FRIEND_DEFAULTS;
export const FRIEND_SETTINGS = Object.keys(FRIEND_DEFAULTS) as FriendSetting[];
export type FriendChoices = { [K in FriendSetting]: boolean };

/** What a profile has chosen about friends, with the default for each thing it has not. */
export function friendChoices(settings: Settings): FriendChoices {
  const choice = (key: FriendSetting): boolean => settings[key] ?? FRIEND_DEFAULTS[key];
  return {
    friends: choice("friends"),
    friendsLists: choice("friendsLists"),
    friendsRatings: choice("friendsRatings"),
    friendsGive: choice("friendsGive"),
    friendsGet: choice("friendsGet"),
    friendsInbox: choice("friendsInbox"),
    friendsPresence: choice("friendsPresence"),
  };
}

/** Whether a profile lets its lists be looked at: friends are on, and it shares them. */
export function sharesLists(settings: Settings): boolean {
  const choices = friendChoices(settings);
  return choices.friends && choices.friendsLists;
}

/**
 * Whether a profile lets its ratings be looked at: friends are on, it shares them, and it has not turned ratings off. (Turned off,
 * ratings show to nobody, themselves included, though what was rated stays kept: so nobody else is shown it either.)
 */
export function sharesRatings(settings: Settings): boolean {
  const choices = friendChoices(settings);
  return choices.friends && choices.friendsRatings && settings.ratings !== false;
}

/* ------------------------------ text and pictures from friends ------------------------------ */

/**
 * Words that other people read as they were typed, made fit to show: no control characters and none that turn text around or hide in it
 * (a name that reads backwards, a line that hides another), no more than a few marks piled on one letter, and one space where there were
 * several. (Emoji, which join with an invisible joiner, are left whole. Nothing is added or rewritten: what comes out is never longer than
 * what went in, so a name that fitted its limit still does.)
 */
export function plainText(value: string): string {
  const cleaned = wellFormedText(value)
    .replace(/[\t-\r]/g, " ") // (line breaks and tabs read as spaces)
    .replace(/[­ᅟᅠ⠀ㅤﾠ]/gu, "") // (a soft hyphen and the blank fillers of Hangul and Braille: nothing to see)
    .replace(/[\p{Cc}؜​‎‏‪-‮⁠-⁯﻿]/gu, "")
    .replace(/(\p{M}{4})\p{M}+/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  // (Joiners and marks on their own are nothing to look at: a name or a title made only of them is no name or title.)
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(cleaned) ? cleaned : "";
}

/**
 * Whether a string has no lone surrogate (half of a pair, which JSON can carry): `encodeURIComponent` throws on one, so a page that puts a
 * friend's address in a request would fall over when its title is opened. (Written out rather than `isWellFormed`, which an older TV browser lacks.)
 */
export function isWellFormedText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false; // (at the end of the text `next` is NaN: no pair)
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** The same text with each lone surrogate replaced by U+FFFD (never longer, and the same text when there was none). */
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

/**
 * A picture that came from a friend is loaded by the browser of whoever looks, so it is shown only if it is the web address of some
 * other site: not a path (which would be this site's own), and not an address on this site (`ownHost` is the one the look came to),
 * which would make that browser, signed in as it is, call the site on a friend's say-so.
 */
export function foreignPicture(value: string | undefined, ownHost: string | undefined): string | undefined {
  if (!value || !isHttpUrl(value)) return undefined;
  const hostname = (host: string) => host.replace(/:\d+$/, "").toLowerCase();
  const url = new URL(value);
  if (isPrivateHost(url.hostname)) return undefined;
  return ownHost && hostname(url.host) === hostname(ownHost) ? undefined : value;
}

/**
 * A name or an address that only a private network (or this very machine) answers to: a picture from there would make the browser of
 * whoever looks knock on the doors of its own network on a friend's say-so. (`URL` has already turned `127.1` or `0x7f.1` into the plain
 * four numbers. A public name that points into a private network cannot be told from here.)
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("[") || !host.includes(".")) return true; // (an IPv6 address; a name with no dot: localhost, a router, a NAS)
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

/* ------------------------------ what travels ------------------------------ */

const IdSchema = z.string().min(1).max(60);
const PictureSchema = z.string().max(2048);
const LinkSchema = z.string().max(2048).refine(isHttpUrl, "invalid_request").refine(isWellFormedText, "invalid_request");
/** A picture sent by a friend is shown on the screen of another: a web address, never a path (see `foreignPicture`). */
const SentPictureSchema = LinkSchema;
/** Text that is shown to others: cleaned (see `plainText`) before it is measured. */
const shownText = (min: number, max: number) => z.string().max(1000).transform(plainText).pipe(z.string().min(min).max(max));

/** A friend, as the profile that has them sees them: who they are, and what they allow right now (all false while they have friends turned off). */
export const FriendSchema = z.object({
  id: IdSchema,
  name: ProfileNameSchema,
  avatar: AvatarIdSchema,
  since: z.number(),
  /** They have friends turned on: when they do not, nothing below is true. */
  on: z.boolean(),
  /** Their lists can be looked at. */
  lists: z.boolean(),
  /** Their ratings can be looked at. */
  ratings: z.boolean(),
  /** What they watch is told (they give it, and this profile gets it). */
  activity: z.boolean(),
  /** They take titles and invitations. */
  inbox: z.boolean(),
  /** A screen of theirs is open right now, and both of you let friends see that (see `ONLINE_MS`). Absent: not online, or not told. */
  online: z.boolean().optional(),
});
export type Friend = z.infer<typeof FriendSchema>;

/** A title a friend wants this profile to see. */
export const RecommendationSchema = z.object({
  kind: z.literal("recommend"),
  title: shownText(1, 300),
  url: LinkSchema,
  image: SentPictureSchema.optional(),
  backdrop: SentPictureSchema.optional(),
  year: z.number().int().min(1800).max(2200).optional(),
  type: z.enum(["movie", "series"]).optional(),
  /** Why, in a few words. */
  note: shownText(0, FRIEND_NOTE_MAX).optional(),
});
/** The six-digit code of a watch party that is open now (see `partyLink`), and when it stops being one. */
export const PartyInviteSchema = z.object({
  kind: z.literal("party"),
  code: z.string().regex(/^\d{6}$/),
  endsAt: z.number().finite(),
});
/** "Let's watch together": a friend asks for a party (nothing more; the answer is an invitation to one). */
export const TogetherSchema = z.object({ kind: z.literal("together") });
/** What one friend sends another. */
export type Message = z.infer<typeof RecommendationSchema> | z.infer<typeof PartyInviteSchema> | z.infer<typeof TogetherSchema>;

const To = { to: z.array(IdSchema).min(1).max(MAX_FRIENDS) };
/** What a profile sends to friends (to each of `to`). */
export const SendSchema = z.discriminatedUnion("kind", [RecommendationSchema.extend(To), PartyInviteSchema.extend(To), TogetherSchema.extend(To)]);
export type SendRequest = z.infer<typeof SendSchema>;
/** Who it was delivered to and who is not taking things. */
export const SentSchema = z.object({ sent: z.array(IdSchema), declined: z.array(IdSchema) });
export type Sent = z.infer<typeof SentSchema>;

const Delivered = { id: z.string().min(1).max(40), at: z.number(), from: IdSchema, read: z.boolean() };
/**
 * What is in an inbox. An invitation says whether its party is `open` (the server looks, each time: the code and the time it ends are
 * those of the party as it is now, which can differ from what was sent when the code was renewed). An answer without it comes from a
 * server that does not look, and then the time `endsAt` is all there is to go by (see `partyOpen`).
 */
export const InboxItemSchema = z.discriminatedUnion("kind", [
  RecommendationSchema.extend(Delivered),
  PartyInviteSchema.extend(Delivered).extend({ open: z.boolean().optional() }),
  TogetherSchema.extend(Delivered),
]);
export type InboxItem = z.infer<typeof InboxItemSchema>;

/** Something a friend watched: a film, or a show (its latest episode). Worked out from what the friend's profile keeps, never kept apart. */
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
  /** How far into the film, or into that episode, they are (0..100). */
  percent: z.number().int().min(0).max(100).optional(),
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

/**
 * How far a friend got in a title that is in their lists or ratings: the latest episode of a show, and how far into it (or into the film).
 * `link` is the title's address as `titleLink` names it, which is how a list item or a rating of it is found.
 */
export const FriendProgressSchema = z.object({
  link: z.string().max(2048),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  percent: z.number().int().min(0).max(100).optional(),
  done: z.boolean().optional(),
});
export type FriendProgress = z.infer<typeof FriendProgressSchema>;

/** A code this profile gave out and nobody has used yet. */
export const OpenInviteSchema = z.object({ code: z.string().max(20), expiresAt: z.number() });
export type OpenInvite = z.infer<typeof OpenInviteSchema>;

/** Everything a profile with friends turned on asks for, in one answer. */
export const FriendsStateSchema = z.object({
  friends: z.array(FriendSchema),
  inbox: z.array(InboxItemSchema),
  activity: z.array(ActivityItemSchema),
  invites: z.array(OpenInviteSchema),
});
export type FriendsState = z.infer<typeof FriendsStateSchema>;

/** A friend as a profile that has friends turned off sees them: who they are and since when, nothing of what they have chosen (that is for a profile that has friends on). */
export const KeptFriendSchema = FriendSchema.pick({ id: true, name: true, avatar: true, since: true });
export type KeptFriend = z.infer<typeof KeptFriendSchema>;
/** The friends of a profile that has friends turned off: only who they are, so that one can be taken off without turning anything on. */
export const KeptFriendsSchema = z.object({ friends: z.array(KeptFriendSchema) });
export type KeptFriends = z.infer<typeof KeptFriendsSchema>;

/** Who is behind a code, before it is used. */
export const InviteViewSchema = z.object({ code: z.string().max(20), from: z.object({ name: ProfileNameSchema, avatar: AvatarIdSchema }) });
export type InviteView = z.infer<typeof InviteViewSchema>;
export const AcceptSchema = z.object({ code: z.string().min(1).max(40) });
export const AcceptedSchema = z.object({ friend: FriendSchema });
export const InvitedSchema = z.object({ code: z.string().max(20), expiresAt: z.number() });

/** What a friend lets be looked at: the lists (with their names) and the ratings. The items are as the friend's profile keeps them. */
export const FriendListsSchema = z.object({ listNames: z.array(ListNameItemSchema), list: z.array(ListItemSchema), progress: z.array(FriendProgressSchema).optional() });
export type FriendLists = z.infer<typeof FriendListsSchema>;
export const FriendRatingsSchema = z.object({ ratings: z.array(RatingItemSchema), progress: z.array(FriendProgressSchema).optional() });
export type FriendRatings = z.infer<typeof FriendRatingsSchema>;

/* ------------------------------ words for the screens ------------------------------ */

/** What a friend's activity says they did, from when it was and whether it was finished. */
export function activityVerb(item: Pick<ActivityItem, "at" | "done">, now: number): "watching" | "watched" | "finished" {
  if (item.done) return "finished";
  return now - item.at < WATCHING_NOW_MS ? "watching" : "watched";
}

/** The friends that something can be sent to now. */
export const reachable = (friends: readonly Friend[]): Friend[] => friends.filter((friend) => friend.on && friend.inbox);

/** Whether the party an invitation is to can be joined: what the server said of it, else by the clock. */
export const partyOpen = (invitation: { open?: boolean | undefined; endsAt: number }, now: number): boolean => invitation.open ?? invitation.endsAt > now;

/** Whether asking a friend to watch together makes sense: they take things in the inbox, and tell this profile what they watch (so they are somebody to ask). */
export const canAskTogether = (friend: Friend): boolean => friend.on && friend.inbox && friend.activity;

/** The address that adds the friend whose code this is (`/?friend=ABCD2345`): what the link in a message holds. */
export const friendLink = (code: string, origin: string): string => `${origin}/?friend=${code}`;
