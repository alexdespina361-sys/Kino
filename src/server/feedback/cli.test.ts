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

async function reader(script: string, env: Record<string, string>) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [script, "inbox"], {
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
