import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodError } from "zod";
import {
  ACTIVITY_KEEP_MS,
  ACTIVITY_MAX,
  ACTIVITY_MIN_SECONDS,
  ACTIVITY_PER_FRIEND,
  AcceptSchema,
  SendSchema,
  foreignPicture,
  friendChoices,
  isLive,
  plainText,
  sharesLists,
  sharesRatings,
  titleLink,
  wellFormedText,
  type ActivityItem,
  type Friend,
  type FriendLists,
  type FriendProgress,
  type FriendRatings,
  type FriendsState,
  type InviteView,
  type KeptFriend,
  type KeptFriends,
  type LiveProgress,
  type Sent,
} from "../../shared";
import { normalise } from "./links";
import { Presence } from "./presence";
import { RateLimiter } from "./rateLimit";
import type { FriendError } from "./friends";
import type { StoreError, AccountStore } from "./store";

/** What the routes of the accounts hand over for these to do their part in the same way. */
export interface FriendRouteHelpers {
  store: AccountStore;
  authenticate(request: FastifyRequest): { accountId: string } | undefined;
  signedOut(reply: FastifyReply): FastifyReply;
  tooMany(reply: FastifyReply, waitMs: number): FastifyReply;
  invalid(reply: FastifyReply, error: ZodError): FastifyReply;
  refused(reply: FastifyReply, error: StoreError): FastifyReply;
}

const MINUTE = 60_000;
const STATUS: Record<FriendError | "friends_off" | "not_shared" | "not_friends", number> = {
  invite_gone: 404,
  own_invite: 409,
  already_friends: 409,
  friends_full: 409,
  friends_off: 403,
  not_shared: 403,
  not_friends: 404,
};

type Asked = FastifyRequest & { params: { id: string; fid?: string } };

/** The words and pictures of a friend's own things that a screen shows to somebody else (see `plainText` and `foreignPicture`). */
const WORDS = ["title", "note", "description", "name"] as const;
const PICTURES = ["image", "backdrop"] as const;
function fitToShow<T extends object>(item: T, ownHost: string | undefined): T {
  const out = { ...item } as Record<string, unknown>;
  for (const key of WORDS) {
    if (typeof out[key] !== "string") continue;
    // (a name or a title is never empty on a screen: one made of nothing that can be seen is shown as a question mark)
    out[key] = plainText(out[key]) || (key === "name" || key === "title" ? "?" : "");
  }
  for (const key of PICTURES) {
    const picture = typeof out[key] === "string" ? foreignPicture(wellFormedText(out[key]), ownHost) : undefined;
    if (picture) out[key] = picture;
    else delete out[key];
  }
  // (An address with half a pair in it makes a page throw when it puts the address in a request: see `wellFormedText`.)
  if (typeof out.url === "string") out.url = wellFormedText(out.url);
  return out as T;
}

/** How far into it a card says somebody is, in whole percent: all of it for one that was finished, nothing known when its length is not. */
function percentOf(card: { position: number; duration: number; done?: boolean | undefined }): number | undefined {
  if (card.done) return 100;
  return card.duration > 0 ? Math.max(0, Math.min(100, Math.round((100 * card.position) / card.duration))) : undefined;
}

/**
 * Friends, under /api/profiles/:id/friends: the profile in the address is the one asking, and has to be one of the signed-in
 * account's, with friends turned on in its settings (those are kept on the server like everything else of a profile, so they
 * are what decides who sees what, not whatever a screen says). Taking things away (a friend, a code, something in the inbox) and
 * seeing who the friends are need no more than that the profile is its own: a profile that turned friends off can still end a
 * friendship without turning on, for a moment, everything it shares.
 */
export function friendRoutes(app: FastifyInstance, helpers: FriendRouteHelpers): void {
  const { store } = helpers;
  const book = store.friends;
  const presence = new Presence(() => store.clock());

  // Looking is cheap and happens every half minute on each screen; making things and guessing codes is slowed down.
  const readsByAccount = new RateLimiter(240, MINUTE);
  const sendsByAccount = new RateLimiter(60, 10 * MINUTE);
  const acceptsByAccount = new RateLimiter(60, 10 * MINUTE);
  const invitesByAccount = new RateLimiter(20, 60 * MINUTE);
  const wrongByAccount = new RateLimiter(10, 15 * MINUTE);
  const wrongByIp = new RateLimiter(100, 15 * MINUTE);

  const refuse = (reply: FastifyReply, error: keyof typeof STATUS) => reply.code(STATUS[error]).send({ error });

  /** The profile asking, or the answer that tells why not. `paused`: no matter whether the profile has friends turned on. */
  function asker(request: Asked, reply: FastifyReply, limiter = readsByAccount, paused = false): { accountId: string; profileId: string } | undefined {
    const auth = helpers.authenticate(request);
    if (!auth) return void helpers.signedOut(reply);
    const profileId = request.params.id;
    if (!store.ownsProfile(auth.accountId, profileId)) return void helpers.refused(reply, "not_found");
    const wait = limiter.wait(auth.accountId);
    if (wait > 0) return void helpers.tooMany(reply, wait);
    limiter.hit(auth.accountId);
    if (!paused && !friendChoices(store.settingsOf(profileId)).friends) return void refuse(reply, "friends_off");
    return { accountId: auth.accountId, profileId };
  }

  /** What `friend` is to `profileId` right now: who, and what they allow. */
  function friendView(profileId: string, friend: { id: string; since: number }): Friend | undefined {
    const card = store.profileCard(friend.id);
    if (!card) return undefined;
    const mine = friendChoices(store.settingsOf(profileId));
    const theirSettings = store.settingsOf(friend.id);
    const theirs = friendChoices(theirSettings);
    // (Seen as online only by a profile that lets itself be seen: nobody sees what they do not show.)
    const online = mine.friends && mine.friendsPresence && theirs.friends && theirs.friendsPresence && presence.online(friend.id);
    return {
      ...card,
      since: friend.since,
      on: theirs.friends,
      lists: sharesLists(theirSettings),
      ratings: sharesRatings(theirSettings),
      activity: tellsWhatTheyWatch(profileId, friend.id),
      inbox: theirs.friends && theirs.friendsInbox,
      ...(online ? { online: true } : {}),
    };
  }

  const byName = (a: { name: string; since: number }, b: { name: string; since: number }) => a.name.localeCompare(b.name) || a.since - b.since;

  /** The friends of a profile, by name. */
  function friendList(profileId: string): Friend[] {
    return book
      .friendsOf(profileId)
      .map((friend) => friendView(profileId, friend))
      .filter((friend): friend is Friend => friend !== undefined)
      .sort(byName);
  }

  /** The same friends as who they are and nothing of what they have chosen: a profile with friends turned off is not told that. */
  function keptList(profileId: string): KeptFriend[] {
    return book
      .friendsOf(profileId)
      .flatMap((friend) => {
        const card = store.profileCard(friend.id);
        return card ? [{ ...card, since: friend.since }] : [];
      })
      .sort(byName);
  }

  /** The last things a friend watched, from the cards their profile keeps for "Continue watching". */
  function watchedBy(friendId: string, now: number, ownHost: string | undefined): ActivityItem[] {
    return store
      .items(friendId, "progress")
      .filter(isLive)
      .filter((card: LiveProgress) => now - card.at < ACTIVITY_KEEP_MS && (card.done === true || card.position >= ACTIVITY_MIN_SECONDS))
      .sort((a: LiveProgress, b: LiveProgress) => b.at - a.at)
      .slice(0, ACTIVITY_PER_FRIEND)
      .map((card: LiveProgress) => {
        const percent = percentOf(card);
        return fitToShow<ActivityItem>(
          {
            friend: friendId,
            key: card.key,
            title: card.title,
            url: card.url,
            ...(card.image ? { image: card.image } : {}),
            ...(card.backdrop ? { backdrop: card.backdrop } : {}),
            ...(card.year !== undefined ? { year: card.year } : {}),
            at: card.at,
            ...(card.done ? { done: true } : {}),
            ...(card.season !== undefined ? { season: card.season } : {}),
            ...(card.episode !== undefined ? { episode: card.episode } : {}),
            ...(percent !== undefined ? { percent } : {}),
          },
          ownHost,
        );
      });
  }

  /**
   * How far a friend got in the titles of an answer (the ones in their lists, or that they rated): the latest episode of a show and how
   * far into it, from the cards their profile keeps. Only for a friend who tells what they watch, and only for the titles the answer has.
   */
  function progressIn(friendId: string, urls: readonly string[]): FriendProgress[] {
    const wanted = new Set(urls.map((address) => titleLink(wellFormedText(address))));
    const newest = new Map<string, LiveProgress>();
    for (const card of store.items(friendId, "progress").filter(isLive)) {
      const link = titleLink(wellFormedText(card.url));
      if (wanted.has(link) && (newest.get(link)?.at ?? -1) < card.at) newest.set(link, card);
    }
    return [...newest].map(([link, card]) => {
      const percent = percentOf(card);
      return {
        link,
        ...(card.season !== undefined ? { season: card.season } : {}),
        ...(card.episode !== undefined ? { episode: card.episode } : {}),
        ...(percent !== undefined ? { percent } : {}),
        ...(card.done ? { done: true } : {}),
      };
    });
  }

  /** Whether `friendId` tells `profileId` what they watch (they give it and this profile gets it): the same as `activity` on a friend. */
  function tellsWhatTheyWatch(profileId: string, friendId: string): boolean {
    const theirs = friendChoices(store.settingsOf(friendId));
    return theirs.friends && theirs.friendsGive && friendChoices(store.settingsOf(profileId)).friendsGet;
  }

  function stateFor(profileId: string, ownHost: string | undefined): FriendsState {
    const now = store.clock();
    const friends = friendList(profileId);
    const known = new Set(friends.map((friend) => friend.id));
    const activity = friends
      .filter((friend) => friend.activity)
      .flatMap((friend) => watchedBy(friend.id, now, ownHost))
      .sort((a, b) => b.at - a.at)
      .slice(0, ACTIVITY_MAX);
    return {
      friends,
      inbox: book
        .inboxOf(profileId)
        .filter((item) => known.has(item.from))
        .map((item) => fitToShow(item, ownHost)),
      activity,
      invites: book.invitesOf(profileId).map(({ code, expiresAt }) => ({ code, expiresAt })),
    };
  }

  const base = "/api/profiles/:id/friends";

  /** Everything the Friends page shows, in one answer: the screens ask for it every half minute while they are open. */
  app.get<{ Params: { id: string } }>(base, async (request, reply) => {
    const me = asker(request, reply);
    if (!me) return reply;
    // A screen that looks is a screen that is open: that is how friends know a profile is online (unless it chose not to be seen).
    if (friendChoices(store.settingsOf(me.profileId)).friendsPresence) presence.heartbeat(me.profileId);
    else presence.forget(me.profileId);
    return reply.send(stateFor(me.profileId, request.headers.host));
  });

  /** Who a profile that has friends turned off still has as friends, and nothing more: so that one of them can be taken off without turning anything on first. */
  app.get<{ Params: { id: string } }>(`${base}/kept`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    const kept: KeptFriends = { friends: keptList(me.profileId) };
    return reply.send(kept);
  });

  /* ------------------------------ making friends ------------------------------ */

  app.post<{ Params: { id: string } }>(`${base}/invites`, async (request, reply) => {
    const me = asker(request, reply, invitesByAccount);
    if (!me) return reply;
    const { code, expiresAt } = book.createInvite(me.profileId);
    return reply.code(201).send({ code, expiresAt });
  });

  app.delete<{ Params: { id: string; code: string } }>(`${base}/invites/:code`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    return book.revokeInvite(me.profileId, request.params.code) ? reply.code(204).send() : refuse(reply, "invite_gone");
  });

  /** Who a code is from, so a link can ask "add Sam?" before it is used. A code that is not good counts as a wrong guess. */
  app.get<{ Params: { id: string; code: string } }>(`${base}/invites/:code`, async (request, reply) => {
    const me = asker(request, reply);
    if (!me) return reply;
    const wait = Math.max(wrongByAccount.wait(me.accountId), wrongByIp.wait(request.ip));
    if (wait > 0) return helpers.tooMany(reply, wait);
    const invite = book.peekInvite(request.params.code);
    const card = invite && friendChoices(store.settingsOf(invite.from)).friends ? store.profileCard(invite.from) : undefined;
    if (!invite || !card) {
      wrongByAccount.hit(me.accountId);
      wrongByIp.hit(request.ip);
      return refuse(reply, "invite_gone");
    }
    const view: InviteView = { code: invite.code, from: { name: card.name, avatar: card.avatar } };
    return reply.send(view);
  });

  app.post<{ Params: { id: string } }>(`${base}/accept`, async (request, reply) => {
    const me = asker(request, reply, acceptsByAccount); // (not the budget of sending: using the one must not use up the other)
    if (!me) return reply;
    const wait = Math.max(wrongByAccount.wait(me.accountId), wrongByIp.wait(request.ip));
    if (wait > 0) return helpers.tooMany(reply, wait);
    const parsed = AcceptSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const code = normalise(parsed.data.code);
    const invite = book.peekInvite(code);
    // A code whose maker has turned friends off (or is gone) is as good as none: nobody is added to someone who is not taking friends.
    if (!invite || !store.profileCard(invite.from) || !friendChoices(store.settingsOf(invite.from)).friends) {
      wrongByAccount.hit(me.accountId);
      wrongByIp.hit(request.ip);
      return refuse(reply, "invite_gone");
    }
    const joined = book.redeem(me.profileId, code);
    if (!joined.ok) return refuse(reply, joined.error);
    const friend = friendView(me.profileId, { id: joined.value.friend, since: joined.value.since });
    return friend ? reply.code(201).send({ friend }) : refuse(reply, "invite_gone");
  });

  app.delete<{ Params: { id: string; fid: string } }>(`${base}/:fid`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    return book.unfriend(me.profileId, request.params.fid) ? reply.code(204).send() : refuse(reply, "not_friends");
  });

  /* ------------------------------ looking at a friend ------------------------------ */

  /** A friend whose lists or ratings may be looked at, or the answer that tells why not. */
  function sharer(request: Asked, reply: FastifyReply, shares: "lists" | "ratings"): { friendId: string; watching: boolean } | undefined {
    const me = asker(request, reply);
    if (!me) return undefined;
    const friendId = request.params.fid ?? "";
    if (!book.areFriends(me.profileId, friendId)) return void refuse(reply, "not_friends");
    const theirs = store.settingsOf(friendId);
    if (!(shares === "lists" ? sharesLists(theirs) : sharesRatings(theirs))) return void refuse(reply, "not_shared");
    return { friendId, watching: tellsWhatTheyWatch(me.profileId, friendId) };
  }

  app.get<{ Params: { id: string; fid: string } }>(`${base}/:fid/lists`, async (request, reply) => {
    const shared = sharer(request, reply, "lists");
    if (!shared) return reply;
    const host = request.headers.host;
    const list = store
      .items(shared.friendId, "list")
      .filter(isLive)
      .map((item) => fitToShow(item, host));
    const lists: FriendLists = {
      listNames: store
        .items(shared.friendId, "listNames")
        .filter(isLive)
        .map((name) => fitToShow(name, host)),
      list,
      // (How far they got in these titles is part of what they tell of what they watch.)
      ...(shared.watching ? { progress: progressIn(shared.friendId, list.map((item) => item.url)) } : {}),
    };
    return reply.send(lists);
  });

  app.get<{ Params: { id: string; fid: string } }>(`${base}/:fid/ratings`, async (request, reply) => {
    const shared = sharer(request, reply, "ratings");
    if (!shared) return reply;
    const host = request.headers.host;
    const rated = store
      .items(shared.friendId, "ratings")
      .filter(isLive)
      .sort((a, b) => b.ratedAt - a.ratedAt)
      .map((rating) => fitToShow(rating, host));
    const ratings: FriendRatings = {
      ratings: rated,
      ...(shared.watching ? { progress: progressIn(shared.friendId, rated.map((rating) => rating.url)) } : {}),
    };
    return reply.send(ratings);
  });

  /* ------------------------------ sending, and the inbox ------------------------------ */

  app.post<{ Params: { id: string } }>(`${base}/send`, async (request, reply) => {
    const me = asker(request, reply, sendsByAccount);
    if (!me) return reply;
    const parsed = SendSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const { to, ...message } = parsed.data;
    const answer: Sent = { sent: [], declined: [] };
    for (const id of new Set(to)) {
      const theirs = friendChoices(store.settingsOf(id));
      // (Somebody who is not a friend is told apart from nobody no more than a friend who is not taking things.)
      if (!book.areFriends(me.profileId, id) || !theirs.friends || !theirs.friendsInbox) {
        answer.declined.push(id);
        continue;
      }
      book.deliver(id, me.profileId, message);
      answer.sent.push(id);
    }
    return reply.send(answer);
  });

  app.post<{ Params: { id: string } }>(`${base}/inbox/read`, async (request, reply) => {
    const me = asker(request, reply);
    if (!me) return reply;
    book.markRead(me.profileId);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string; itemId: string } }>(`${base}/inbox/:itemId`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    return book.dismiss(me.profileId, request.params.itemId) ? reply.code(204).send() : helpers.refused(reply, "not_found");
  });
}
