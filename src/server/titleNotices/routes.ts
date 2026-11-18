import type { FastifyInstance } from "fastify";
import { TitleNoticeDismissSchema, TitleNoticeSeenSchema } from "../../shared";
import type { FriendRouteHelpers } from "../accounts/friendRoutes";
import { RateLimiter } from "../accounts/rateLimit";
import type { TitleNoticeBook } from "./book";

const MINUTE = 60_000;

export function titleNoticeRoutes(app: FastifyInstance, helpers: FriendRouteHelpers, book: TitleNoticeBook | undefined): void {
  const { store, authenticate, signedOut, tooMany, invalid, refused } = helpers;
  const readsByAccount = new RateLimiter(60, MINUTE);
  const writesByAccount = new RateLimiter(60, MINUTE);
  const base = "/api/profiles/:id/title-notices";

  const asker = (request: Parameters<typeof authenticate>[0], reply: Parameters<typeof signedOut>[0], limit: RateLimiter, profileId: string): boolean => {
    const auth = authenticate(request);
    if (!auth) return void signedOut(reply), false;
    if (!store.ownsProfile(auth.accountId, profileId)) return void refused(reply, "not_found"), false;
    const wait = limit.wait(auth.accountId);
    if (wait > 0) return void tooMany(reply, wait), false;
    limit.hit(auth.accountId);
    return true;
  };

  app.get<{ Params: { id: string } }>(base, async (request, reply) => {
    if (!asker(request, reply, readsByAccount, request.params.id)) return reply;
    return reply.header("Cache-Control", "no-store").send({ items: book?.of(request.params.id) ?? [] });
  });

  app.post<{ Params: { id: string } }>(`${base}/seen`, async (request, reply) => {
    if (!asker(request, reply, writesByAccount, request.params.id)) return reply;
    const parsed = TitleNoticeSeenSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    return reply.send({ items: book?.seen(request.params.id, parsed.data.ids) ?? [] });
  });

  app.post<{ Params: { id: string } }>(`${base}/dismiss`, async (request, reply) => {
    if (!asker(request, reply, writesByAccount, request.params.id)) return reply;
    const parsed = TitleNoticeDismissSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return reply.send({ items: book?.dismiss(request.params.id, parsed.data.id) ?? [] });
  });
}
