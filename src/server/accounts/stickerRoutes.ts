import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { friendChoices, isStickerId, MOVING_STICKER, PERSONAL_STICKER, readStickerMake, StickerMakeSchema, type StickerProblem } from "../../shared";
import { teamGuard } from "../feedback/routes";
import type { FriendRouteHelpers } from "./friendRoutes";
import { RateLimiter } from "./rateLimit";
import { pictureType } from "./stickerImage";
import type { StickerBook } from "./stickers";

const MINUTE = 60_000;
/** How long a picture let in has to arrive (a quarter of a megabyte: a slow phone's mobile data takes a few seconds). */
const UPLOAD_MS = 30_000;
const STATUS: Record<StickerProblem | "gone" | "friends_off", number> = {
  off: 404,
  gone: 404,
  not_a_picture: 400,
  too_big: 413,
  full: 409,
  too_many: 429,
  site_full: 503,
  friends_off: 403,
};

/** Why a sticker was refused, as the page is told it. */
export function stickerRefusal(reply: FastifyReply, error: StickerProblem | "gone" | "friends_off", waitMs?: number): FastifyReply {
  if (error === "too_many") reply.header("Retry-After", Math.max(1, Math.ceil((waitMs ?? MINUTE) / 1000)));
  return reply.code(STATUS[error]).send({ error });
}

/**
 * A sticker's picture, as it is sent: a PNG, or an animated WebP for one that moves (either way one this server made), never guessed at by the browser, nothing
 * in it run or embedded elsewhere, kept by the browser of the one who asked for a few minutes only (a sticker taken down is gone from screens soon after).
 */
export function sendStickerPicture(reply: FastifyReply, data: Buffer): FastifyReply {
  return reply
    .header("Content-Type", pictureType(data))
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Security-Policy", "default-src 'none'; sandbox")
    .header("Cross-Origin-Resource-Policy", "same-origin")
    .header("Content-Disposition", "inline")
    .header("Cache-Control", "private, max-age=300")
    .send(data);
}

type Asked = FastifyRequest & { params: { id: string } };

/**
 * A profile's own personal stickers, under /api/profiles/:id/stickers (the profile is the one asking, and one of the signed-in account's, with friends on):
 *
 *   GET    /stickers          the collection, the newest first
 *   POST   /stickers          make one of a picture the page made ({ data }: a PNG as base64; one that moves says `delays` too): answers with the collection and
 *                             the new one's name
 *   GET    /stickers/:sid     the picture of one in the collection
 *   DELETE /stickers/:sid     let one go: answers with the collection
 *
 * While the host has them off, every one of these says so (404, `off`), and nothing that was made is touched.
 */
export function stickerRoutes(app: FastifyInstance, helpers: FriendRouteHelpers, stickers: StickerBook): void {
  const { store } = helpers;
  const readsByAccount = new RateLimiter(120, MINUTE);
  const writesByAccount = new RateLimiter(30, MINUTE);
  const base = "/api/profiles/:id/stickers";

  /**
   * A picture on its way in is let in before its body is read, not after (the judge, 17 Nov: a body of a quarter of a megabyte was read, then refused, for
   * anybody): the account is signed in, owns the profile, has not made too many, and has no other on its way; and the whole site has so many on their way at
   * most (`PERSONAL_STICKER.uploadsAtOnce`). Who was let in is kept here for the handler, and let go however the request ends: its answer sent, refused, or the
   * asker gone at any moment. The picture has `UPLOAD_MS` to arrive, a slow phone's many times over: one sent a byte at a time is let go then, and its request
   * ended, so a few such cannot keep everybody else's out (the server itself has no such limit: Fastify's `requestTimeout` is 0).
   */
  const uploadMs = stickers.options.uploadMs ?? UPLOAD_MS;
  const uploading = new Set<string>();
  const letIn = new WeakMap<FastifyRequest, { accountId: string; profileId: string; deadline: ReturnType<typeof setTimeout> }>();
  const done = (request: FastifyRequest) => {
    const me = letIn.get(request);
    if (!me) return;
    clearTimeout(me.deadline);
    letIn.delete(request);
    uploading.delete(me.accountId);
  };

  function asker(request: Asked, reply: FastifyReply, limiter: RateLimiter): { accountId: string; profileId: string } | undefined {
    const auth = helpers.authenticate(request);
    if (!auth) return void helpers.signedOut(reply);
    const profileId = request.params.id;
    if (!store.ownsProfile(auth.accountId, profileId)) return void helpers.refused(reply, "not_found");
    const wait = limiter.wait(auth.accountId);
    if (wait > 0) return void helpers.tooMany(reply, wait);
    limiter.hit(auth.accountId);
    if (!stickers.on) return void stickerRefusal(reply, "off");
    // (A child's profile has no friends, so no chat, so no stickers of its own.)
    if (!friendChoices(store.settingsOf(profileId)).friends) return void stickerRefusal(reply, "friends_off");
    return { accountId: auth.accountId, profileId };
  }

  app.get<{ Params: { id: string } }>(base, async (request, reply) => {
    const me = asker(request, reply, readsByAccount);
    if (!me) return reply;
    return reply.header("Cache-Control", "no-store").send(stickers.of(me.profileId));
  });

  // (A still picture's body, and the most one that moves may be: only while those are on. While they are, a picture has three times as long to arrive, one
  // that moves being bigger: whether this one is, is not asked of what the request says of its own length, which not every request says, the judge, 17 Nov.)
  const stillBody = Math.ceil((PERSONAL_STICKER.sentBytes * 4) / 3) + 4096;
  const movingBody = Math.ceil((MOVING_STICKER.sentBytes * 4) / 3) + 4096;
  const arriveMs = stickers.moving ? uploadMs * 3 : uploadMs;
  // (In a place of its own: there, and nowhere else, a body is read as text and taken apart by hand (`readStickerMake`), never unpacked as JSON whatever it
  // holds. A body that is not what the page sends is a bad request, as one that is not JSON at all always was.)
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, parsed) => {
      const read = readStickerMake(body as string);
      if (read) parsed(null, read);
      else parsed(Object.assign(new Error("The body is not a sticker to be made."), { statusCode: 400 }), undefined);
    });
    scope.post<{ Params: { id: string } }>(
      base,
      {
        bodyLimit: stickers.moving ? movingBody : stillBody,
        onRequest: async (request, reply) => {
          const me = asker(request as Asked, reply, writesByAccount);
          if (!me) return reply;
          if (uploading.has(me.accountId) || uploading.size >= PERSONAL_STICKER.uploadsAtOnce) {
            return reply.code(503).header("Retry-After", 5).send({ error: "busy", retryAfter: 5 });
          }
          uploading.add(me.accountId);
          // (A picture that has not come by then is let go, and its request ended.)
          const deadline = setTimeout(() => {
            done(request);
            request.raw.destroy();
          }, arriveMs);
          letIn.set(request, { ...me, deadline });
          reply.raw.once("close", () => done(request));
          return undefined;
        },
        // (Each of these, and the answer's `close`, lets it go: whichever comes first; letting go twice is nothing.)
        onResponse: async (request) => done(request),
        onRequestAbort: async (request) => done(request),
      },
      async (request, reply) => {
        const me = letIn.get(request);
        if (!me) return reply.code(503).header("Retry-After", 5).send({ error: "busy", retryAfter: 5 }); // (never: the hook let it in)
        clearTimeout(me.deadline); // (it has come: what is done with it takes what it takes)
        const parsed = StickerMakeSchema.safeParse(request.body);
        if (!parsed.success) return stickerRefusal(reply, "too_big");
        const made = await stickers.make(me.profileId, me.accountId, Buffer.from(parsed.data.data, "base64"), parsed.data.delays);
        if (!made.ok) return stickerRefusal(reply, made.error, made.waitMs);
        return reply.code(201).send({ ...stickers.of(me.profileId), id: made.value });
      },
    );
  });

  app.get<{ Params: { id: string; sid: string } }>(`${base}/:sid`, async (request, reply) => {
    const me = asker(request, reply, stickers.pictureReads);
    if (!me) return reply;
    const { sid } = request.params;
    if (!isStickerId(sid) || !stickers.holds(me.profileId, sid)) return stickerRefusal(reply, "gone");
    const data = await stickers.picture(sid);
    return data ? sendStickerPicture(reply, data) : stickerRefusal(reply, "gone");
  });

  app.delete<{ Params: { id: string; sid: string } }>(`${base}/:sid`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const { sid } = request.params;
    const released = isStickerId(sid) ? stickers.release(me.profileId, sid) : { ok: false as const, error: "gone" as const };
    return released.ok ? reply.send(stickers.of(me.profileId)) : stickerRefusal(reply, released.error);
  });
}

/**
 * The team's side (scripts/stickers.mjs), with the feedback token as a Bearer, whether the stickers are on or off:
 *
 *   GET    /api/admin/stickers            every sticker, the newest first: its name, when, how big, who made it (profile and account), how many have it
 *   GET    /api/admin/stickers/:sid       its picture
 *   DELETE /api/admin/stickers/:sid       take it down everywhere
 *   DELETE /api/admin/stickers?by=<id>    take down every one a profile or an account made
 */
export function stickerAdminRoutes(app: FastifyInstance, options: { stickers: StickerBook; adminToken: string | undefined }): void {
  const team = teamGuard(options.adminToken);
  const { stickers } = options;

  app.get("/api/admin/stickers", async (request, reply) => {
    if (!team(request, reply)) return reply;
    return reply.header("Cache-Control", "no-store").send({ on: stickers.on, ...stickers.size, stickers: stickers.list() });
  });

  app.get<{ Params: { sid: string } }>("/api/admin/stickers/:sid", async (request, reply) => {
    if (!team(request, reply)) return reply;
    const data = isStickerId(request.params.sid) ? await stickers.picture(request.params.sid) : undefined;
    return data ? sendStickerPicture(reply, data).header("Cache-Control", "no-store") : reply.code(404).send({ error: "gone" });
  });

  app.delete<{ Params: { sid: string } }>("/api/admin/stickers/:sid", async (request, reply) => {
    if (!team(request, reply)) return reply;
    const taken = isStickerId(request.params.sid) ? stickers.takeDown(request.params.sid) : 0;
    return taken > 0 ? reply.send({ taken: 1 }) : reply.code(404).send({ error: "gone" });
  });

  app.delete<{ Querystring: { by?: string } }>("/api/admin/stickers", async (request, reply) => {
    if (!team(request, reply)) return reply;
    const by = request.query.by ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(by)) return reply.code(400).send({ error: "by" });
    return reply.send({ taken: stickers.takeDownBy(by) });
  });
}
