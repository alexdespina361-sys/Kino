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

export interface PartyLookup {
  partyOf(code: string): { host: string; party: string } | undefined;
  running(host: string, party: string, profileId: string): { code: string; expiresInMs: number } | undefined;
}

export interface FriendRouteHelpers {
  store: AccountStore;
  authenticate(request: FastifyRequest): { accountId: string } | undefined;
  signedOut(reply: FastifyReply): FastifyReply;
  tooMany(reply: FastifyReply, waitMs: number): FastifyReply;
  invalid(reply: FastifyReply, error: ZodError): FastifyReply;
  refused(reply: FastifyReply, error: StoreError): FastifyReply;
  parties?: PartyLookup;
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

const WORDS = ["title", "note", "description", "name"] as const;
const PICTURES = ["image", "backdrop"] as const;
function fitToShow<T extends object>(item: T, ownHost: string | undefined): T {
  const out = { ...item } as Record<string, unknown>;
  for (const key of WORDS) {
    if (typeof out[key] !== "string") continue;
    out[key] = plainText(out[key]) || (key === "name" || key === "title" ? "?" : "");
  }
  for (const key of PICTURES) {
    const picture = typeof out[key] === "string" ? foreignPicture(wellFormedText(out[key]), ownHost) : undefined;
    if (picture) out[key] = picture;
    else delete out[key];
  }
  if (typeof out.url === "string") out.url = wellFormedText(out.url);
  return out as T;
}

function percentOf(card: { position: number; duration: number; done?: boolean | undefined }): number | undefined {
  if (card.done) return 100;
  return card.duration > 0 ? Math.max(0, Math.min(100, Math.round((100 * card.position) / card.duration))) : undefined;
}

export function friendRoutes(app: FastifyInstance, helpers: FriendRouteHelpers): void {
  const { store, parties } = helpers;
  const book = store.friends;
  const presence = new Presence(() => store.clock());

  const readsByAccount = new RateLimiter(240, MINUTE);
  const sendsByAccount = new RateLimiter(60, 10 * MINUTE, undefined, "friends.sendsByAccount");
  const acceptsByAccount = new RateLimiter(60, 10 * MINUTE, undefined, "friends.acceptsByAccount");
  const invitesByAccount = new RateLimiter(20, 60 * MINUTE, undefined, "friends.invitesByAccount");
  const requestsByAccount = new RateLimiter(30, 60 * MINUTE, undefined, "friends.requestsByAccount");
  const wrongByAccount = new RateLimiter(10, 15 * MINUTE, undefined, "friends.wrongByAccount");
  const wrongByIp = new RateLimiter(100, 15 * MINUTE, undefined, "friends.wrongByIp");

  const refuse = (reply: FastifyReply, error: keyof typeof STATUS) => reply.code(STATUS[error]).send({ error });

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

  function friendView(profileId: string, friend: { id: string; since: number }): Friend | undefined {
    const card = store.profileCard(friend.id);
    if (!card) return undefined;
    const mine = friendChoices(store.settingsOf(profileId));
    const theirSettings = store.settingsOf(friend.id);
    const theirs = friendChoices(theirSettings);
    const shown = mine.friends && mine.friendsPresence && theirs.friends && theirs.friendsPresence;
    const online = shown && presence.online(friend.id);
    const lastOnline = shown ? store.seenAt(friend.id) : undefined;
    return {
      ...card,
      since: friend.since,
      on: theirs.friends,
      lists: sharesLists(theirSettings),
      ratings: sharesRatings(theirSettings),
      activity: tellsWhatTheyWatch(profileId, friend.id),
      inbox: theirs.friends && theirs.friendsInbox,
      ...(online ? { online: true } : {}),
      ...(lastOnline !== undefined ? { lastOnline } : {}),
    };
  }

  const byName = (a: { name: string; since: number }, b: { name: string; since: number }) => a.name.localeCompare(b.name) || a.since - b.since;

  function friendList(profileId: string): Friend[] {
    return book
      .friendsOf(profileId)
      .map((friend) => friendView(profileId, friend))
      .filter((friend): friend is Friend => friend !== undefined)
      .sort(byName);
  }

  function keptList(profileId: string): KeptFriend[] {
    return book
      .friendsOf(profileId)
      .flatMap((friend) => {
        const card = store.profileCard(friend.id);
        return card ? [{ id: card.id, name: card.name, avatar: card.avatar, since: friend.since }] : [];
      })
      .sort(byName);
  }

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

  function progressIn(friendId: string, urls: readonly string[]): FriendProgress[] {
    const wanted = new Set(urls.map((address) => titleLink(wellFormedText(address))));
    const newest = new Map<string, LiveProgress>();
    for (const card of store.items(friendId, "progress").filter(isLive)) {
      if (!card.done && card.position < ACTIVITY_MIN_SECONDS) continue;
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

  function tellsWhatTheyWatch(profileId: string, friendId: string): boolean {
    const theirs = friendChoices(store.settingsOf(friendId));
    return theirs.friends && theirs.friendsGive && friendChoices(store.settingsOf(profileId)).friendsGet;
  }

  function told({ host, party, ...item }: StoredItem, now: number, profileId: string): InboxItem {
    if (item.kind !== "party" || !parties) return item;
    const running = host !== undefined && party !== undefined ? parties.running(host, party, profileId) : undefined;
    return running ? { ...item, code: running.code, endsAt: now + running.expiresInMs, open: true } : { ...item, open: false };
  }

  function personOf(profileId: string): Person | undefined {
    const card = store.profileCard(profileId);
    return card && card.tag !== undefined ? { id: card.id, name: card.name, avatar: card.avatar, tag: card.tag } : undefined;
  }

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
    const waiting = store.chats.unread(profileId, friendChoices(store.settingsOf(profileId)).friendsPresence).filter((notice) => known.has(notice.friend));
    return {
      friends,
      inbox: book
        .inboxOf(profileId)
        .filter((item) => known.has(item.from))
        .map((item) => fitToShow(told(item, now, profileId), ownHost)),
      activity,
      invites: book.invitesOf(profileId).map(({ code, expiresAt }) => ({ code, expiresAt })),
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

  app.get<{ Params: { id: string } }>(base, async (request, reply) => {
    const me = asker(request, reply);
    if (!me) return reply;
    if (friendChoices(store.settingsOf(me.profileId)).friendsPresence) {
      presence.heartbeat(me.profileId);
      store.markSeen(me.profileId);
    } else {
      presence.forget(me.profileId);
      store.forgetSeen(me.profileId);
    }
    return reply.send(stateFor(me.profileId, request.headers.host));
  });

  app.post<{ Params: { id: string } }>("/api/profiles/:id/screen", async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    if (!helpers.screens) return helpers.refused(reply, "not_found");
    return reply.send({ proof: helpers.screens.issue(me.profileId) });
  });

  app.get<{ Params: { id: string } }>(`${base}/kept`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    const kept: KeptFriends = { friends: keptList(me.profileId) };
    return reply.send(kept);
  });

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
    const me = asker(request, reply, acceptsByAccount);
    if (!me) return reply;
    const wait = Math.max(wrongByAccount.wait(me.accountId), wrongByIp.wait(request.ip));
    if (wait > 0) return helpers.tooMany(reply, wait);
    const parsed = AcceptSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const code = normalise(parsed.data.code);
    const invite = book.peekInvite(code);
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

  const guessWait = (me: { accountId: string }, request: { ip: string }) => Math.max(wrongByAccount.wait(me.accountId), wrongByIp.wait(request.ip));
  const guessedWrong = (me: { accountId: string }, request: { ip: string }) => {
    wrongByAccount.hit(me.accountId);
    wrongByIp.hit(request.ip);
  };

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
    if (!store.profileCard(from) || !friendChoices(store.settingsOf(from)).friends) return refuse(reply, "request_gone");
    const accepted = book.acceptRequest(me.profileId, from);
    if (!accepted.ok) return refuse(reply, accepted.error);
    const friend = friendView(me.profileId, { id: from, since: accepted.value.since });
    return friend ? reply.code(201).send({ friend }) : refuse(reply, "request_gone");
  });

  app.delete<{ Params: { id: string; fid: string } }>(`${base}/requests/:fid`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    return book.declineRequest(me.profileId, request.params.fid) ? reply.code(204).send() : refuse(reply, "request_gone");
  });

  app.delete<{ Params: { id: string; fid: string } }>(`${base}/:fid`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount, true);
    if (!me) return reply;
    const was = book.unfriend(me.profileId, request.params.fid);
    store.chats.dropChat(me.profileId, request.params.fid);
    return was ? reply.code(204).send() : refuse(reply, "not_friends");
  });

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

  app.post<{ Params: { id: string } }>(`${base}/send`, async (request, reply) => {
    const me = asker(request, reply, sendsByAccount);
    if (!me) return reply;
    const parsed = SendSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const { to, ...message } = parsed.data;
    if (message.kind === "party" && parties) {
      const wait = guessWait(me, request);
      if (wait > 0) return helpers.tooMany(reply, wait);
    }
    const invited = message.kind === "party" ? parties?.partyOf(message.code) : undefined;
    if (message.kind === "party" && parties && invited === undefined) {
      guessedWrong(me, request);
      return refuse(reply, "party_closed");
    }
    const answer: Sent = { sent: [], declined: [] };
    for (const id of new Set(to)) {
      const theirs = friendChoices(store.settingsOf(id));
      if (!book.areFriends(me.profileId, id) || !theirs.friends || !theirs.friendsInbox) {
        answer.declined.push(id);
        continue;
      }
      if (message.kind === "plan") {
        const put = book.propose(id, me.profileId, message);
        if (!put.ok) return refuse(reply, put.error);
      } else book.deliver(id, me.profileId, message, invited);
      if (message.kind === "party") {
        book.answerTogether(me.profileId, id);
        book.settlePlans(me.profileId, id);
      }
      answer.sent.push(id);
    }
    return reply.send(answer);
  });

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
