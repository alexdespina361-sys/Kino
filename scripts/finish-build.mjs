// The last step of `pnpm build`. Vite builds into `dist/client.next`; this puts that build where the server reads it (`dist/client`) in one
// move, so a server that is running never has an empty folder under it while a build is made. The files of the build before (their names carry
// a hash of what is in them) are kept next to the new ones for one more build: a page that was opened before the deploy still finds the pieces
// it asks for later.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve("dist");
const next = path.join(root, "client.next");
const live = path.join(root, "client");
const old = path.join(root, "client.old");
const LIST = ".build-files.json";

if (!fs.existsSync(path.join(next, "index.html"))) {
  console.error("finish-build: there is no new build in dist/client.next");
  process.exit(1);
}

/** Each script and style the build made, packed once as tightly as brotli and gzip go, next to it (`name.js.br`, `name.js.gz`): the server sends a browser
 *  that takes one of those that file as it is (src/server/app.ts, `preCompressed`). Only when packing makes it smaller; nothing else (the models, wasm) is packed. */
const PACKED = /\.(js|mjs|css|svg|json)$/;
/** Brotli's best is slow on a big file (3.4 MB: 5.5 s on a PC, against 0.2 s a step lower for 15% more), and the box has one core, which the site
 *  shares while this runs: the best for what a screen loads first (all under this size), a step lower for the big ones that few pages load. */
const BEST_UP_TO = 512 * 1024;
// (And the packing gives way to the site that is running on the same machine: it is done when it is done.)
try {
  os.setPriority(19);
} catch {
  // (not allowed here: at the usual priority, then)
}
let packed = 0;
for (const name of fs.existsSync(path.join(next, "assets")) ? fs.readdirSync(path.join(next, "assets")) : []) {
  if (!PACKED.test(name)) continue;
  const file = path.join(next, "assets", name);
  const body = fs.readFileSync(file);
  if (body.length < 1024) continue;
  const brotli = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: body.length <= BEST_UP_TO ? 11 : 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
  const gzip = zlib.gzipSync(body, { level: 9 });
  if (brotli.length < body.length) fs.writeFileSync(`${file}.br`, brotli);
  if (gzip.length < body.length) fs.writeFileSync(`${file}.gz`, gzip);
  packed += 1;
}

/** The hashed files a build made itself (not the ones it kept from the build before it). */
const made = fs.existsSync(path.join(next, "assets")) ? fs.readdirSync(path.join(next, "assets")) : [];
fs.writeFileSync(path.join(next, LIST), JSON.stringify(made));

/** What the build before made itself: kept for one more build, and no longer than that. */
let kept = 0;
try {
  const before = JSON.parse(fs.readFileSync(path.join(live, LIST), "utf8"));
  for (const name of Array.isArray(before) ? before : []) {
    if (typeof name !== "string" || name !== path.basename(name)) continue;
    const from = path.join(live, "assets", name);
    const to = path.join(next, "assets", name);
    if (fs.existsSync(to) || !fs.existsSync(from)) continue;
    fs.copyFileSync(from, to);
    kept += 1;
  }
} catch {
  // The first build here, or a build from before this script: nothing to keep.
}

fs.rmSync(old, { recursive: true, force: true });
try {
  if (fs.existsSync(live)) fs.renameSync(live, old);
  fs.renameSync(next, live);
} catch (error) {
  // A folder that is held open (Windows, with a server reading from it) cannot be renamed: write the new build over it instead.
  if (fs.existsSync(old) && !fs.existsSync(live)) fs.renameSync(old, live);
  fs.cpSync(next, live, { recursive: true, force: true });
  fs.rmSync(next, { recursive: true, force: true });
  console.warn(`finish-build: written over the old build (${error instanceof Error ? error.message : error})`);
}
fs.rmSync(old, { recursive: true, force: true });
console.log(`finish-build: dist/client is the new build (${made.length} files, ${packed} packed, ${kept} kept from the build before)`);
