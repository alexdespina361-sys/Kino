import { openUpstream } from "../proxy";
import { isPublicAddress } from "../resolvers/ip";

interface Token { value: string; expires: number }

/** Tokens are IP-bound. This runs on the relay that downloads the media, never on the website or in the viewer's browser. */
export class HostTokens {
  private cache = new Map<string, Token>();
  private pending = new Map<string, Promise<Token>>();

  constructor(private readonly allowedAddress = isPublicAddress) {}

  invalidate(targetOrigin: string, referer: string): void {
    try {
      const key = `${targetOrigin}\n${new URL(referer).origin}`;
      this.cache.delete(key);
    } catch {
      // ignore
    }
  }

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
    let apiToken: string | undefined;

    if (referer && /^https?:\/\//i.test(referer)) {
      try {
        const refUrl = new URL(referer);
        // Upstream binds api_token to the IP address of the machine that loaded the player container page.
        // The relay MUST fetch the container page itself from its own IP so the token matches this relay's IP.
        refUrl.searchParams.delete("api_token");

        if (!apiToken) {
          const embedReferer = `${refUrl.origin}${refUrl.pathname.replace("/embed/player/", "/embed/")}${refUrl.search}`;
          const { response: refRes } = await openUpstream(
            refUrl,
            {
              accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              referer: embedReferer,
            },
            this.allowedAddress,
            AbortSignal.timeout(8_000),
          );

          if (refRes.ok) {
            const reader = refRes.body?.getReader();
            if (reader) {
              const chunks: Uint8Array[] = [];
              let bytes = 0;
              try {
                while (bytes < 131_072) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                  bytes += value.length;
                }
              } finally {
                await reader.cancel();
              }
              const html = Buffer.concat(chunks).toString("utf8");
              const configMatch = html.match(/window\.CONFIG\s*=\s*(\{[\s\S]*?\});/);
              if (configMatch?.[1]) {
                try {
                  const parsed = JSON.parse(configMatch[1]) as { apiToken?: string };
                  if (typeof parsed.apiToken === "string") apiToken = parsed.apiToken;
                } catch {
                  // ignore
                }
              }
              if (!apiToken) {
                const turnstileMatch =
                  html.match(/name="turnstile_token"\s+value="([^"]+)"/) ||
                  html.match(/["']api_token["']\s*:\s*["']([^"']+)["']/);
                if (turnstileMatch) apiToken = turnstileMatch[1];
              }
            }
          } else {
            await refRes.body?.cancel();
          }
        }
      } catch {
        // Proceed to try generate.php directly
      }
    }

    const genUrl = apiToken
      ? new URL(`/generate.php?api_token=${encodeURIComponent(apiToken)}`, origin)
      : new URL("/generate.php", origin);

    let response: Awaited<ReturnType<typeof openUpstream>>["response"] | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const opened = await openUpstream(genUrl, {
          referer, accept: "*/*",
        }, this.allowedAddress, AbortSignal.timeout(15_000));
        response = opened.response;
        break;
      } catch (e) {
        if (attempt === 1) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!response || !response.ok) {
      if (response) await response.body?.cancel();
      throw new Error(`Token endpoint returned HTTP ${response?.status ?? 502}`);
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
