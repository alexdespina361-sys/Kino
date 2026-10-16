import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const code = readFileSync(new URL("../../../extensions/kino-direct/background.js", import.meta.url), "utf8");
const inventory = [
  "farragoandfulcrum.website", "diaphanousdogma.website", "theorboofthorns.space",
  "quorumofquiddity.site", "comityofcognomen.site", "peregrinepalaver.space",
  "roilandrelic.website", "noosphere-nectar.site", "welkinwanderer.space",
  "zealotsofzenith.site", "ataraxiaoftheapex.space", "next-rotated-host.net",
];
type Rule = { id: number; action: unknown; condition: { initiatorDomains: string[]; requestDomains: string[]; regexFilter: string } };
type Sender = { id: string; tab?: object; url: string };
type Reply = { url?: string; error?: string };
let rules: Rule[];
let fetchToken: ReturnType<typeof vi.fn>;
let updateRules: ReturnType<typeof vi.fn>;
let receive: (message: object, sender: Sender, respond: (reply: Reply) => void) => boolean | undefined;
const sender = { id: "kino-test", tab: {}, url: "https://kino.24-7.ro/tv" };

beforeEach(() => {
  rules = [];
  const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
  fetchToken = vi.fn(async () => new Response(token));
  updateRules = vi.fn(async ({ removeRuleIds, addRules }: { removeRuleIds: number[]; addRules: Rule[] }) => {
    // Let another prepare request overlap this API operation.
    await Promise.resolve();
    if (addRules.some(next => rules.some(rule => rule.id === next.id && !removeRuleIds.includes(rule.id)))) throw new Error("Duplicate rule ID");
    rules = rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
  });
  runInNewContext(code, {
    URL, AbortSignal, Map, Set, Date, Error, atob, fetch: fetchToken,
    chrome: {
      runtime: { id: sender.id, onMessage: { addListener: (listener: typeof receive) => { receive = listener; } } },
      declarativeNetRequest: { getSessionRules: async () => structuredClone(rules), updateSessionRules: updateRules },
    },
  });
});

const prepare = (url: string, from: Sender = sender) => new Promise<Reply>(resolve => {
  receive({ channel: "kino-direct", type: "prepare", url }, from, resolve);
});
const stream = (host: string) => `https://${host}/pl/title/master.m3u8?token=wrong-ip`;

describe("the distributed Chromium extension", () => {
  it("prepares every observed host and future rotations with independent, Kino-scoped rules", async () => {
    const replies = await Promise.all(inventory.map(host => prepare(stream(host))));
    expect(replies.every(reply => reply.url && !reply.error && !reply.url.includes("wrong-ip"))).toBe(true);
    expect(fetchToken).toHaveBeenCalledTimes(inventory.length);
    expect(new Set(rules.map(rule => rule.id)).size).toBe(inventory.length);
    expect(rules.flatMap(rule => rule.condition.requestDomains).sort()).toEqual([...inventory].sort());
    for (const rule of rules) {
      expect(rule.condition.initiatorDomains).toEqual(["kino.24-7.ro"]);
      const host = rule.condition.requestDomains[0]!;
      const pattern = new RegExp(rule.condition.regexFilter);
      expect(pattern.test(stream(host))).toBe(true);
      expect(pattern.test(stream(`${host}.unrelated.com`))).toBe(false);
    }
  });

  it("reuses a host's token and rule across simultaneous movie and episode loads", async () => {
    const replies = await Promise.all([prepare(stream(inventory[2]!)), prepare(stream(inventory[2]!))]);
    expect(replies[0]?.url).toBe(replies[1]?.url);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(updateRules).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://127.0.0.1/pl/a.m3u8", "https://[::1]/pl/a.m3u8", "https://localhost/pl/a.m3u8",
    "https://device.local/pl/a.m3u8", "https://device.internal/pl/a.m3u8", "http://video.site/pl/a.m3u8",
    "https://user:pass@video.site/pl/a.m3u8", "https://video.site:8443/pl/a.m3u8", "https://video.site/admin",
  ])("refuses unsupported addresses before installing rules or making requests: %s", async (url) => {
    expect((await prepare(url)).error).toBeTruthy();
    expect(fetchToken).not.toHaveBeenCalled();
    expect(updateRules).not.toHaveBeenCalled();
  });

  it.each([
    { ...sender, url: "https://unrelated.com/tv" }, { ...sender, id: "another-extension" }, { id: sender.id, url: sender.url },
  ])("refuses a caller outside Kino: %j", async (from) => {
    expect((await prepare(stream(inventory[0]!), from)).error).toBe("This page is not Kino");
    expect(fetchToken).not.toHaveBeenCalled();
    expect(updateRules).not.toHaveBeenCalled();
  });

  it("reports a rule installation failure and allows a later retry", async () => {
    updateRules.mockRejectedValueOnce(new Error("Header rules unavailable"));
    expect((await prepare(stream(inventory[2]!))).error).toBe("Header rules unavailable");
    expect(fetchToken).not.toHaveBeenCalled();
    expect((await prepare(stream(inventory[2]!))).url).toContain("bypass_localize=true");
  });

  it("does not pass through a server-issued token when the provider refuses a fresh one", async () => {
    fetchToken.mockResolvedValueOnce(new Response("Denied", { status: 403 }));
    expect(await prepare(stream(inventory[2]!))).toEqual({ error: "Video provider returned HTTP 403" });
  });
});
