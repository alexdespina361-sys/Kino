import type { FastifyInstance, FastifyReply } from "fastify";
import { SharedTimingSchema, SUBSYNC_KEY } from "../../shared";
import { RateLimiter } from "../accounts/rateLimit";
import type { SubsyncStore } from "./store";

const MINUTE = 60_000;
const BODY_LIMIT = 192 * 1024;

export interface SubsyncStats {
  found: number;
  missed: number;
  stored: number;
}

export function subsyncRoutes(app: FastifyInstance, { store, stats }: { store: SubsyncStore; stats: SubsyncStats }): void {
  const reads = new RateLimiter(120, MINUTE);
  const writes = new RateLimiter(60, 10 * MINUTE, undefined, "subsync.writes");
  const tooMany = (reply: FastifyReply, waitMs: number) => {
    const seconds = Math.max(1, Math.ceil(waitMs / 1000));
    return reply.header("Retry-After", seconds).code(429).send({ error: "rate_limited", retryAfter: seconds });
  };

  app.get<{ Params: { key: string } }>("/api/subsync/:key", async (request, reply) => {
    const { key } = request.params;
    if (!SUBSYNC_KEY.test(key)) return reply.code(400).send({ error: "invalid_request" });
    const wait = reads.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    reads.hit(request.ip);
    const timing = await store.get(key);
    if (!timing) {
      stats.missed++;
      return reply.code(204).header("Cache-Control", "no-store").send();
    }
    stats.found++;
    return reply.header("Cache-Control", "public, max-age=60").send(timing);
  });

  app.put<{ Params: { key: string } }>("/api/subsync/:key", { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const { key } = request.params;
    if (!SUBSYNC_KEY.test(key)) return reply.code(400).send({ error: "invalid_request" });
    const wait = writes.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    writes.hit(request.ip);
    const parsed = SharedTimingSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (!(await store.merge(key, parsed.data))) return reply.code(409).send({ error: "different_file" });
    stats.stored++;
    return reply.code(204).send();
  });
}
