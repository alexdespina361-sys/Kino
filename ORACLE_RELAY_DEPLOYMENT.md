# Oracle relay deployment status

Verified 16 October 2026. The live Kino website is connected to the Oracle relay and extension-free Chromium playback has been verified.

- VM: `141.147.58.15`, Frankfurt, Arm, 1 OCPU; guest reports approximately 6 GB RAM.
- OS: Ubuntu 24.04.5 LTS. Runtime: official Node 24.22.0 Arm64 distribution, archive checksum verified; pnpm 11.2.2.
- DNS: `kino-relay.24-7.ro` A record resolves to the VM; no AAAA record was present.
- Relay: `/opt/kino-relay`, service `kino-stream-relay.service`, enabled at boot, running as the unprivileged `kino-relay` user, automatic restart on failure.
- Signing secret: root-only `/etc/kino-relay.env`; a protected local copy is under this PC's dedicated SSH-key directory. No secret is stored in this repository.
- Relay binds only to `127.0.0.1:8789`. Caddy 2.11.7 fronts it. The OS firewall allows TCP 80 and 443, and those rules were saved with netfilter-persistent.

## Verified playback

The VM's preflight fetched fresh IP-bound tokens, master/variant playlists and recognizable MPEG-TS samples (262,144 bytes per title) for LINK CLICK S1E1, Game of Thrones S1E1 and Fight Club, across three provider hosts.

A Chromium session with extensions disabled first played all three through the actual VM relay, accessed over a temporary SSH tunnel. Kino's HUD paused, sought forward 10 seconds and resumed each title. Rendered frame counts were 152, 162 and 155 respectively.

After Oracle ingress was opened, the same three titles passed again over public `https://kino-relay.24-7.ro`, without an SSH tunnel or extension. Rendered frame counts were 150, 162 and 164, with pause, 10-second seek and resume passing for each title. Every observed media response was HTTP 200, and all media requests used the public relay hostname. The local website's media proxy remained off with zero bytes and requests. The live Render website also reported zero proxy bytes/requests and video off when checked separately. Public relay playback is verified; production Render integration is still pending.

Screenshot: `output/playwright/verified-oracle-relay.png`. Public test results: `output/playwright/oracle-public-playback-cli.txt`. Temporary local website, test browser and SSH tunnel were stopped after verification. The VM relay remains running.

## Live integration verification

OCI ingress is now open. Caddy's public HTTPS configuration is installed and its certificate is trusted by the tested clients. HTTP redirects to HTTPS (308), `/health` returns 200 with the expected relay identity, and an unsigned `/api/proxy` request returns 403 `INVALID_RELAY_LINK`. Both Caddy and the relay are enabled at boot; the relay reported zero restarts.

The user updated Render's three environment entries and deployed the service. The live resolver returned signed Oracle links for all three LINK CLICK sources; each signature was verified against the relay's actual secret. `PROXY_VIDEO` remains `off`, and persistence remains Postgres. The exact Render entries are saved in the protected local file `C:\Users\Me\.ssh\kino-oracle-relay\render-relay.env`.

The live `https://kino.24-7.ro/tv` page was tested in Chromium with extensions disabled, without request interception or a local website server:

- LINK CLICK: 152 rendered frames, Kino HUD present, native controls off, pause / 10-second seek / resume passed. One canceled media request was recorded during playback operations; observed media response statuses were 200.
- Fight Club: 155 rendered frames; the same controls passed, with all observed media response statuses 200.
- Game of Thrones: one initial seek/resume check exceeded 30 seconds, accompanied by nonfatal HLS fragment parsing warnings. A fresh playback and separate control check passed: paused at 17.079 seconds, sought to 27.079, resumed at 28.893 with 470 rendered frames. Playback continued afterward. The initial stall's cause was not isolated; no unverified recovery change was deployed.
- Actual quality decoding was verified at 360p (frame height 360, time 181.007) and 720p (height 720, time 303.182).
- English subtitles loaded 641 cues and visibly rendered through Kino's caption overlay.
- Switching to Server 2 (quorumofquiddity) succeeded at the preserved playback position, with 74 rendered frames at 359.213 seconds and height 720. Video responses used the Oracle relay; the website response during this switch was the selected subtitle track (`/api/proxy`, `format=vtt`, 668 cues).

During the initial three-title test, Render's proxy counters stayed at exactly zero bytes and zero requests; the relay's byte counter increased from 206,667,611 to 356,918,793 (150,251,182 bytes). Selecting subtitles afterward produced two website subtitle requests totaling 91,885 bytes. This is subtitle text traffic, not video delivery. The last relay counter was 644,907,695 bytes and 825 requests; it includes the earlier deployment probes and subsequent extended checks, not just this test.

Evidence: `output/playwright/live-oracle-playback-result.json`, `live-oracle-caption-result-cli.txt`, `live-oracle-alternate-result-cli.txt`, `verified-live-oracle-relay.png`, and `verified-live-oracle-subtitles.png`. The initial timeout remains in the saved test result rather than being replaced by the successful recheck.

The test browser/controller were closed after verification. Oracle's relay and Caddy remain enabled and running. The friend's actual Fire TV / Hisense browser is still untested; no claim of universal browser/device compatibility or guaranteed free-tier uptime is made.

The full setup guide is [ORACLE_RELAY_ONBOARDING.md](ORACLE_RELAY_ONBOARDING.md). This deployment uses a native system service; the Docker image has not been built or used here.
