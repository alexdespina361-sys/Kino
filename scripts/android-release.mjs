#!/usr/bin/env node
/**
 * A new version of the Android app, out to everybody (docs/android-app.md): builds the signed APK with the next version, puts it and `android.json` in the
 * server's ANDROID_APP_DIR (the APK first, the file that names it last), and the server tells every copy of the app within a minute (push/appRelease.ts). That is
 * "the signal": each app downloads the APK, checks it, and installs it (without a tap where Android allows, else with one).
 *
 *   node scripts/android-release.mjs <versionCode> <versionName> ["what is new"] [--no-build] [--local <dir>]
 *
 * The box is named by KINO_BOX (`user@host`) and its key by KINO_BOX_SSH_KEY (and KINO_BOX_KNOWN_HOSTS); none of them is in the repository. `--local <dir>` writes the
 * two files into a folder instead (a server on this machine with ANDROID_APP_DIR=<dir>). The build needs JAVA_HOME (else ~/dev-tools/jdk-21) and the Android SDK
 * (android/local.properties, or ANDROID_HOME), and the signing key outside the repository (android/app/build.gradle says where).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

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

const android = path.join(root, "android");
const apk = path.join(android, "app", "build", "outputs", "apk", "release", "app-release.apk");

if (!noBuild) {
  const env = { ...process.env, JAVA_HOME: process.env.JAVA_HOME ?? path.join(homedir(), "dev-tools", "jdk-21") };
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  console.log(`Building version ${versionName} (${versionCode})...`);
  const built = spawnSync(gradlew, ["assembleRelease", `-PkinoVersionCode=${versionCode}`, `-PkinoVersionName=${versionName}`, "--console=plain", "-q"], {
    cwd: android,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (built.status !== 0) stop("The build failed.");
}
if (!existsSync(apk)) stop(`There is no APK at ${path.relative(root, apk)}.`);

const bytes = readFileSync(apk);
const file = `kino-${versionCode}.apk`;
const release = { versionCode, versionName, file, sha256: createHash("sha256").update(bytes).digest("hex"), size: statSync(apk).size, ...(notes ? { notes } : {}) };
console.log(`${file}: ${(release.size / 1024 / 1024).toFixed(1)} MB, sha256 ${release.sha256}`);

const staging = mkdtempSync(path.join(tmpdir(), "kino-release-"));
try {
  copyFileSync(apk, path.join(staging, file));
  writeFileSync(path.join(staging, "android.json"), `${JSON.stringify(release, null, 2)}\n`);
  if (local !== undefined) {
    if (!local) stop("--local needs a folder.");
    copyFileSync(path.join(staging, file), path.join(local, file));
    copyFileSync(path.join(staging, "android.json"), path.join(local, "android.json"));
    console.log(`Written to ${local}: the server there tells the apps within a minute.`);
  } else {
    const box = process.env.KINO_BOX;
    const key = process.env.KINO_BOX_SSH_KEY;
    if (!box || !key) stop("KINO_BOX (user@host) and KINO_BOX_SSH_KEY name the server and its key (see docs/android-app.md).");
    const ssh = ["-i", key, "-o", "BatchMode=yes", ...(process.env.KINO_BOX_KNOWN_HOSTS ? ["-o", `UserKnownHostsFile=${process.env.KINO_BOX_KNOWN_HOSTS}`] : [])];
    const run = (command, list) => {
      const done = spawnSync(command, list, { stdio: "inherit" });
      if (done.status !== 0) stop(`${command} failed.`);
    };
    run("scp", [...ssh, path.join(staging, file), path.join(staging, "android.json"), `${box}:/tmp/`]);
    // (The APK goes in first, then the file that names it: the server never offers an APK that is not all there.)
    const dir = "/var/lib/kino-web/app";
    run("ssh", [...ssh, box, `sudo install -d -o kino-web -g kino-web -m 755 ${dir} && sudo install -o kino-web -g kino-web -m 644 /tmp/${file} ${dir}/${file} && sudo install -o kino-web -g kino-web -m 644 /tmp/android.json ${dir}/android.json && rm -f /tmp/${file} /tmp/android.json`]);
    console.log(`On the box: the server tells every copy of the app within a minute. The newest is at /app/kino.apk.`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
