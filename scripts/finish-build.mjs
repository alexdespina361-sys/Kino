// The last step of `pnpm build`. Vite builds into `dist/client.next`; this puts that build where the server reads it (`dist/client`) in one
// move, so a server that is running never has an empty folder under it while a build is made. The files of the build before (their names carry
// a hash of what is in them) are kept next to the new ones for one more build: a page that was opened before the deploy still finds the pieces
// it asks for later.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const next = path.join(root, "client.next");
const live = path.join(root, "client");
const old = path.join(root, "client.old");
const LIST = ".build-files.json";

if (!fs.existsSync(path.join(next, "index.html"))) {
  console.error("finish-build: there is no new build in dist/client.next");
  process.exit(1);
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
console.log(`finish-build: dist/client is the new build (${made.length} files, ${kept} kept from the build before)`);
