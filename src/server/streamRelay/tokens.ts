import { openUpstream } from "../proxy";
import { isPublicAddress } from "../resolvers/ip";

interface Token { value: string; expires: number }

/** Tokens are IP-bound. This runs on the relay that downloads the media, never on the website or in the viewer's browser. */
export class HostTokens {
  private cache = new Map<string, Token>();
  private pending = new Map<string, Promise<Token>>();

  constructor(private readonly allowedAddress = isPublicAddress) {}

  async authorize(target: URL, referer: string): Promise<URL> {
    const key = `${target.origin}\n${new URL(referer).origin}`;
    let token = this.cache.get(key);
    if (!token || token.expires <= Date.now() + 60_000) {
      let pending = this.pending.get(key);
      if (!pending) {
        pending = this.fetchToken(target.origin, referer).then((fresh) => {
          // Bound memory even if a large catalogue uses many origins.
          if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, fresh);
          return fresh;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, pending);
      }
      token = await pending;
    }
    const url = new URL(target);
    url.searchParams.set("token", token.value);
    url.searchParams.set("bypass_localize", "true");
    return url;
  }

  private async fetchToken(origin: string, referer: string): Promise<Token> {
    const { response } = await openUpstream(new URL("/generate.php", origin), {
      referer, accept: "*/*", "user-agent": "Mozilla/5.0",
    }, this.allowedAddress, AbortSignal.timeout(15_000));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Token endpoint returned HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty token response");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 16_384) throw new Error("Token response too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    let value = Buffer.concat(chunks).toString("utf8").trim();
    try {
      const parsed = JSON.parse(value) as { token?: unknown; data?: unknown };
      value = typeof parsed.token === "string" ? parsed.token : typeof parsed.data === "string" ? parsed.data : value;
    } catch { /* Some hosts return the JWT as plain text. */ }
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid host token");
    const payload = JSON.parse(Buffer.from(value.split(".")[1]!, "base64url").toString("utf8")) as { exp?: number };
    const expires = Number(payload.exp) * 1000;
    if (!Number.isFinite(expires) || expires <= Date.now() + 60_000) throw new Error("Host token is expired");
    return { value, expires };
  }
}
