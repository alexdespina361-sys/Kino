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

/** The routes that make this server fetch from another site for whoever asks. */
const FETCHES = new Set(["/api/proxy", "/api/resolve"]);

/** Whether `origin`, as a browser writes it in `Origin` (an address without a path, or `null`), is the very host `host` (the `Host` header) names, with its port. */
export function isOwnOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    const from = new URL(origin);
    return from.host === new URL(`${from.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

/**
 * Where a request to the api came from. A session is a cookie that goes along with every request from a page of the same *site*, which is every name under
 * `24-7.ro` and not only this one (`SameSite=Lax`), and several routes that change something need no body, so a page of a sibling name could send them with a
 * visitor's cookie. A request that is not a read is turned away (403 `cross_site`) when the browser says it comes from another site or another name of this one
 * (`Sec-Fetch-Site`), or brings an `Origin` that is not the host it was sent to: the host is compared with the `Host` header, so each address the site is served
 * at is its own origin and none is listed. A request with none of these headers (a script, curl, an old browser) is as it was.
 *
 * What only reads is let through, except what makes this server fetch for whoever asks (`FETCHES`): a page of another site must not be able to use the server
 * for that, so it is turned away on the same word of the browser, unless the visitor followed a link there (a navigation).
 */
export function sameSiteGate(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    // (The path of the route that answers, not the one that was written: `/%61pi/...` reaches the same route.)
    const route = request.routeOptions.url ?? "";
    if (!route.startsWith("/api/") || request.method === "OPTIONS") return;
    const site = request.headers["sec-fetch-site"];
    const elsewhere = site === "cross-site" || site === "same-site";
    let refused: boolean;
    if (request.method === "GET" || request.method === "HEAD") {
      refused = FETCHES.has(route) && elsewhere && request.headers["sec-fetch-mode"] !== "navigate";
    } else {
      const { origin, host } = request.headers;
      refused = elsewhere || (origin !== undefined && !isOwnOrigin(origin, host));
    }
    if (refused) return reply.code(403).send({ error: "cross_site" });
  });
}
