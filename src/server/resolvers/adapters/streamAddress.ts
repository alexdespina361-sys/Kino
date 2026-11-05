import { signedRelayUrl } from "../../streamRelay/links";

/**
 * The address a screen is given for the picture of a stream that an adapter found (`raw`; `referer` is the page it came from, which the other end
 * wants to see). Whoever carries the film pays for it, so, in this order:
 *  - a separate relay (`EDGE_STREAM_PROXY_URL`, and `EDGE_STREAM_PROXY_KEY` for the signed Node relay): the website carries nothing;
 *  - the other end's own address (`DIRECT_STREAMING=true`): requires the provider to allow cross-origin playback;
 *  - this server (`/api/proxy`).
 */
export function streamAddress(raw: string, referer: string, env: NodeJS.ProcessEnv = process.env, hostToken = false): string {
  const relay = env.EDGE_STREAM_PROXY_URL?.trim();
  const asked = (base: string) => `${base}?url=${encodeURIComponent(raw)}&referer=${encodeURIComponent(referer)}`;
  if (relay) {
    const key = env.EDGE_STREAM_PROXY_KEY;
    if (key) {
      if (key.length < 32) throw new Error("EDGE_STREAM_PROXY_KEY must contain at least 32 characters");
      return signedRelayUrl(relay, { url: raw, referer, expires: Date.now() + 12 * 3600_000, hostToken }, key);
    }
    return asked(relay.replace(/\/$/, ""));
  }
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
