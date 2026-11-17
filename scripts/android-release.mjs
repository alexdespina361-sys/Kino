#!/usr/bin/env node
/**
 * A new version of the Android app, out to everybody (docs/android-app.md): builds the signed APK with the next version, puts it and `android.json` in the
 * server's ANDROID_APP_DIR (the APK first, the file that names it last), and the server tells every copy of the app within a minute (push/appRelease.ts). That is
 * "the signal": each app downloads the APK, checks it, and installs it (without a tap where Android allows, else with one).
 *
 *   node scripts/android-release.mjs <versionCode> <versionName> ["what is new"] [--no-build] [--local <dir>]
 *
 * Before anything goes out, the APK is checked (the judge, 17 Nov): it is this app (`com.kino4tv.app`), of the version asked for, signed with the app's own key
 * (`CERT_SHA256`: a phone takes an update only from that key, and one signed otherwise would be offered to every phone and refused by each); and its version is
 * newer than the one the server offers (a version is never put out twice: its APK is never changed under a phone that is downloading it). Each file is written
 * beside its place and moved there in one step, so the server never reads half of one.
 *
 * The box is named by KINO_BOX (`user@host`) and its key by KINO_BOX_SSH_KEY (and KINO_BOX_KNOWN_HOSTS); none of them is in the repository. `--local <dir>` writes the
 * two files into a folder instead (a server on this machine with ANDROID_APP_DIR=<dir>). The build needs JAVA_HOME (else ~/dev-tools/jdk-21) and the Android SDK
 * (android/local.properties, or ANDROID_HOME), and the signing key outside the repository (android/app/build.gradle says where).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/** The SHA-256 of the certificate the app is signed with (public: every APK shows it). */
const CERT_SHA256 = "9aa594d5e6ea457c37a02ef753aec1f1f384fa7ac39541ced85630ad1daf3091";
const PACKAGE = "com.kino4tv.app";
const BOX_DIR = "/var/lib/kino-web/app";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const [, value] = args.splice(at, 2);
  return value ?? "";
};
const noBuild = args.includes("--no-build") ? (args.splice(args.indexOf("--no-build"), 1), true) : false;
const local = flag("--local");
const [codeText, versionName, notes] = args;
const versionCode = Number(codeText);

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (!Number.isInteger(versionCode) || versionCode < 1 || !/^[0-9A-Za-z.+-]{1,32}$/.test(versionName ?? "")) {
  stop('Usage: node scripts/android-release.mjs <versionCode> <versionName> ["what is new"] [--no-build] [--local <dir>]');
}
if (notes !== undefined && notes.length > 500) stop("What is new is 500 characters at most.");
if (local === "") stop("--local needs a folder.");

const android = path.join(root, "android");
const apk = path.join(android, "app", "build", "outputs", "apk", "release", "app-release.apk");
const javaHome = process.env.JAVA_HOME ?? path.join(homedir(), "dev-tools", "jdk-21");
const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${path.join(javaHome, "bin")}${path.delimiter}${process.env.PATH ?? ""}` };

/* ------------------------------ where the server is, and what it offers now ------------------------------ */

const box = process.env.KINO_BOX;
const key = process.env.KINO_BOX_SSH_KEY;
if (local === undefined && (!box || !key)) stop("KINO_BOX (user@host) and KINO_BOX_SSH_KEY name the server and its key (see docs/android-app.md).");
const ssh = key ? ["-i", key, "-o", "BatchMode=yes", ...(process.env.KINO_BOX_KNOWN_HOSTS ? ["-o", `UserKnownHostsFile=${process.env.KINO_BOX_KNOWN_HOSTS}`] : [])] : [];
const run = (command, list, options = {}) => {
  const done = spawnSync(command, list, { stdio: "inherit", ...options });
  if (done.status !== 0) stop(`${command} failed.`);
  return done;
};

/** The version the server offers now (0 for none). */
function offeredNow() {
  let text = "";
  if (local !== undefined) text = existsSync(path.join(local, "android.json")) ? readFileSync(path.join(local, "android.json"), "utf8") : "";
  else text = run("ssh", [...ssh, box, `sudo cat ${BOX_DIR}/android.json 2>/dev/null || true`], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }).stdout;
  if (!text.trim()) return 0;
  let said;
  try {
    said = JSON.parse(text);
  } catch {
    // (thrown, not stopped: the lock held around a release is let go first, the judge, 17 Nov)
    throw new Error("The server's android.json is not readable: look at it before putting out another version.");
  }
  return Number.isInteger(said.versionCode) ? said.versionCode : 0;
}
let now = 0;
try {
  now = offeredNow();
} catch (error) {
  stop(error.message);
}
if (versionCode <= now) stop(`The server offers version ${now} already: the new one has to be newer (a phone takes no older one, and a version is put out once).`);

/* ------------------------------ the APK ------------------------------ */

if (!noBuild) {
  // (By its path: a Windows shell with NoDefaultCurrentDirectoryInExePath set finds no program in the folder it is in.)
  const gradlew = process.platform === "win32" ? ".\\gradlew.bat" : "./gradlew";
  console.log(`Building version ${versionName} (${versionCode})...`);
  run(gradlew, ["assembleRelease", `-PkinoVersionCode=${versionCode}`, `-PkinoVersionName=${versionName}`, "--console=plain", "-q"], { cwd: android, env, shell: process.platform === "win32" });
}
if (!existsSync(apk)) stop(`There is no APK at ${path.relative(root, apk)}.`);

/** The Android SDK's newest build tools (aapt2, apksigner). */
function buildTools() {
  let sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const properties = path.join(android, "local.properties");
  if (!sdk && existsSync(properties)) sdk = /^sdk\.dir=(.*)$/m.exec(readFileSync(properties, "utf8"))?.[1]?.replace(/\\(.)/g, "$1").trim();
  if (!sdk) stop("The Android SDK is not found (ANDROID_HOME, or sdk.dir in android/local.properties).");
  const versions = readdirSync(path.join(sdk, "build-tools")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (versions.length === 0) stop("The Android SDK has no build tools.");
  return path.join(sdk, "build-tools", versions.at(-1));
}
const tools = buildTools();
const windows = process.platform === "win32";
const said = (command, list) => {
  const done = spawnSync(command, list, { env, encoding: "utf8", shell: windows && command.endsWith(".bat") });
  if (done.status !== 0) stop(`${path.basename(command)} could not read the APK:\n${done.stderr}`);
  return done.stdout;
};
const badging = said(path.join(tools, windows ? "aapt2.exe" : "aapt2"), ["dump", "badging", apk]);
const head = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m.exec(badging);
if (!head) stop("The APK says no package.");
if (head[1] !== PACKAGE) stop(`The APK is ${head[1]}, not ${PACKAGE}.`);
if (Number(head[2]) !== versionCode || head[3] !== versionName) stop(`The APK is version ${head[3]} (${head[2]}), not ${versionName} (${versionCode}): build it again (or leave out --no-build).`);
const certs = said(path.join(tools, windows ? "apksigner.bat" : "apksigner"), ["verify", "--print-certs", apk]);
const digests = [...certs.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/g)].map((match) => match[1]);
if (digests.length !== 1 || digests[0] !== CERT_SHA256) stop(`The APK is not signed with the app's own key (it says ${digests.join(", ") || "none"}): a phone would refuse it.`);
console.log(`Checked: ${PACKAGE} ${versionName} (${versionCode}), signed with the app's key.`);

const bytes = readFileSync(apk);
const file = `kino-${versionCode}.apk`;
const release = { versionCode, versionName, file, sha256: createHash("sha256").update(bytes).digest("hex"), size: statSync(apk).size, ...(notes ? { notes } : {}) };
console.log(`${file}: ${(release.size / 1024 / 1024).toFixed(1)} MB, sha256 ${release.sha256}`);

/* ------------------------------ out ------------------------------ */

const staging = mkdtempSync(path.join(tmpdir(), "kino-release-"));
try {
  copyFileSync(apk, path.join(staging, file));
  writeFileSync(path.join(staging, "android.json"), `${JSON.stringify(release, null, 2)}\n`);
  // (Two releases at once (the judge, 17 Nov): each holds the folder's lock while it looks again at what is offered and puts its files there, so a later
  // one never puts back an older version; each writes its own files beside their places, never another's.)
  const stamp = `kino-release-${process.pid}-${Date.now()}`;
  if (local !== undefined) {
    const lock = path.join(local, ".release.lock");
    let held;
    try {
      held = openSync(lock, "wx");
    } catch {
      stop(`Another release is being put out into ${local} (or one stopped half way: then remove ${lock}).`);
    }
    try {
      const offered = offeredNow();
      if (versionCode <= offered) throw new Error(`The server offers version ${offered} now: the new one has to be newer.`);
      // (Each beside its place, then moved there: the APK first.)
      for (const name of [file, "android.json"]) {
        copyFileSync(path.join(staging, name), path.join(local, `.${name}.${stamp}.part`));
        renameSync(path.join(local, `.${name}.${stamp}.part`), path.join(local, name));
      }
    } catch (error) {
      closeSync(held);
      rmSync(lock, { force: true });
      stop(error.message);
    }
    closeSync(held);
    rmSync(lock, { force: true });
    console.log(`Written to ${local}: the server there tells the apps within a minute.`);
  } else {
    run("scp", [...ssh, path.join(staging, file), `${box}:/tmp/${stamp}-${file}`]);
    run("scp", [...ssh, path.join(staging, "android.json"), `${box}:/tmp/${stamp}-android.json`]);
    // (Each is written beside its place and moved there in one step, the APK first: the server never offers an APK that is not all there. All of it under the
    // folder's lock, after looking again at the version offered.)
    const place = (name) => `install -o kino-web -g kino-web -m 644 /tmp/${stamp}-${name} ${BOX_DIR}/.${name}.${stamp}.part && mv -f ${BOX_DIR}/.${name}.${stamp}.part ${BOX_DIR}/${name}`;
    const offered = `$(grep -o '"versionCode": *[0-9]*' ${BOX_DIR}/android.json 2>/dev/null | grep -o '[0-9]*$')`;
    const locked = `now=${offered}; if [ "\${now:-0}" -ge ${versionCode} ]; then echo "The server offers version \${now} now: the new one has to be newer." >&2; exit 3; fi; ${place(file)} && ${place("android.json")}`;
    run("ssh", [
      ...ssh,
      box,
      `sudo install -d -o kino-web -g kino-web -m 755 ${BOX_DIR} && sudo flock ${BOX_DIR}/.release.lock sh -c '${locked.replace(/'/g, `'\\''`)}'; status=$?; rm -f /tmp/${stamp}-${file} /tmp/${stamp}-android.json; exit $status`,
    ]);
    console.log(`On the box: the server tells every copy of the app within a minute. The newest is at /app/kino.apk.`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
