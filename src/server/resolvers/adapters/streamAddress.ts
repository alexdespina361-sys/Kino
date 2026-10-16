/**
 * The address a screen is given for the picture of a stream that an adapter found (`raw`; `referer` is the page it came from, which the other end
 * wants to see). Whoever carries the film pays for it, so, in this order:
 *  - an edge relay (`EDGE_STREAM_PROXY_URL`, see scripts/edge-stream-worker.js): the screen asks the relay and not this server, which carries nothing;
 *  - the other end's own address (`DIRECT_STREAMING=true`): only for a site that lets pages of other websites in. One that does not (most of them:
 *    they check where the page is from, and send no CORS headers) fails the screen's first ask, and the player then asks this server instead,
 *    which carries it after all. It never takes the place of a relay, for that reason;
 *  - this server (`/api/proxy`).
 */
export function streamAddress(raw: string, referer: string, env: NodeJS.ProcessEnv = process.env): string {
  const relay = env.EDGE_STREAM_PROXY_URL?.trim();
  const asked = (base: string) => `${base}?url=${encodeURIComponent(raw)}&referer=${encodeURIComponent(referer)}`;
  if (relay) return asked(relay.replace(/\/$/, ""));
  const isDirect =
    env.DIRECT_STREAMING === "true" ||
    env.DIRECT_STREAMING === "on" ||
    env.DIRECT_STREAMING === "1" ||
    env.PROXY_VIDEO === "off" ||
    env.PROXY_VIDEO === "false" ||
    env.PROXY_VIDEO === "0";
  if (isDirect) return raw;
  return asked("/api/proxy");
}
