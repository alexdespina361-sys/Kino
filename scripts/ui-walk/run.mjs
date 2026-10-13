// Runs the whole screenshot walk for one look: builds the client, starts a fresh test server for each part (accounts live in the server's
// memory, so a part that signs people up gets a server of its own), runs the part against it, stops the server.
//
//   node scripts/ui-walk/run.mjs [--ui=classic|polish] [--only=tv-hd,phone] [--out=<dir>] [--port=8810] [--no-build] [--scan]
//
// The pictures go to .ui-polish/shots/<look>/<device>/<name>.png (not committed). scripts/ui-walk/compare.mjs says what differs between two looks.
// With --scan every picture is also measured (live computed styles, scan.mjs) into .ui-polish/scan/<look>/; scripts/ui-walk/drift.mjs adds them up.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const look = option("ui", "classic") === "polish" ? "polish" : "classic";
const port = Number(option("port", look === "polish" ? "8811" : "8810"));
const out = option("out", `.ui-polish/shots/${look}`);
const only = option("only", "")
  .split(",")
  .filter(Boolean);
const base = `http://127.0.0.1:${port}`;
const here = (name) => fileURLToPath(new URL(name, import.meta.url));

const PARTS = [
  { name: "tv-hd", script: "tv.mjs", args: ["welcome,hd"] },
  { name: "tv-full", script: "tv.mjs", args: ["full"] },
  { name: "tv-wide", script: "tv.mjs", args: ["qhd,desktop,laptop"] },
  { name: "tv-in-hd", script: "tv-signed-in.mjs", args: ["hd"] },
  { name: "tv-in-full", script: "tv-signed-in.mjs", args: ["full"] },
  { name: "phone", script: "phone.mjs", args: ["guest,in"] },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stop(child) {
  if (!child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
}

async function startServer() {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/server/index.ts"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ALLOW_PRIVATE_NETWORK: "1", LIBRARY: "off", DATA_DIR: "memory", SIGNUPS_PER_HOUR: "1000" },
    stdio: "ignore",
    windowsHide: true,
  });
  for (let tries = 0; tries < 60; tries++) {
    await wait(500);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return child;
    } catch {
      /* not up yet */
    }
  }
  stop(child);
  throw new Error(`the server did not come up on ${base}`);
}

if (!flag("no-build")) {
  console.log("building the client...");
  const built = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { stdio: "ignore" });
  if (built.status !== 0) {
    console.error("the build failed");
    process.exit(1);
  }
}

mkdirSync(out, { recursive: true });
const lines = [];
let failed = 0;
for (const part of PARTS.filter((one) => only.length === 0 || only.includes(one.name))) {
  console.log(`=== ${part.name} (${look})`);
  const server = await startServer();
  try {
    const run = spawnSync(process.execPath, [here(part.script), ...part.args], {
      env: { ...process.env, UI: look, BASE: base, OUT: out, ...(flag("scan") ? { SCAN: "1" } : {}) },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const line of `${run.stdout ?? ""}\n${run.stderr ?? ""}`.split(/\r?\n/)) {
      if (/^(ok|FAIL|\d+ failed|accounts missing)/.test(line)) {
        console.log(line);
        lines.push(`${part.name}: ${line}`);
        if (line.startsWith("FAIL")) failed++;
      }
    }
    if (run.status !== 0) {
      lines.push(`${part.name}: exited with ${run.status}`);
      failed++;
    }
  } finally {
    stop(server);
  }
}
writeFileSync(`${out}/walk.log`, `${lines.join("\n")}\n`);
console.log(failed === 0 ? `done: every step of the walk worked (${out})` : `done: ${failed} step(s) failed, see ${out}/walk.log`);
process.exit(failed === 0 ? 0 : 1);
