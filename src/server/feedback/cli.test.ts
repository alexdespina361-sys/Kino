import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

// scripts/feedback.mjs is what the team reads reports with. These check where it finds its address and token (a person writes that file by hand).
const exec = promisify(execFile);
const SCRIPT = path.resolve("scripts/feedback.mjs");
const TOKEN = "never-shown-0123456789-abcdefghijklmnop";

const folders: string[] = [];
const stops: (() => void)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await mkdtemp(path.join(tmpdir(), "kino-cli-"));
  folders.push(made);
  return made;
}

/** A site that turns every ask away with 401 and remembers what it was asked. */
async function site() {
  const asked: { url: string; authorization: string }[] = [];
  const server = createServer((request, response) => {
    asked.push({ url: request.url ?? "", authorization: request.headers.authorization ?? "" });
    response.statusCode = 401;
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stops.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { port: (server.address() as AddressInfo).port, asked };
}

async function reader(script: string, env: Record<string, string>, args: string[] = ["inbox"]) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [script, ...args], {
      env: { ...process.env, KINO_URL: "", FEEDBACK_ADMIN_TOKEN: "", KINO_FEEDBACK_TOKEN: "", KINO_FEEDBACK_FILE: "", ...env },
      timeout: 30_000,
    });
    return { code: 0, said: `${stdout}${stderr}` };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, said: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

describe("the team's reader finds its address and token", () => {
  it("names a file that holds only the token, and never shows it", async () => {
    const file = path.join(await folder(), "bare.json");
    await writeFile(file, `${TOKEN}\n`);
    const { code, said } = await reader(SCRIPT, { KINO_FEEDBACK_FILE: file });
    expect(code).toBe(1);
    expect(said).toContain("not JSON");
    expect(said).toContain("bare.json");
    expect(said).not.toContain(TOKEN);
  });

  it("takes the address and token of a file, forgiving a byte-order mark, a missing https:// and stray spaces", async () => {
    const { port, asked } = await site();
    const file = path.join(await folder(), "settings.json");
    await writeFile(file, `﻿${JSON.stringify({ url: ` 127.0.0.1:${port}/ `, token: ` ${TOKEN}\n` })}`);
    const { code, said } = await reader(SCRIPT, { KINO_FEEDBACK_FILE: file });
    expect(code).toBe(1);
    expect(said).toContain("did not take the token (401)");
    expect(asked[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(asked[0]?.url).toMatch(/^\/api\/admin\/feedback/);
    expect(said).not.toContain(TOKEN);
  });

  it("looks in the main folder of the repository when it runs from a git worktree", async () => {
    const dir = await folder();
    const { port, asked } = await site();
    const main = path.join(dir, "main");
    const worktree = path.join(dir, "wt");
    await mkdir(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
    await mkdir(path.join(worktree, "scripts"), { recursive: true });
    await writeFile(path.join(worktree, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
    await copyFile(SCRIPT, path.join(worktree, "scripts", "feedback.mjs"));
    await writeFile(path.join(main, ".kino-feedback.json"), JSON.stringify({ url: `http://127.0.0.1:${port}`, token: TOKEN }));
    const { said } = await reader(path.join(worktree, "scripts", "feedback.mjs"), {});
    expect(said).toContain("(401)");
    expect(asked[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("prefers the file beside the scripts to the one in the main folder", async () => {
    const dir = await folder();
    const near = await site();
    const far = await site();
    const main = path.join(dir, "main");
    const worktree = path.join(dir, "wt");
    await mkdir(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
    await mkdir(path.join(worktree, "scripts"), { recursive: true });
    await writeFile(path.join(worktree, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
    await copyFile(SCRIPT, path.join(worktree, "scripts", "feedback.mjs"));
    await writeFile(path.join(main, ".kino-feedback.json"), JSON.stringify({ url: `http://127.0.0.1:${far.port}`, token: TOKEN }));
    await writeFile(path.join(worktree, ".kino-feedback.json"), JSON.stringify({ url: `http://127.0.0.1:${near.port}`, token: TOKEN }));
    await reader(path.join(worktree, "scripts", "feedback.mjs"), {});
    expect(near.asked).toHaveLength(1);
    expect(far.asked).toHaveLength(0);
  });
});

describe("the owner's stats", () => {
  const view = {
    at: Date.parse("2026-11-01T14:30:00Z"),
    zone: "UTC",
    accounts: {
      total: 37,
      profiles: 52,
      limit: 500,
      signUps: "open",
      made: { today: 2, week: 9, month: 37 },
      used: { today: 5, week: 14, month: 30 },
      devices: { browser: 31, tv: 12, remote: 4 },
    },
    visits: { since: "2026-10-30", visitors: { today: 12, week: 61, month: 61 }, loads: { today: 30, week: 120, month: 120 } },
    you: { address: "203.0.113.9", connection: "10.1.2.3", forwardedFor: "203.0.113.9, 172.70.1.2", cloudflare: null },
    days: [
      { day: "2026-10-30", newAccounts: 1, accounts: 34, visitors: 20, loads: 40 },
      { day: "2026-10-31", newAccounts: 0, accounts: 34, visitors: 29, loads: 50 },
      { day: "2026-11-01", newAccounts: 3, accounts: 37, visitors: 12, loads: 30 },
    ],
  };

  /** A site that answers the stats with this, and /api/health with `health` (a 404 when it has none: a server before the counters were the team's), and remembers what it was asked. */
  async function statsSite(status: number, body: unknown, health?: unknown) {
    const asked: { url: string; authorization: string }[] = [];
    const server = createServer((request, response) => {
      asked.push({ url: request.url ?? "", authorization: request.headers.authorization ?? "" });
      const isHealth = request.url === "/api/health";
      response.statusCode = isHealth ? (health ? 200 : 404) : status;
      response.end(JSON.stringify(isHealth ? (health ?? { error: "NOT_FOUND" }) : body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    stops.push(() => {
      server.closeAllConnections();
      server.close();
    });
    return { env: { KINO_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, FEEDBACK_ADMIN_TOKEN: TOKEN }, asked };
  }

  it("shows the accounts, the visitors and the days, asking with the team's token", async () => {
    const { env, asked } = await statsSite(200, view);
    const { code, said } = await reader(SCRIPT, env, ["stats", "--days", "3"]);
    expect(code).toBe(0);
    expect(asked).toEqual([
      { url: "/api/admin/stats?days=3", authorization: `Bearer ${TOKEN}` },
      { url: "/api/health", authorization: `Bearer ${TOKEN}` }, // (the server's counters: the team's since 16 Nov)
    ]);
    expect(said).not.toContain("Server:"); // (this one has none to give)
    expect(said).toContain("Accounts: 37 (52 profiles). Sign-ups are open, up to 500.");
    expect(said).toContain("made      today 2, last 7 days 9, last 30 days 37");
    expect(said).toContain("used      today 5, last 7 days 14, last 30 days 30");
    expect(said).toContain("devices   browser 31, tv 12, remote 4");
    expect(said).toContain("counted since 2026-10-30; nobody was counted before");
    expect(said).toContain("people    today 12, last 7 days 61, last 30 days 61");
    expect(said).toContain("loads     today 30, last 7 days 120, last 30 days 120");
    expect(said).toContain("Your address, as the server reads it: 203.0.113.9");
    expect(said).toContain("the connection 10.1.2.3, X-Forwarded-For 203.0.113.9, 172.70.1.2, Cloudflare says none");
    expect(said).toContain("2026-11-01 14:30 UTC");
    // the days, newest last, with the columns for what the server has
    expect(said.split("\n").filter((line) => /^\s*2026-1\d-\d\d\s+\d/.test(line)).map((line) => line.trim().split(/\s+/))).toEqual([
      ["2026-10-30", "1", "34", "20", "40"],
      ["2026-10-31", "0", "34", "29", "50"],
      ["2026-11-01", "3", "37", "12", "30"],
    ]);
    expect(said).not.toContain(TOKEN);
  });

  it("is the same through scripts/stats.mjs, which lists 14 days unless asked", async () => {
    const { env, asked } = await statsSite(200, view);
    const { code, said } = await reader(path.resolve("scripts/stats.mjs"), env, []);
    expect(code).toBe(0);
    expect(asked[0]?.url).toBe("/api/admin/stats?days=14");
    expect(said).toContain("Accounts: 37");
  });

  it("adds the server's counters from the team's /api/health", async () => {
    const health = {
      ok: true,
      storage: "postgres",
      uptime: 26 * 3600 + 120,
      segments: { hits: 40, misses: 10, keptMB: 12 },
      proxy: { bytes: 5 * 1024 * 1024, requests: 77, refused: 3, video: "off" },
      subsync: { found: 9, missed: 4, stored: 2 },
      official: { kept: 6, offers: {} },
      feedback: { reports: 11, full: true, team: true },
      features: {},
    };
    const { env } = await statsSite(200, view, health);
    const { code, said } = await reader(SCRIPT, env, ["stats"]);
    expect(code).toBe(0);
    expect(said).toContain("Server: up 1d 2h, keeps its data in postgres");
    expect(said).toContain("proxy     films off, 5 MB sent on in 77 asks, 3 turned away");
    expect(said).toContain("pieces    40 given from memory, 10 fetched (12 MB kept)");
    expect(said).toContain("timings   9 found, 4 not, 2 left by screens");
    expect(said).toContain("official  6 Kino Official subtitles kept");
    expect(said).toContain("feedback  11 reports kept, FULL: a new one would be turned away");
    const json = await reader(SCRIPT, env, ["stats", "--json"]);
    expect(JSON.parse(json.said)).toEqual({ ...view, server: health });
  });

  it("gives the numbers as they are with --json", async () => {
    const { env } = await statsSite(200, view);
    const { code, said } = await reader(SCRIPT, env, ["stats", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(said)).toEqual(view);
  });

  it("says when the count of visitors is not there, and when the sign-ups are closed", async () => {
    const { visits: _visits, ...withoutVisits } = view;
    const { env } = await statsSite(200, { ...withoutVisits, accounts: { ...view.accounts, signUps: "closed", total: 500 }, days: view.days.map(({ day, newAccounts, accounts }) => ({ day, newAccounts, accounts })) });
    const { said } = await reader(SCRIPT, env, ["stats"]);
    expect(said).toContain("Sign-ups are closed (the limit of 500 is reached).");
    expect(said).toContain("Visitors: not counted on this server");
    expect(said).not.toContain("Loads");
  });

  it("says what a 404 means: no token there, or a site without the stats yet", async () => {
    const { env } = await statsSite(404, { error: "NOT_FOUND" });
    const { code, said } = await reader(SCRIPT, env, ["stats"]);
    expect(code).toBe(1);
    expect(said).toContain("FEEDBACK_ADMIN_TOKEN is not set there");
    expect(said).toContain("deployed before the stats were added");
  });

  const list = {
    at: Date.parse("2026-11-15T15:00:00Z"),
    total: 3,
    marked: 2,
    items: [
      { title: "Pokémon", kind: "series", titleId: "filmpire-tv-60572", season: 25, episode: 6, link: "https://filmpire.sc/watch/60572?s=25&e=6", occasions: 4, first: Date.parse("2026-11-14T10:00:00Z"), last: Date.parse("2026-11-15T14:06:00Z"), marked: true },
      { title: "A Quiet Film", kind: "movie", titleId: "filmpire-movie-77", link: "https://filmpire.sc/watch/77", occasions: 2, first: Date.parse("2026-11-10T10:00:00Z"), last: Date.parse("2026-11-12T10:00:00Z"), marked: true },
    ],
  };

  it("lists what nobody could play, the most asked for first, with its episode, dates and link", async () => {
    const { env, asked } = await statsSite(200, list);
    const { code, said } = await reader(path.resolve("scripts/unavailable.mjs"), env, []);
    expect(code).toBe(0);
    expect(asked).toEqual([{ url: "/api/admin/unavailable", authorization: `Bearer ${TOKEN}` }]);
    expect(said).toContain('2 marked "Not available yet" on the screens, 3 kept in all');
    expect(said).toContain("    4  2026-11-15  2026-11-14  Pokémon S25E06");
    expect(said).toContain("https://filmpire.sc/watch/60572?s=25&e=6");
    expect(said).toContain("    2  2026-11-12  2026-11-10  A Quiet Film (film)");
    expect(said).not.toContain(TOKEN);
  });

  it("asks for every one kept with --all, gives them as they are with --json, and says what a 404 means", async () => {
    const { env, asked } = await statsSite(200, list);
    const { code, said } = await reader(SCRIPT, env, ["unavailable", "--all", "--json"]);
    expect(code).toBe(0);
    expect(asked[0]?.url).toBe("/api/admin/unavailable?all=1");
    expect(JSON.parse(said)).toEqual(list);
    const missing = await statsSite(404, { error: "NOT_FOUND" });
    const refused = await reader(SCRIPT, missing.env, ["unavailable"]);
    expect(refused.code).toBe(1);
    expect(refused.said).toContain("deployed before the list was added");
  });
});
