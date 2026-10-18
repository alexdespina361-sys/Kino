import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodError } from "zod";
import {
  ACTIVITY_KEEP_MS,
  ACTIVITY_MAX,
  ACTIVITY_MIN_SECONDS,
  ACTIVITY_PER_FRIEND,
  AcceptSchema,
  AskSchema,
  SendSchema,
  foreignPicture,
  friendChoices,
  isLive,
  parseTag,
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
  type InboxItem,
  type InviteView,
  type KeptFriend,
  type KeptFriends,
  type LiveProgress,
  type Person,
  type Sent,
  type TagView,
} from "../../shared";
import { normalise } from "./links";
import { Presence } from "./presence";
import { RateLimiter } from "./rateLimit";
import type { ScreenProofs } from "./screens";
import type { FriendError, StoredItem } from "./friends";
import type { StoreError, AccountStore } from "./store";

/** The watch parties, as far as the friends need to know of them (the sessions keep them: see Registry). Screens are named by the id the lists give them. */
export interface PartyLookup {
  /** The screen whose party this code is open with now. */
  hostOf(code: string): string | undefined;
  /** The code the party of a screen is joined with now and how long that stays good: a party with guests whose code ran out is given a new one. Nothing when the party is over. */
  running(host: string): { code: string; expiresInMs: number } | undefined;
}

/** What the routes of the accounts hand over for these to do their part in the same way. */
export interface FriendRouteHelpers {
  store: AccountStore;
  authenticate(request: FastifyRequest): { accountId: string } | undefined;
  signedOut(reply: FastifyReply): FastifyReply;
  tooMany(reply: FastifyReply, waitMs: number): FastifyReply;
  invalid(reply: FastifyReply, error: ZodError): FastifyReply;
  refused(reply: FastifyReply, error: StoreError): FastifyReply;
  /** Without it (the accounts on their own) an invitation is believed: any code, for as long as it says. */
  parties?: PartyLookup;
  /** The proofs a screen gives to a watch party to say whose it is (without them a screen cannot be known as a profile). */
  screens?: ScreenProofs;
}

const MINUTE = 60_000;
const STATUS: Record<FriendError | "friends_off" | "not_shared" | "not_friends" | "party_closed" | "tag_gone", number> = {
  invite_gone: 404,
  own_invite: 409,
  already_friends: 409,
  friends_full: 409,
  own_request: 409,
  request_gone: 404,
  tag_gone: 404,
  friends_off: 403,
  not_shared: 403,
  not_friends: 404,
  party_closed: 409,
  plan_soon: 400,
  plan_far: 400,
  plan_full: 409,
  plan_gone: 404,
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
  const { store, parties } = helpers;
  const book = store.friends;
  const presence = new Presence(() => store.clock());

  // Looking is cheap and happens every half minute on each screen; making things and guessing codes is slowed down.
  const readsByAccount = new RateLimiter(240, MINUTE);
  const sendsByAccount = new RateLimiter(60, 10 * MINUTE);
  const acceptsByAccount = new RateLimiter(60, 10 * MINUTE);
  const invitesByAccount = new RateLimiter(20, 60 * MINUTE);
  const requestsByAccount = new RateLimiter(30, 60 * MINUTE);
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
        return card ? [{ id: card.id, name: card.name, avatar: card.avatar, since: friend.since }] : [];
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
      if (!card.done && card.position < ACTIVITY_MIN_SECONDS) continue; // (a few seconds and away again is not getting anywhere)
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

  /**
   * A thing in the inbox as the one it is for is told of it. An invitation says what its party is now: the code it can be joined with
   * (renewed since it was sent, if the host's screen has moved on) and for how long, or that the party is over. Which screen hosts it is
   * for the server alone.
   */
  function told(stored: StoredItem, now: number): InboxItem {
    const item = { ...stored };
    delete item.host;
    if (item.kind !== "party" || !parties) return item;
    const host = stored.host ?? parties.hostOf(item.code);
    const running = host === undefined ? undefined : parties.running(host);
    return running ? { ...item, code: running.code, endsAt: now + running.expiresInMs, open: true } : { ...item, open: false };
  }

  /** A profile as somebody who is not a friend is shown it: with the tag that names it. Nothing for one that is gone. */
  function personOf(profileId: string): Person | undefined {
    const card = store.profileCard(profileId);
    return card && card.tag !== undefined ? { id: card.id, name: card.name, avatar: card.avatar, tag: card.tag } : undefined;
  }

  /** The profile a tag names, when it can be asked: a profile that has turned friends off is not found by anybody, so it cannot be asked. */
  function findable(text: string): Person | undefined {
    const wanted = parseTag(text);
    const id = wanted && store.profileByTag(wanted.name, wanted.tag);
    return id && friendChoices(store.settingsOf(id)).friends ? personOf(id) : undefined;
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
    // (What waits in the chats rides with the rest, a friend at a time: the messages themselves are only asked for by a page that has the chat open.)
    const waiting = store.chats.unread(profileId).filter((notice) => known.has(notice.friend));
    return {
      friends,
      inbox: book
        .inboxOf(profileId)
        .filter((item) => known.has(item.from))
        .map((item) => fitToShow(told(item, now), ownHost)),
      activity,
      invites: book.invitesOf(profileId).map(({ code, expiresAt }) => ({ code, expiresAt })),
      // (Somebody who has turned friends off since asking is not shown: they cannot be answered.)
      requests: book.requestsTo(profileId).flatMap(({ from, at }) => {
        const person = friendChoices(store.settingsOf(from)).friends ? personOf(from) : undefined;
        return person ? [{ from: person, at }] : [];
      }),
      sent: book.requestsBy(profileId).flatMap(({ to, at }) => {
        const person = personOf(to);
        return person ? [{ to: person, at }] : [];
      }),
      ...(waiting.length > 0 ? { chat: waiting } : {}),
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

  /** A screen signed in as this profile asks for the proof it gives a watch party, to be known there as the profile (see TV_PROFILE). Friends need not be on: whether it is shown is for the party to say. */
  app.post<{ Params: { id: string } }>("/api/profiles/:id/screen", async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    if (!helpers.screens) return helpers.refused(reply, "not_found");
    return reply.send({ proof: helpers.screens.issue(me.profileId) });
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

  /* ------------------------------ asking by tag ------------------------------ */

  /** Whether a profile may look for tags: a few wrong ones in a row, from one account or one address, and it waits (a tag is short, so guessing has to be slow). */
  const guessWait = (me: { accountId: string }, request: { ip: string }) => Math.max(wrongByAccount.wait(me.accountId), wrongByIp.wait(request.ip));
  const guessedWrong = (me: { accountId: string }, request: { ip: string }) => {
    wrongByAccount.hit(me.accountId);
    wrongByIp.hit(request.ip);
  };

  /** Who has this tag, so a screen can say "ask Sam#2?" before it does. One nobody has counts as a wrong guess (as a wrong code does). */
  app.get<{ Params: { id: string; tag: string } }>(`${base}/tags/:tag`, async (request, reply) => {
    const me = asker(request, reply);
    if (!me) return reply;
    const wait = guessWait(me, request);
    if (wait > 0) return helpers.tooMany(reply, wait);
    const found = findable(request.params.tag);
    if (!found) {
      guessedWrong(me, request);
      return refuse(reply, "tag_gone");
    }
    if (found.id === me.profileId) return refuse(reply, "own_request");
    if (book.areFriends(me.profileId, found.id)) return refuse(reply, "already_friends");
    const view: TagView = { name: found.name, avatar: found.avatar, tag: found.tag };
    return reply.send(view);
  });

  /** Ask the profile with this tag to be friends. Nobody is added to anybody by this: it waits for a yes (unless they had asked first, which is that yes). */
  app.post<{ Params: { id: string } }>(`${base}/requests`, async (request, reply) => {
    const me = asker(request, reply, requestsByAccount);
    if (!me) return reply;
    const wait = guessWait(me, request);
    if (wait > 0) return helpers.tooMany(reply, wait);
    const parsed = AskSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const found = findable(parsed.data.tag);
    if (!found) {
      guessedWrong(me, request);
      return refuse(reply, "tag_gone");
    }
    const asked = book.request(me.profileId, found.id);
    if (!asked.ok) return refuse(reply, asked.error);
    if (!asked.value.friends) return reply.code(201).send({ status: "sent" });
    const friend = friendView(me.profileId, { id: found.id, since: asked.value.at });
    return friend ? reply.code(201).send({ status: "friends", friend }) : refuse(reply, "tag_gone");
  });

  app.post<{ Params: { id: string; fid: string } }>(`${base}/requests/:fid/accept`, async (request, reply) => {
    const me = asker(request, reply, acceptsByAccount);
    if (!me) return reply;
    const from = request.params.fid;
    // A request from somebody who is gone, or has turned friends off since, is as good as none.
    if (!store.profileCard(from) || !friendChoices(store.settingsOf(from)).friends) return refuse(reply, "request_gone");
    const accepted = book.acceptRequest(me.profileId, from);
    if (!accepted.ok) return refuse(reply, accepted.error);
    const friend = friendView(me.profileId, { id: from, since: accepted.value.since });
    return friend ? reply.code(201).send({ friend }) : refuse(reply, "request_gone");
  });

  /** Turn a request down (the one who asked is not told). Needs no more than that the profile is one's own, as taking a friend off does. */
  app.delete<{ Params: { id: string; fid: string } }>(`${base}/requests/:fid`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    return book.declineRequest(me.profileId, request.params.fid) ? reply.code(204).send() : refuse(reply, "request_gone");
  });

  app.delete<{ Params: { id: string; fid: string } }>(`${base}/:fid`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    const was = book.unfriend(me.profileId, request.params.fid);
    store.chats.dropChat(me.profileId, request.params.fid); // (what they wrote to each other goes with the friendship)
    return was ? reply.code(204).send() : refuse(reply, "not_friends");
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
    // An invitation is to a party that is open now, and keeps the screen that hosts it: the code is renewed, the screen is what the invitation goes by.
    const host = message.kind === "party" ? parties?.hostOf(message.code) : undefined;
    if (message.kind === "party" && parties && host === undefined) return refuse(reply, "party_closed");
    const answer: Sent = { sent: [], declined: [] };
    for (const id of new Set(to)) {
      const theirs = friendChoices(store.settingsOf(id));
      // (Somebody who is not a friend is told apart from nobody no more than a friend who is not taking things. Asking to watch together is an invitation
      // in the making, so it goes to any friend who takes invitations: telling what they watch is another choice, off until it is made.)
      if (!book.areFriends(me.profileId, id) || !theirs.friends || !theirs.friendsInbox) {
        answer.declined.push(id);
        continue;
      }
      if (message.kind === "plan") {
        // (The time and the limits are the server's to hold to, whatever a screen let through. A plan goes to one friend, so nothing is half sent.)
        const put = book.propose(id, me.profileId, message);
        if (!put.ok) return refuse(reply, put.error);
      } else book.deliver(id, me.profileId, message, host);
      // (An invitation answers a request for a party that came the other way, and is the party of a plan whose time has come.)
      if (message.kind === "party") {
        book.answerTogether(me.profileId, id);
        book.settlePlans(me.profileId, id);
      }
      answer.sent.push(id);
    }
    return reply.send(answer);
  });

  /**
   * Say yes or no to a plan a friend put (an item of the inbox). Yes keeps it as a plan that is on, in both inboxes; no takes it away; the friend is
   * told which in their bell. A yes the friend could not be told of (they take nothing now) is refused, so the two never hold different plans.
   */
  for (const [path, answer] of [["accept", "yes"], ["decline", "no"]] as const) {
    app.post<{ Params: { id: string; itemId: string } }>(`${base}/plans/:itemId/${path}`, async (request, reply) => {
      const me = asker(request, reply, acceptsByAccount);
      if (!me) return reply;
      const plan = book.openPlan(me.profileId, request.params.itemId);
      if (!plan) return refuse(reply, "plan_gone");
      const theirs = friendChoices(store.settingsOf(plan.from));
      const takes = book.areFriends(me.profileId, plan.from) && theirs.friends && theirs.friendsInbox;
      if (answer === "yes" && !takes) return refuse(reply, "plan_gone");
      book.answerPlan(me.profileId, plan, answer, takes);
      return reply.code(204).send();
    });
  }

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
