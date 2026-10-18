import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { friendChoices, tagLabel } from "../../shared";
import { ChatMuteSchema, ChatReportSchema, ChatSendSchema, type ChatReportPreview, type ChatThread } from "../../shared/chat";
import type { ChatBook, ChatError, ChatOutcome } from "./chat";
import type { FriendRouteHelpers } from "./friendRoutes";
import { RateLimiter } from "./rateLimit";

/** One end of a reported chat, as the team is told of them: the name as friends see it, with the tag that tells two of one name apart. */
export interface ChatSide {
  id: string;
  label: string;
}

/** What a report of a chat holds. The messages are the last ones of the chat as the reporter was shown them and agreed to send, oldest first. */
export interface ChatReport {
  reporter: ChatSide;
  about: ChatSide;
  at: number;
  lines: Array<{ at: number; from: "reporter" | "about"; text: string }>;
}
/** Hands a report to the team (see `chatReporter` in feedback/chatReport.ts). */
export type ChatReporter = (report: ChatReport) => Promise<void>;

export interface ChatRouteOptions {
  chat: ChatBook;
  /** Without it (a server with no feedback) a chat cannot be reported, and says so as any route that is not there does. */
  report?: ChatReporter;
}

const MINUTE = 60_000;
const STATUS: Record<ChatError | "changed", number> = {
  not_friends: 404,
  friends_off: 403,
  chat_off: 403,
  empty: 400,
  too_long: 400,
  rate_limited: 429,
  gone: 404,
  changed: 409,
};

type Asked = FastifyRequest & { params: { id: string; fid: string } };

/**
 * A chat between two friends, under /api/profiles/:id/friends/:fid/chat: the profile in the address is the one asking, and has to be one of
 * the signed-in account's, with friends turned on; the friend has to be one of its friends. The rules of what may be written are the book's
 * (see chat.ts): these only say who is asking and what became of it.
 *
 *   GET    /chat?since=<rev>      the chat, and looking at it is having seen it; without `lines` when it is still at `rev`
 *   POST   /chat                  write to the friend ({ text }): answers with the chat
 *   DELETE /chat/:id              take back a message of one's own: answers with the chat
 *   PUT    /chat/mute             stop hearing of the friend's messages, or hear again ({ muted })
 *   GET    /chat/report           what a report would hold
 *   POST   /chat/report           send it to the team ({ rev }, the one the preview had)
 */
export function chatRoutes(app: FastifyInstance, helpers: FriendRouteHelpers, options: ChatRouteOptions): void {
  const { store } = helpers;
  const { chat, report } = options;

  // Looking is cheap and the page that is open asks every few seconds; writing is slowed per account on top of the book's twenty a minute per sender.
  const readsByAccount = new RateLimiter(120, MINUTE);
  const writesByAccount = new RateLimiter(120, MINUTE);
  const reportsByAccount = new RateLimiter(5, 60 * MINUTE);

  const base = "/api/profiles/:id/friends/:fid/chat";

  /** The profile asking and the friend it asks about, or the answer that tells why not. */
  function asker(request: Asked, reply: FastifyReply, limiter: RateLimiter): { accountId: string; profileId: string; friendId: string } | undefined {
    const auth = helpers.authenticate(request);
    if (!auth) return void helpers.signedOut(reply);
    const profileId = request.params.id;
    if (!store.ownsProfile(auth.accountId, profileId)) return void helpers.refused(reply, "not_found");
    const wait = limiter.wait(auth.accountId);
    if (wait > 0) return void helpers.tooMany(reply, wait);
    limiter.hit(auth.accountId);
    if (!friendChoices(store.settingsOf(profileId)).friends) return void reply.code(STATUS.friends_off).send({ error: "friends_off" });
    return { accountId: auth.accountId, profileId, friendId: request.params.fid };
  }

  const refuse = (reply: FastifyReply, error: ChatError | "changed", waitMs?: number) =>
    error === "rate_limited" ? helpers.tooMany(reply, waitMs ?? MINUTE) : reply.code(STATUS[error]).send({ error });
  const fail = (reply: FastifyReply, outcome: Extract<ChatOutcome<unknown>, { ok: false }>) => refuse(reply, outcome.error, outcome.waitMs);

  app.get<{ Params: { id: string; fid: string }; Querystring: { since?: string } }>(base, async (request, reply) => {
    const me = asker(request, reply, readsByAccount);
    if (!me) return reply;
    const read = chat.read(me.profileId, me.friendId);
    if (!read.ok) return fail(reply, read);
    // A page that has the chat open has seen what is in it.
    chat.markSeen(me.profileId, me.friendId);
    const { lines, ...state } = read.value;
    const since = /^\d{1,16}$/.test(request.query.since ?? "") ? Number(request.query.since) : undefined;
    const answer: ChatThread = since === state.rev ? state : { ...state, lines };
    return reply.send(answer);
  });

  app.post<{ Params: { id: string; fid: string } }>(base, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const parsed = ChatSendSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const sent = chat.send(me.profileId, me.friendId, parsed.data.text);
    return sent.ok ? reply.code(201).send(sent.value) : fail(reply, sent);
  });

  app.delete<{ Params: { id: string; fid: string; n: string } }>(`${base}/:n`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const id = /^\d{1,16}$/.test(request.params.n) ? Number(request.params.n) : undefined;
    if (id === undefined) return refuse(reply, "gone");
    const taken = chat.takeBack(me.profileId, me.friendId, id);
    return taken.ok ? reply.send(taken.value) : fail(reply, taken);
  });

  app.put<{ Params: { id: string; fid: string } }>(`${base}/mute`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const parsed = ChatMuteSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const muted = chat.mute(me.profileId, me.friendId, parsed.data.muted);
    return muted.ok ? reply.send({ muted: muted.value }) : fail(reply, muted);
  });

  /* ------------------------------ telling the team ------------------------------ */

  /** A profile as the team is told of it: the name as friends see it, and the tag. */
  const sideOf = (profileId: string): ChatSide => {
    const card = store.profileCard(profileId);
    return { id: profileId, label: card ? (card.tag !== undefined ? tagLabel(card.name, card.tag) : card.name) : profileId };
  };

  app.get<{ Params: { id: string; fid: string } }>(`${base}/report`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount);
    if (!me) return reply;
    if (!report) return helpers.refused(reply, "not_found");
    const held = chat.lastLines(me.profileId, me.friendId);
    if (!held.ok) return fail(reply, held);
    const preview: ChatReportPreview = held.value;
    return reply.send(preview);
  });

  /**
   * The last messages of the chat, to the team, once the one who reports has seen them and said yes (the `rev` of the preview they were shown).
   * A chat that has changed since is not sent: the page shows it again. The one reported is not told, and nothing else happens to the chat.
   */
  app.post<{ Params: { id: string; fid: string } }>(`${base}/report`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    if (!report) return helpers.refused(reply, "not_found");
    const parsed = ChatReportSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const wait = reportsByAccount.wait(me.accountId);
    if (wait > 0) return helpers.tooMany(reply, wait);
    const held = chat.lastLines(me.profileId, me.friendId);
    if (!held.ok) return fail(reply, held);
    if (held.value.rev !== parsed.data.rev) return refuse(reply, "changed");
    if (held.value.lines.length === 0) return refuse(reply, "gone");
    reportsByAccount.hit(me.accountId);
    await report({
      reporter: sideOf(me.profileId),
      about: sideOf(me.friendId),
      at: store.clock(),
      lines: held.value.lines.map((line) => ({ at: line.at, from: line.mine ? "reporter" : "about", text: line.text })),
    });
    return reply.code(204).send();
  });
}
