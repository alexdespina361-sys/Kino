import type { FastifyInstance } from "fastify";

/**
 * What every answer tells the browser that gets it, whatever the route: not to guess a type for what it is sent (`nosniff`), to say nothing of the page a visitor came
 * from, not to be shown inside a page of another site, not to let a page ask for what nothing here uses (the microphone, the position, a payment, a USB device) and,
 * over https, to come only that way for a year (a host's proxy says it was https: `trust.ts`). The camera, full screen, the wake lock and the clipboard are left alone:
 * the code scanner and the player use them. It is the first hook, so a route that says one of these itself keeps its own (the proxy's answers carry their own
 * `Content-Security-Policy` as well, which nothing here touches).
 */
export function securityHeaders(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "microphone=(), geolocation=(), payment=(), usb=()");
    // (A browser takes this from a page that came over https only, so it is not said to one that came over http.)
    if (request.protocol === "https") reply.header("Strict-Transport-Security", "max-age=31536000");
  });
}
