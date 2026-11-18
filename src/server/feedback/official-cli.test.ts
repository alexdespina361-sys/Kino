import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const TOKEN = "never-shown-0123456789-abcdefghijklmnop";
const ID = "0123456789abcdef0123";

const stops: (() => void)[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

const meta = {
  v: 1,
  id: ID,
  rev: "abc",
  play: "filmpire:tv:60572:2:3",
  titleId: "filmpire-tv-60572",
  title: "Some Show",
  season: 2,
  episode: 3,
  lang: "en",
  from: { track: "/api/subtitles/ro/x.vtt", label: "English · Some.Show.S02E03.WEB" },
  duration: 2700,
  lines: 2,
  shares: { placed: 0.98, words: 0.91 },
  cleaned: { rules: 1, removed: 3, changed: 5 },
  created: Date.parse("2026-11-15T10:00:00Z"),
  updated: Date.parse("2026-11-15T12:00:00Z"),
};
const record = { meta, lines: [[150, 300, "- Where?\n- Home."], [360000, 360250, "The end."]], source: [[0, "-Where?\n-Home."]] };

async function site() {
  const asked: Array<{ method: string; url: string; authorization: string; body?: unknown }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      asked.push({ method: request.method ?? "", url: request.url ?? "", authorization: request.headers.authorization ?? "", ...(body ? { body: JSON.parse(body) } : {}) });
      const answer = (status: number, data: unknown) => {
        response.statusCode = status;
        response.end(JSON.stringify(data));
      };
      if (request.url === "/api/admin/official") return answer(200, { at: meta.updated, total: 1, items: [meta] });
      if (request.url !== `/api/admin/official/${ID}`) return answer(404, { error: "not_found" });
      if (request.method === "GET") return answer(200, record);
      if (request.method === "PUT") return answer(200, { ...meta, team: { at: meta.updated } });
      response.statusCode = 204;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stops.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { env: { KINO_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, FEEDBACK_ADMIN_TOKEN: TOKEN }, asked };
}

async function scripts(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "kino-official-cli-"));
  folders.push(folder);
  await mkdir(path.join(folder, "scripts"));
  for (const name of ["feedback.mjs", "official.mjs"]) await copyFile(path.resolve("scripts", name), path.join(folder, "scripts", name));
  return folder;
}

async function run(folder: string, env: Record<string, string>, args: string[]) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [path.join(folder, "scripts", "official.mjs"), ...args], {
      cwd: folder,
      env: { ...process.env, KINO_URL: "", FEEDBACK_ADMIN_TOKEN: "", KINO_FEEDBACK_TOKEN: "", KINO_FEEDBACK_FILE: "", ...env },
      timeout: 30_000,
    });
    return { code: 0, said: `${stdout}${stderr}` };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, said: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

describe("the team's command for the Kino Official subtitles", () => {
  it("lists them, with what each was made from, and never shows the token", async () => {
    const { env, asked } = await site();
    const { code, said } = await run(await scripts(), env, []);
    expect(code).toBe(0);
    expect(asked).toEqual([{ method: "GET", url: "/api/admin/official", authorization: `Bearer ${TOKEN}` }]);
    expect(said).toContain("1 Kino Official subtitles");
    expect(said).toContain(`${ID}  en    2026-11-15    91%      2   -3/~5    no  Some Show S02E03`);
    expect(said).toContain(`
${" ".repeat(68)}English · Some.Show.S02E03.WEB`);
    expect(said).toContain("English · Some.Show.S02E03.WEB");
    expect(said).not.toContain(TOKEN);
  });

  it("saves one to correct, and sends the corrected words back line for line, keeping the times", async () => {
    const { env, asked } = await site();
    const folder = await scripts();
    const shown = await run(folder, env, ["show", ID]);
    expect(shown.code).toBe(0);
    const srt = await readFile(path.join(folder, ".official", `${ID}.srt`), "utf8");
    expect(srt).toBe("1\n00:00:01,500 --> 00:00:03,000\n- Where?\n- Home.\n\n2\n01:00:00,000 --> 01:00:02,500\nThe end.\n");
    expect(JSON.parse(await readFile(path.join(folder, ".official", `${ID}.json`), "utf8")).source).toEqual(record.source);

    const corrected = path.join(folder, "corrected.srt");
    await writeFile(corrected, srt.replace("The end.", "The very end.").replace("00:00:01,500", "00:00:09,000").replace(/\n/g, "\r\n"));
    const put = await run(folder, env, ["put", ID, corrected, "--note", "read through"]);
    expect(put.code).toBe(0);
    expect(put.said).toContain("1 lines changed");
    expect(asked.at(-1)).toMatchObject({ method: "PUT", body: { lines: [[150, 300, "- Where?\n- Home."], [360000, 360250, "The very end."]], note: "read through" } });

    const timed = await run(folder, env, ["put", ID, corrected, "--times"]);
    expect(timed.code).toBe(0);
    expect((asked.at(-1)?.body as { lines: unknown[] }).lines[0]).toEqual([900, 300, "- Where?\n- Home."]);
  });

  it("refuses a file with lines added or taken away, an id that is no id, and a removal without --yes", async () => {
    const { env, asked } = await site();
    const folder = await scripts();
    const short = path.join(folder, "short.srt");
    await writeFile(short, "1\n00:00:01,500 --> 00:00:03,000\nOnly one.\n");
    expect((await run(folder, env, ["put", ID, short])).said).toContain("has 1 lines and the subtitle 2");
    expect((await run(folder, env, ["show", "nope"])).code).toBe(1);
    expect((await run(folder, env, ["remove", ID])).said).toContain("--yes");
    expect(asked.filter((each) => each.method !== "GET")).toEqual([]);
    expect((await run(folder, env, ["remove", ID, "--yes"])).said).toContain(`${ID} removed`);
  });
});
