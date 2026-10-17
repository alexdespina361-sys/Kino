# Separate video relay for Kino

For account creation, free VM settings, the prepared public SSH key and what to send back, start with [ORACLE_RELAY_ONBOARDING.md](ORACLE_RELAY_ONBOARDING.md).

The current Oracle deployment and live browser verification are recorded in [ORACLE_RELAY_DEPLOYMENT.md](ORACLE_RELAY_DEPLOYMENT.md).

**Alternative for desktop viewers:** [Kino Direct Playback](extensions/kino-direct/README.md) now provides a verified extension route with
no relay hosting. The relay in this guide remains useful for browsers that cannot install the extension.

Kino serves the page, HUD and controls. A separate Node service serves video. Viewers need only a browser.

The existing Cloudflare Worker is **blocked by this upstream provider**. On 16 October 2026, both `/generate.php` and the logged master playlist returned an upstream Cloudflare 403 page identifying the Worker IP `2a06:98c0:3600::103`. Changing player libraries or nesting this Worker inside `/api/proxy` cannot fix that refusal. Cloudflare documents this [cross-zone Worker IP behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip).

The upstream token also contains `ip_cidr`. It must be obtained by the machine that fetches the media. The separate relay does this itself, caches until shortly before the token expires, and combines concurrent token requests. Kino signs links; it does not fetch the video or issue the relay's provider tokens.

## Deploy the relay

Use a separate host with an outbound IP the provider accepts. **Verify upstream access on that host before switching the website.** Playback is verified through this PC and the deployed Oracle VM; acceptance of another VPS IP still needs its own check. Do not deploy this Node service as a Cloudflare Worker.

For current free-host research, network sizing and the browser-only limitations, see [STREAMING_WITHOUT_EXTENSIONS.md](STREAMING_WITHOUT_EXTENSIONS.md).
With Node 22 or newer on the candidate machine, run `node scripts/check-stream-relay-host.mjs` before deploying. It checks that machine's token,
master, variant and a recognizable media sample for three titles without printing tokens. Passing is necessary, but does not establish browser
playback, sustained throughput or the provider's long-term availability.

The relay runs independently of the website, accounts and database:

```text
pnpm install --frozen-lockfile
pnpm relay
```

Set these environment variables on the relay host:

| Variable | Value |
| --- | --- |
| `STREAM_RELAY_KEY` | A randomly generated secret of at least 32 characters |
| `PORT` | The host's assigned port, or `8789` |
| `HOST` | `0.0.0.0` (the default) |

Generate a secret once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it in the hosts' environment settings, not source control or browser code.

A container definition is included:

```text
docker build -f Dockerfile.stream-relay -t kino-stream-relay .
docker run --env-file .env.stream-relay -p 8789:8789 kino-stream-relay
```

Put the service behind HTTPS. The public streaming endpoint is `https://YOUR-RELAY-HOST/api/proxy`; `/health` identifies it as `stream-relay` and reports requests and bytes. A naked, unsigned request to `/api/proxy` returning `403 INVALID_RELAY_LINK` is expected.

The Node service was tested directly. The container image has not been built in this workspace because Docker is unavailable.

## Connect Kino

Set these on the **website host**, then restart/redeploy it with the updated code:

| Variable | Value |
| --- | --- |
| `EDGE_STREAM_PROXY_URL` | `https://YOUR-RELAY-HOST/api/proxy` |
| `EDGE_STREAM_PROXY_KEY` | Exactly the same secret as the relay's `STREAM_RELAY_KEY` |
| `PROXY_VIDEO` | `off` |

Library adapters now issue signed relay links. For Filmpire streams the relay obtains its own token. Every variant, media piece, key, initialization file and playlist subtitle is rewritten back to the relay. The provider's required Referer is retained; the browser's Origin is not forwarded. HTTP errors retain their status and are not cached as successful media. Native HLS browsers also use the relay from the start.

The player no longer invents a fallback through the website when an external stream fails. A separate relay's `/api/proxy` path also does not trigger the website proxy's quality cap.

Signed links expire after 12 hours. The relay checks signatures and expiry, and blocks private-network destinations at DNS connection time, including redirects. New playback sessions obtain fresh links. Share the same secret between relay replicas, and ensure token issuance and media fetching have consistent outbound IPs. For the initial deployment, use a single relay instance.

## Verify after deployment

1. Open a movie in Kino. Confirm that video plays and Kino's pause, seek, quality and subtitle controls appear.
2. In browser Network, film playlists and segments must use the separate relay host. No video request should use `kino.24-7.ro/api/proxy`.
3. On the website's `/api/health`, `proxy.video` must be `off` and `proxy.bytes` must remain unchanged during playback. Subtitles can still use the website.
4. Pause, seek forward and resume. Try an alternate source and a TV episode too.

If the new host returns `UPSTREAM_TOKEN_FAILED` with HTTP 403, its IP is also rejected by the provider. Obtain provider permission or use a host whose IP passes the access check. The website's zero-video-bandwidth setting should remain off during troubleshooting.

## Verified in this workspace

On 16 October 2026, a local instance of the production Kino build used a separate instance of this relay to play the actual stream from the supplied console log in Chromium. The stream duration was 9,421 seconds; video frames decoded and rendered. Kino's own controls paused, sought forward 10 seconds and resumed. Native video controls stayed disabled.

The browser requested media only from the separate relay. The local website's health counters remained `bytes: 0`, `requests: 0`, `refused: 0`, `video: off`. This is local browser validation with a live upstream, **not a deployment to the public website**. Safari and Firefox were not runtime-tested.
