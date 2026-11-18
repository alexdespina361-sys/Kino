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

const PACKED = /\.(js|mjs|css|svg|json)$/;
const BEST_UP_TO = 512 * 1024;
try {
  os.setPriority(19);
} catch {
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

const made = fs.existsSync(path.join(next, "assets")) ? fs.readdirSync(path.join(next, "assets")) : [];
fs.writeFileSync(path.join(next, LIST), JSON.stringify(made));

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
}

fs.rmSync(old, { recursive: true, force: true });
try {
  if (fs.existsSync(live)) fs.renameSync(live, old);
  fs.renameSync(next, live);
} catch (error) {
  if (fs.existsSync(old) && !fs.existsSync(live)) fs.renameSync(old, live);
  fs.cpSync(next, live, { recursive: true, force: true });
  fs.rmSync(next, { recursive: true, force: true });
  console.warn(`finish-build: written over the old build (${error instanceof Error ? error.message : error})`);
}
fs.rmSync(old, { recursive: true, force: true });
console.log(`finish-build: dist/client is the new build (${made.length} files, ${packed} packed, ${kept} kept from the build before)`);
