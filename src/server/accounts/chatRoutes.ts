import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ChatMuteSchema, ChatReactSchema, ChatReportSchema, ChatSendSchema, friendChoices, isStickerId, StickerSendSchema, tagLabel, type ChatReportPreview, type ChatThread } from "../../shared";
import type { ChatBook, ChatError, ChatOutcome } from "./chat";
import type { FriendRouteHelpers } from "./friendRoutes";
import { RateLimiter } from "./rateLimit";
import { sendStickerPicture, stickerRefusal } from "./stickerRoutes";
import type { StickerBook } from "./stickers";

/** One end of a reported chat, as the team is told of them: the name as friends see it, with the tag that tells two of one name apart. */
export interface ChatSide {
  id: string;
  label: string;
}

/** What a report of a chat holds. The messages are the last ones of the chat as the reporter was shown them and agreed to send, oldest first. */
export interface ChatReport {
  reporter: ChatSide;
  about: ChatSide;
  /** The account that sends it: the team's side counts the reports each account has open (see `chatReporter`). It is not written into the report. */
  account: string;
  at: number;
  /** `sticker`: the line is a personal sticker (its words are `PERSONAL_STICKER_TEXT`): its name, which names its picture among `pictures`. */
  lines: Array<{ at: number; from: "reporter" | "about"; text: string; sticker?: string }>;
  /**
   * The pictures of the personal stickers among the lines (the newest few, each once), as they were when the report was sent: the team sees what was sent
   * even if its sender lets it go, or the team takes it down, before the report is read.
   */
  pictures?: Array<{ sticker: string; data: Buffer }>;
}

/** How many pictures of personal stickers a report carries (a report has room for eight files, and the chat's words are one). */
export const REPORT_STICKER_PICTURES = 7;
/** ...and how many bytes of them, all together: the newest that fit. (Seven moving ones could be 4 MB, of the room the team's side has for everything people send.) */
export const REPORT_STICKER_BYTES = 1_500_000;
/**
 * How many chat reports an account may send in a day. The reports an account has open are counted from what this run of the server took (feedback/chatReport.ts),
 * so a restart forgives them: this one is kept over a restart, and bounds what an account can put in the team's room whatever happens in between.
 */
export const CHAT_REPORTS_A_DAY = 6;
/**
 * Hands a report to the team (see `chatReporter` in feedback/chatReport.ts). Nothing was kept when it answers `"full"` (the team's side cannot take it now) or
 * `"too_many_open"` (the account has as many reports open as it may: the team has not dealt with them yet).
 */
export type ChatReporter = (report: ChatReport) => Promise<void | "full" | "too_many_open">;

export interface ChatRouteOptions {
  chat: ChatBook;
  /** Without it (a server with no feedback) a chat cannot be reported, and says so as any route that is not there does. */
  report?: ChatReporter;
  /** The personal stickers (stickers.ts): sent in a chat, shown in it to the two, saved from it. Without it, or while they are off, there are none. */
  stickers?: StickerBook;
}

const MINUTE = 60_000;
const STATUS: Record<ChatError | "changed", number> = {
  not_friends: 404,
  friends_off: 403,
  chat_off: 403,
  empty: 400,
  too_long: 400,
  not_a_picture: 400,
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
 *   GET    /chat?since=<rev>      the chat, and looking at it is having seen it; without `lines` when it is still at `rev`, and with `&reactions=1`
 *                                 only the reactions that changed when nothing else did (see `ChatBook.readSince`)
 *   POST   /chat                  write to the friend ({ text }): answers with the chat
 *   DELETE /chat/:id              take back a message of one's own: answers with the chat
 *   PUT    /chat/:id/reaction     put a reaction on a message, change it, or take it away ({ reaction }, null for none): answers with the chat
 *   PUT    /chat/mute             stop hearing of the friend's messages, or hear again ({ muted })
 *   GET    /chat/report           what a report would hold
 *   POST   /chat/report           send it to the team ({ rev }, the one the preview had)
 *   POST   /chat/sticker          send one of one's personal stickers ({ id }): answers with the chat
 *   GET    /chat/stickers/:sid    the picture of a personal sticker sent in this chat (to either of the two, while they are friends)
 *   POST   /chat/stickers/:sid/save   keep a personal sticker sent in this chat in one's own collection: answers with the collection
 */
export function chatRoutes(app: FastifyInstance, helpers: FriendRouteHelpers, options: ChatRouteOptions): void {
  const { store } = helpers;
  const { chat, report, stickers } = options;
  /** The personal stickers, while the host has them on. */
  const stickersOn = () => (stickers?.on ? stickers : undefined);

  // Looking is cheap and the page that is open asks every few seconds; writing is slowed per account on top of the book's twenty a minute per sender.
  const readsByAccount = new RateLimiter(120, MINUTE);
  const writesByAccount = new RateLimiter(120, MINUTE);
  const reportsByAccount = new RateLimiter(5, 60 * MINUTE, undefined, "chat.reportsByAccount");
  // (And the whole site's: a number of accounts cannot send reports faster than the team can read them. A form's own allowance is separate: see feedback/routes.ts.)
  const reportsEveryone = new RateLimiter(60, 60 * MINUTE, undefined, "chat.reportsEveryone");
  const reportsByAccountDay = new RateLimiter(CHAT_REPORTS_A_DAY, 24 * 60 * MINUTE, undefined, "chat.reportsByAccountDay");
  // (The pictures of a chat's personal stickers come many at once when it opens: they have their own allowance, and take nothing of the reads'.)
  const picturesByAccount = new RateLimiter(600, MINUTE);

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

  app.get<{ Params: { id: string; fid: string }; Querystring: { since?: string; reactions?: string } }>(base, async (request, reply) => {
    const me = asker(request, reply, readsByAccount);
    if (!me) return reply;
    const since = /^\d{1,16}$/.test(request.query.since ?? "") ? Number(request.query.since) : undefined;
    // (A page from before `reactions` knows nothing of them, and is sent every message when anything changed, as it always was.)
    const read = chat.readSince(me.profileId, me.friendId, since, request.query.reactions === "1");
    if (!read.ok) return fail(reply, read);
    // A page that has the chat open has seen what is in it.
    chat.markSeen(me.profileId, me.friendId);
    const answer: ChatThread = read.value;
    return reply.send(answer);
  });

  app.post<{ Params: { id: string; fid: string } }>(base, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const parsed = ChatSendSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const sent = chat.send(me.profileId, me.friendId, parsed.data.text, parsed.data.replyTo);
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

  app.put<{ Params: { id: string; fid: string; n: string } }>(`${base}/:n/reaction`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const id = /^\d{1,16}$/.test(request.params.n) ? Number(request.params.n) : undefined;
    if (id === undefined) return refuse(reply, "gone");
    const parsed = ChatReactSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const reacted = chat.react(me.profileId, me.friendId, id, parsed.data.reaction);
    return reacted.ok ? reply.send(reacted.value) : fail(reply, reacted);
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
    const wait = Math.max(reportsByAccount.wait(me.accountId), reportsByAccountDay.wait(me.accountId), reportsEveryone.wait("all"));
    if (wait > 0) return helpers.tooMany(reply, wait);
    const held = chat.lastLines(me.profileId, me.friendId);
    if (!held.ok) return fail(reply, held);
    if (held.value.rev !== parsed.data.rev) return refuse(reply, "changed");
    if (held.value.lines.length === 0) return refuse(reply, "gone");
    reportsByAccount.hit(me.accountId);
    reportsByAccountDay.hit(me.accountId);
    reportsEveryone.hit("all");
    // (The pictures of the personal stickers in it, the newest first and each once, as they are now: whether the stickers are on or not, they are what was sent.)
    const named = [...new Set(held.value.lines.map((line) => line.sticker).filter(isStickerId).reverse())].slice(0, REPORT_STICKER_PICTURES);
    const pictures: Array<{ sticker: string; data: Buffer }> = [];
    let bytes = 0;
    for (const sticker of named) {
      const data = await stickers?.picture(sticker).catch(() => undefined);
      // (One that does not fit is left out, and said to be: see chatTranscript.)
      if (!data || bytes + data.length > REPORT_STICKER_BYTES) continue;
      bytes += data.length;
      pictures.push({ sticker, data });
    }
    const sent = await report({
      reporter: sideOf(me.profileId),
      about: sideOf(me.friendId),
      account: me.accountId,
      at: store.clock(),
      lines: held.value.lines.map((line) => ({ at: line.at, from: line.mine ? "reporter" : "about", text: line.text, ...(isStickerId(line.sticker) ? { sticker: line.sticker } : {}) })),
      ...(pictures.length > 0 ? { pictures } : {}),
    });
    // (A report that was not kept is not one the account sent: its place in the hour's few comes back. The team's side is full of reports nobody has closed: that is
    // the site's to put right, so it is a 503 and not a 429. The account has as many open as it may: that is its own doing, so it is a 429, and waiting a few
    // minutes will not change it, so the page is told to try again later; both ways the page may try again later.)
    if (sent === "full" || sent === "too_many_open") {
      reportsByAccount.undo(me.accountId);
      reportsByAccountDay.undo(me.accountId);
      reportsEveryone.undo("all");
      return reply.header("Retry-After", 3600).code(sent === "full" ? 503 : 429).send({ error: sent });
    }
    return reply.code(204).send();
  });

  /* ------------------------------ personal stickers ------------------------------ */

  app.post<{ Params: { id: string; fid: string } }>(`${base}/sticker`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const book = stickersOn();
    if (!book) return stickerRefusal(reply, "off");
    const parsed = StickerSendSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    // (Only one of one's own: a name typed by hand, or one of somebody else's, is not a sticker one has.)
    if (!book.holds(me.profileId, parsed.data.id)) return refuse(reply, "gone");
    const sent = chat.sendSticker(me.profileId, me.friendId, parsed.data.id, parsed.data.replyTo);
    return sent.ok ? reply.code(201).send(sent.value) : fail(reply, sent);
  });

  app.get<{ Params: { id: string; fid: string; sid: string } }>(`${base}/stickers/:sid`, async (request, reply) => {
    // (The same allowance as the pictures of one's own collection: see `StickerBook.pictureReads`.)
    const me = asker(request, reply, stickers?.pictureReads ?? picturesByAccount);
    if (!me) return reply;
    const book = stickersOn();
    if (!book) return stickerRefusal(reply, "off");
    const { sid } = request.params;
    // (The same answer for a sticker that is not in this chat as for one there is no more: nobody learns of a picture that was not sent to them.)
    if (!isStickerId(sid) || !chat.hasSticker(me.profileId, me.friendId, sid)) return refuse(reply, "gone");
    const data = await book.picture(sid);
    return data ? sendStickerPicture(reply, data) : refuse(reply, "gone");
  });

  app.post<{ Params: { id: string; fid: string; sid: string } }>(`${base}/stickers/:sid/save`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const book = stickersOn();
    if (!book) return stickerRefusal(reply, "off");
    const { sid } = request.params;
    if (!isStickerId(sid) || !chat.hasSticker(me.profileId, me.friendId, sid)) return refuse(reply, "gone");
    const saved = book.save(me.profileId, sid);
    return saved.ok ? reply.send(book.of(me.profileId)) : stickerRefusal(reply, saved.error, saved.waitMs);
  });
}
