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
    visits: { since: "2026-10-30", visitors: { today: 12, week: 61, month: 61 }, loads: { today: 30, week: 120, month: 120 }, addressFrom: { cloudflare: 118, forwarded: 2, connection: 0 } },
    days: [
      { day: "2026-10-30", newAccounts: 1, accounts: 34, visitors: 20, loads: 40 },
      { day: "2026-10-31", newAccounts: 0, accounts: 34, visitors: 29, loads: 50 },
      { day: "2026-11-01", newAccounts: 3, accounts: 37, visitors: 12, loads: 30 },
    ],
  };

  /** A site that answers the stats with this (and remembers what it was asked). */
  async function statsSite(status: number, body: unknown) {
    const asked: { url: string; authorization: string }[] = [];
    const server = createServer((request, response) => {
      asked.push({ url: request.url ?? "", authorization: request.headers.authorization ?? "" });
      response.statusCode = status;
      response.end(JSON.stringify(body));
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
    expect(asked).toEqual([{ url: "/api/admin/stats?days=3", authorization: `Bearer ${TOKEN}` }]);
    expect(said).toContain("Accounts: 37 (52 profiles). Sign-ups are open, up to 500.");
    expect(said).toContain("made      today 2, last 7 days 9, last 30 days 37");
    expect(said).toContain("used      today 5, last 7 days 14, last 30 days 30");
    expect(said).toContain("devices   browser 31, tv 12, remote 4");
    expect(said).toContain("counted since 2026-10-30; nobody was counted before");
    expect(said).toContain("people    today 12, last 7 days 61, last 30 days 61");
    expect(said).toContain("loads     today 30, last 7 days 120, last 30 days 120");
    expect(said).toContain("address   from Cloudflare on 118 loads, from X-Forwarded-For on 2, from the connection on 0");
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
});
