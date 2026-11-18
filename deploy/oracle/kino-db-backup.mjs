#!/usr/bin/env node
// A copy of the website's database once a night: everything of the site's own (the `public` schema: accounts, profiles, friends, chats,
// feedback, personal stickers, visits), as one `pg_dump` file a day in /var/backups/kino-db, readable by root alone. The last 14 are kept.
// A copy that cannot be read back is no copy: each is listed with `pg_restore --list` before it is kept. Run by kino-db-backup.timer, as root,
// with the website's own settings (/etc/kino-web.env); the database's certificate is checked against DATABASE_CA_FILE, as the website does.
// The address of the database never goes on a command line (where every user of the box could read it): it is handed to pg_dump in its env.
// Bringing one back: deploy/oracle/README.md, "Backups".
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.KINO_DB_BACKUP_DIR || "/var/backups/kino-db";
const keep = Number(process.env.KINO_DB_BACKUPS_KEEP) > 0 ? Number(process.env.KINO_DB_BACKUPS_KEEP) : 14;
const bin = process.env.PG_BIN || "/usr/lib/postgresql/17/bin";
const ca = process.env.DATABASE_CA_FILE;

if (!process.env.DATABASE_URL) {
  console.error("kino-db-backup: no DATABASE_URL: nothing to copy");
  process.exit(1);
}
const url = new URL(process.env.DATABASE_URL);
const env = {
  PATH: "/usr/bin:/bin",
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)) || "postgres",
  PGSSLMODE: ca ? "verify-full" : "require",
  ...(ca ? { PGSSLROOTCERT: ca } : {}),
  PGCONNECT_TIMEOUT: "20",
  PGAPPNAME: "kino-db-backup",
};

process.umask(0o077);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const name = `kino-${new Date().toISOString().slice(0, 10)}.dump`;
const part = join(dir, `${name}.part`);

const run = (command, args) => {
  const done = spawnSync(join(bin, command), args, { env, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 10 * 60_000 });
  if (done.status !== 0) {
    rmSync(part, { force: true });
    console.error(`kino-db-backup: ${command} failed (${done.status ?? done.signal}): ${(done.stderr || done.error?.message || "").trim().slice(0, 500)}`);
    process.exit(1);
  }
};
run("pg_dump", ["--format=custom", "--schema=public", "--no-owner", "--no-privileges", `--file=${part}`]);
run("pg_restore", ["--list", part]);
renameSync(part, join(dir, name));

const copies = readdirSync(dir)
  .filter((file) => /^kino-\d{4}-\d{2}-\d{2}\.dump$/.test(file))
  .sort()
  .reverse();
for (const old of copies.slice(keep)) rmSync(join(dir, old), { force: true });
const size = statSync(join(dir, name)).size;
console.log(`kino-db-backup: ${name}, ${(size / 1024).toFixed(0)} KB; ${Math.min(copies.length, keep)} kept in ${dir}`);
