import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { friendChoices, isStickerId, MOVING_STICKER, PERSONAL_STICKER, readStickerMake, StickerMakeSchema, type StickerProblem } from "../../shared";
import { teamGuard } from "../feedback/routes";
import type { FriendRouteHelpers } from "./friendRoutes";
import { RateLimiter } from "./rateLimit";
import { pictureType } from "./stickerImage";
import type { StickerBook } from "./stickers";

const MINUTE = 60_000;
const UPLOAD_MS = 30_000;
const BODY_MS_PER_MB = 2;
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

export function stickerRefusal(reply: FastifyReply, error: StickerProblem | "gone" | "friends_off", waitMs?: number): FastifyReply {
  if (error === "too_many") reply.header("Retry-After", Math.max(1, Math.ceil((waitMs ?? MINUTE) / 1000)));
  return reply.code(STATUS[error]).send({ error });
}

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

export function stickerRoutes(app: FastifyInstance, helpers: FriendRouteHelpers, stickers: StickerBook): void {
  const { store } = helpers;
  const readsByAccount = new RateLimiter(120, MINUTE);
  const writesByAccount = new RateLimiter(30, MINUTE);
  const base = "/api/profiles/:id/stickers";

  const uploadMs = stickers.options.uploadMs ?? UPLOAD_MS;
  const uploading = new Set<string>();
  const letIn = new WeakMap<FastifyRequest, { accountId: string; profileId: string; deadline: ReturnType<typeof setTimeout>; making?: boolean }>();
  const done = (request: FastifyRequest) => {
    const me = letIn.get(request);
    if (!me || me.making) return;
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
    if (!friendChoices(store.settingsOf(profileId)).friends) return void stickerRefusal(reply, "friends_off");
    return { accountId: auth.accountId, profileId };
  }

  app.get<{ Params: { id: string } }>(base, async (request, reply) => {
    const me = asker(request, reply, readsByAccount);
    if (!me) return reply;
    return reply.header("Cache-Control", "no-store").send(stickers.of(me.profileId));
  });

  const stillBody = Math.ceil((PERSONAL_STICKER.sentBytes * 4) / 3) + 4096;
  const movingBody = Math.ceil((MOVING_STICKER.sentBytes * 4) / 3) + 4096;
  const arriveMs = stickers.moving ? uploadMs * 3 : uploadMs;
  const bodyLimit = stickers.moving ? movingBody : stillBody;
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, parsed) => {
      const began = performance.now();
      const read = readStickerMake(body as string);
      stickers.worked(performance.now() - began);
      if (read) parsed(null, read);
      else parsed(Object.assign(new Error("The body is not a sticker to be made."), { statusCode: 400 }), undefined);
    });
    scope.post<{ Params: { id: string } }>(
      base,
      {
        bodyLimit,
        onRequest: async (request, reply) => {
          const me = asker(request as Asked, reply, writesByAccount);
          if (!me) return reply;
          if (uploading.has(me.accountId) || uploading.size >= PERSONAL_STICKER.uploadsAtOnce) {
            return reply.code(503).header("Retry-After", 5).send({ error: "busy", retryAfter: 5 });
          }
          const wait = stickers.arriving();
          if (wait > 0) {
            const after = Math.min(3600, Math.max(5, Math.ceil(wait / 1000)));
            return reply.code(503).header("Retry-After", after).send({ error: "busy", retryAfter: after });
          }
          stickers.worked((bodyLimit / 1_000_000) * BODY_MS_PER_MB);
          uploading.add(me.accountId);
          const deadline = setTimeout(() => {
            done(request);
            request.raw.destroy();
          }, arriveMs);
          letIn.set(request, { ...me, deadline });
          reply.raw.once("close", () => done(request));
          return undefined;
        },
        onResponse: async (request) => done(request),
        onRequestAbort: async (request) => done(request),
      },
      async (request, reply) => {
        const me = letIn.get(request);
        if (!me) return reply.code(503).header("Retry-After", 5).send({ error: "busy", retryAfter: 5 });
        clearTimeout(me.deadline);
        const began = performance.now();
        const parsed = StickerMakeSchema.safeParse(request.body);
        const sent = parsed.success ? Buffer.from(parsed.data.data, "base64") : undefined;
        stickers.worked(performance.now() - began);
        if (!parsed.success || !sent) return stickerRefusal(reply, "too_big");
        me.making = true;
        let made: Awaited<ReturnType<StickerBook["make"]>>;
        try {
          made = await stickers.make(me.profileId, me.accountId, sent, parsed.data.delays);
        } finally {
          me.making = false;
          done(request);
        }
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

export function stickerAdminRoutes(app: FastifyInstance, options: { stickers: StickerBook; adminToken: string | undefined }): void {
  const team = teamGuard(options.adminToken, "team.stickers");
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
