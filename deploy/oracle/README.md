# The website on the Oracle box

Since 2026-11-07 the website runs on the Oracle box that also runs the video relay (`kino-relay.24-7.ro`), instead of on Render: the site,
its stream lookups and the relay are on one machine and one address, and the box's traffic allowance is the one that is used.

| What | Where |
| --- | --- |
| The site | `kino-web.service`, 127.0.0.1:8787, user `kino-web`, a checkout of `main` in `/opt/kino-web` |
| Settings and secrets | `/etc/kino-web.env` (root:kino-web, 640), the lines of `kino-web.env.example` with Render's values |
| Kept on `main` | `kino-web-update.timer` every 2 minutes runs `/opt/kino-tools/kino-web-update.sh`: install and build as Render's Build Command did, restart, and go back to the one before if `/api/health` does not answer within a minute (`journalctl -u kino-web-update`) |
| Addresses | Caddy (`/etc/caddy/Caddyfile`), the block below; `kino4tv.com` and `www` point at the box (IONOS), `kino.24-7.ro` too (FreeDNS, freedns.afraid.org: its form has a CAPTCHA, so the owner saves it) |
| Accounts | the same Postgres as before (`DATABASE_URL`). Only ONE running copy of the site may use it: Render's service stays suspended |

```
kino.24-7.ro, kino4tv.com {
	reverse_proxy 127.0.0.1:8787
}
www.kino4tv.com {
	redir https://kino4tv.com{uri} permanent
}
```

`www` is sent on to the plain address, as Render did: Google sign-in only knows `kino4tv.com` and `kino.24-7.ro` (`GOOGLE_REDIRECT_URIS`).

Install (as root, from this folder): `useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin kino-web`;
`git clone https://github.com/alexdespina361-sys/Kino.git /opt/kino-web`; `install -m 755 kino-web-update.sh /opt/kino-tools/`;
`install -m 644 kino-web.service kino-web-update.service kino-web-update.timer /etc/systemd/system/`; `/etc/kino-web.env` as above;
`systemctl daemon-reload`; `/opt/kino-tools/kino-web-update.sh --force`; `systemctl enable --now kino-web kino-web-update.timer`; the
Caddy block; `systemctl reload caddy`.

Back to Render: resume the Render service only after `systemctl disable --now kino-web kino-web-update.timer` (one copy on the database),
point the addresses at Render again (`kino4tv.com` A 216.24.57.1, `www` CNAME `kino-o78i.onrender.com`; `kino.24-7.ro` A 216.24.57.1
at FreeDNS), and take the block out of the Caddyfile (`/etc/caddy/Caddyfile.before-website` is the one from before).
