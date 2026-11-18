# The website on the Oracle box

Since 2026-11-07 the website runs on the Oracle box that also runs the video relay (`kino-relay.24-7.ro`), instead of on Render: the site,
its stream lookups and the relay are on one machine and one address, and the box's traffic allowance is the one that is used.

| What | Where |
| --- | --- |
| The site | `kino-web.service`, 127.0.0.1:8787, user `kino-web`, a checkout of `main` in `/opt/kino-web` |
| Settings and secrets | `/etc/kino-web.env` (root:kino-web, 640), the lines of `kino-web.env.example` with Render's values |
| Kept on `main` | `kino-web-update.timer` every 2 minutes runs `/opt/kino-tools/kino-web-update.sh`: install and build as Render's Build Command did, restart, and go back to the one before if `/api/health` does not answer within a minute (`journalctl -u kino-web-update`) |
| The built pages | `dist/client` is made on the box by `pnpm build` and is not in the repository. The build is made next to the running one (`dist/client.next`) and moved into place in one step (`scripts/finish-build.mjs`), with the hashed files of the build before kept for one more build |
| Addresses | Caddy (`/etc/caddy/Caddyfile`), the block below; `kino4tv.com` and `www` point at the box (IONOS), `kino.24-7.ro` too (FreeDNS, freedns.afraid.org: its form has a CAPTCHA, so the owner saves it). Since 18 Nov 2026 the old address only sends people on to `kino4tv.com` (`/etc/caddy/Caddyfile.before-redirect-20261118` is the one from before) |
| The database's certificate | `DATABASE_CA_FILE=/etc/kino-web/supabase-ca-2021.crt` (Supabase's root, `prod-ca-2021.crt`, 644): the site and the backups talk to the database only if it shows a certificate of that root for its own name |
| Backups | `kino-db-backup.timer`, every night at 03:30 UTC: a `pg_dump` of the database into `/var/backups/kino-db` (root only), 14 kept. See below |
| Accounts | the same Postgres as before (`DATABASE_URL`). Only ONE running copy of the site may use it: Render's service stays suspended |

```
kino4tv.com {
	reverse_proxy 127.0.0.1:8787
}
www.kino4tv.com {
	redir https://kino4tv.com{uri} permanent
}
kino.24-7.ro {
	redir https://kino4tv.com{uri} 308
}
```

`www` and the old address are sent on to the plain one: Google sign-in knows `kino4tv.com` (and `kino.24-7.ro`, which is no longer reached).
`kino-relay.24-7.ro` (the relay, and the 2011 TV's door) is a block of its own and is not sent anywhere.

Install (as root, from this folder): `useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin kino-web`;
`git clone https://github.com/alexdespina361-sys/Kino.git /opt/kino-web`; `install -m 755 kino-web-update.sh /opt/kino-tools/`;
`install -m 644 kino-web.service kino-web-update.service kino-web-update.timer /etc/systemd/system/`; `/etc/kino-web.env` as above;
`systemctl daemon-reload`; `/opt/kino-tools/kino-web-update.sh --force`; `systemctl enable --now kino-web kino-web-update.timer`; the
Caddy block; `systemctl reload caddy`.

## Backups

`kino-db-backup.mjs` (in `/opt/kino-tools/`), `kino-db-backup.service` and `kino-db-backup.timer` (in `/etc/systemd/system/`; `systemctl
enable --now kino-db-backup.timer`). It needs PostgreSQL's own client of the database's version (17: `postgresql-client-17` from
apt.postgresql.org, as Ubuntu's is 16). Every night the tables of the `public` schema (accounts, chats, feedback, stickers, timings) go to
`/var/backups/kino-db/kino-YYYY-MM-DD.dump`, made as `.part` and named only once `pg_restore --list` reads it. 14 are kept. They hold
everyone's accounts (password hashes too): root only, never copied off the box without the owner's word. The database at Supabase is the
original; this is the copy for a mistake or a lost project. `journalctl -u kino-db-backup` says what each night did; `systemctl start
kino-db-backup` makes one now. `/var/lib/kino-web` (the site's own files) has no copy anywhere else.

Back (as root): stop the site (`systemctl stop kino-web kino-web-update.timer`), then `PGSSLMODE=verify-full
PGSSLROOTCERT=/etc/kino-web/supabase-ca-2021.crt /usr/lib/postgresql/17/bin/pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL"
/var/backups/kino-db/kino-YYYY-MM-DD.dump`, and start it again. Everything written after that night is lost: try a single table first
(`-t kino_docs`) when only that is wrong.

## Back to Render

Resume the Render service only after `systemctl disable --now kino-web kino-web-update.timer` (one copy on the database),
point the addresses at Render again (`kino4tv.com` A 216.24.57.1, `www` CNAME `kino-o78i.onrender.com`; `kino.24-7.ro` A 216.24.57.1
at FreeDNS), and take the block out of the Caddyfile (`/etc/caddy/Caddyfile.before-website` is the one from before).
