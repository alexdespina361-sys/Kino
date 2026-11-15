import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OfficialOfferSchema, SUBSYNC_MAX_LINES } from "../../shared";
import { RateLimiter } from "../accounts/rateLimit";
import { teamGuard } from "../feedback/routes";
import type { Officials } from "./official";

const MINUTE = 60_000;
/** An offer is every line of the longest file, a few numbers each. */
const OFFER_LIMIT = 256 * 1024;
const EDIT_LIMIT = 2 * 1024 * 1024;

const Cs = z.number().int().min(0).max(24 * 3600 * 100);
const EditSchema = z.object({
  lines: z
    .array(z.tuple([Cs, Cs, z.string().min(1).max(1000)]))
    .min(1)
    .max(SUBSYNC_MAX_LINES)
    .refine((lines) => lines.every(([start, end]) => end > start), "every line must end after it starts"),
  note: z.string().max(500).optional(),
});

/**
 * Kino Official subtitles (see `official.ts`): the file a screen is given (`/api/subtitles/official/:id-:rev.vtt`), the offers screens make
 * (`POST /api/official/offer`), and the team's side under `/api/admin/official`, with the team's token.
 */
export function officialRoutes(
  app: FastifyInstance,
  { officials, adminToken, fetchFile }: { officials: Officials; adminToken: string | undefined; fetchFile: (track: string) => Promise<string | undefined> },
): void {
  const offers = new RateLimiter(20, 60 * MINUTE);
  const team = teamGuard(adminToken);

  app.get<{ Params: { file: string } }>("/api/subtitles/official/:file", async (request, reply) => {
    const match = /^([0-9a-f]{20})-([0-9a-z]{1,12})\.vtt$/.exec(request.params.file);
    if (!match) return reply.code(404).send({ error: "Subtitle not found" });
    const found = await officials.vtt(match[1]!, match[2]!).catch(() => undefined);
    if (!found) return reply.code(404).send({ error: "Subtitle not found" });
    reply.header("Content-Type", "text/vtt; charset=utf-8");
    // (The link names the version: the one it names never changes. A link of an older one gets the newer, for a while.)
    reply.header("Cache-Control", found.current ? "public, max-age=31536000, immutable" : "public, max-age=300");
    reply.header("Access-Control-Allow-Origin", "*");
    return reply.send(found.vtt);
  });

  app.post("/api/official/offer", { bodyLimit: OFFER_LIMIT }, async (request, reply) => {
    const wait = offers.wait(request.ip);
    if (wait > 0) return reply.header("Retry-After", Math.ceil(wait / 1000)).code(429).send({ error: "rate_limited" });
    offers.hit(request.ip);
    const parsed = OfficialOfferSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const outcome = await officials.offer(parsed.data, fetchFile).catch((error: Error) => {
      request.log.warn(`Kino Official subtitles: an offer failed: ${error.message}`);
      return "unavailable" as const;
    });
    // (What became of it is said, for the debug panel; a screen does nothing more about it.)
    return reply.code(outcome === "taken" ? 201 : 200).send({ outcome });
  });

  app.get<{ Querystring: { all?: string } }>("/api/admin/official", async (request, reply) => {
    if (!team(request, reply)) return reply;
    reply.header("Cache-Control", "no-store");
    return reply.send({ at: Date.now(), total: officials.size, items: officials.list() });
  });

  app.get<{ Params: { id: string } }>("/api/admin/official/:id", async (request, reply) => {
    if (!team(request, reply)) return reply;
    const record = /^[0-9a-f]{20}$/.test(request.params.id) ? await officials.get(request.params.id) : undefined;
    if (!record) return reply.code(404).send({ error: "not_found" });
    reply.header("Cache-Control", "no-store");
    return reply.send(record);
  });

  app.put<{ Params: { id: string } }>("/api/admin/official/:id", { bodyLimit: EDIT_LIMIT }, async (request, reply) => {
    if (!team(request, reply)) return reply;
    if (!/^[0-9a-f]{20}$/.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const parsed = EditSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const outcome = await officials.edit(request.params.id, parsed.data);
    if (outcome === "not_found") return reply.code(404).send({ error: "not_found" });
    if (outcome === "different_lines") return reply.code(409).send({ error: "different_lines" });
    return reply.send(outcome);
  });

  app.delete<{ Params: { id: string } }>("/api/admin/official/:id", async (request, reply) => {
    if (!team(request, reply)) return reply;
    const gone = /^[0-9a-f]{20}$/.test(request.params.id) && (await officials.remove(request.params.id));
    return gone ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
  });
}
