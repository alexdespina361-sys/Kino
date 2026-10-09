import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFromFile, type ProxyOptions } from "vite";

/**
 * Regression: a second `export default` in vite.config.ts is accepted silently by Vite's config bundler and
 * the LAST one wins, which dropped the dev proxy (so /ws hung forever, locally and through tunnels).
 * This checks what Vite actually resolves, not what the file looks like.
 */
describe("vite.config.ts (as Vite resolves it)", async () => {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "development" },
    path.resolve(import.meta.dirname, "../vite.config.ts"),
  );
  const config = loaded!.config;
  const proxy = config.server?.proxy as Record<string, string | ProxyOptions>;

  it("keeps the React plugin and the build output dir", () => {
    expect((config.plugins ?? []).length).toBeGreaterThan(0);
    expect(config.build?.outDir).toBe("dist/client");
  });

  it("proxies /ws as a WebSocket to Fastify on 127.0.0.1", () => {
    const ws = proxy["/ws"] as ProxyOptions;
    expect(ws.ws).toBe(true);
    expect(String(ws.target)).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });

  it("proxies /api and /fixtures to Fastify over http", () => {
    for (const route of ["/api", "/fixtures"]) expect(String(proxy[route])).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("accepts quick-tunnel Host headers and listens on all interfaces", () => {
    expect(config.server?.allowedHosts).toContain(".trycloudflare.com");
    expect(config.server?.host).toBe("0.0.0.0");
  });
});
