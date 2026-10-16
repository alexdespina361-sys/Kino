# Playback without viewer extensions: investigation, 16 October 2026

The practical route for keeping Kino's full HUD and leaving video off the website server is **one separately hosted relay**. Viewers then use an ordinary browser. Oracle Always Free is the strongest free hosting candidate found; it has capacity and idle-reclamation limitations, and its outbound IP has not been tested against this provider. No public relay has been deployed as part of this investigation.

The extension fix is already deployed on Kino. Version 1.1.0 is available as a ready-to-load folder at `output/playwright/TheExtension`. It handles rotating Filmpire video hosts automatically rather than maintaining a fixed hostname list.

## What was verified

| Check | Result |
| --- | --- |
| Extension 1.1.0, live Kino, LINK CLICK S1E1 | 152 video frames; Kino HUD; pause, +10-second seek, resume; HTTP 200 from `theorboofthorns.space` |
| Same, Game of Thrones S1E1 | 155 frames; same controls passed; HTTP 200 from `quorumofquiddity.site` |
| Same, Fight Club | 168 frames; same controls passed; HTTP 200 from `comityofcognomen.site` |
| Same, Hope | An initial resume check timed out. Independent recheck reached 161 frames and passed pause, seek and resume, with no browser errors or failed requests |
| Extension tests above | No Worker/relay requests; website proxy stayed at zero bytes/requests with video off |
| Clean Chromium profile, no extension | Token, master and variant readable; direct video fragments blocked by CORS |
| Same, `fetch(..., { mode: 'no-cors' })` | Opaque response, status 0, zero readable bytes |
| Same, native HLS public control stream | 63 frames, `readyState` 4, no media error |
| Same, native LINK CLICK HLS | Zero frames; media error 4; segment request failed with `net::ERR_BLOCKED_BY_ORB` |

These are short Chromium 156 checks on Windows. They are not a sustained playback or concurrency test, and Brave, Firefox and Safari were not runtime-tested. The original separate Node relay had already passed a local Chromium playback/control check; that proves this PC's connection works, not that a free cloud host works.

The live inventory found ten current CDN domains, plus the previously observed `diaphanousdogma.website`. The provider's own `player.js` states that its backend rotates hosts per request. A finite hostname list cannot cover future changes. Extension 1.1.0 therefore installs a host-specific session rule before preparing each `/pl/*.m3u8` source. HTTPS host permission is broad; content injection and rule initiators remain scoped to Kino. This handles the Filmpire token/playlist protocol; it is not a universal adapter for unrelated video sites.

## Why browser-only header tricks do not solve the current stream

There are separate checks at separate points:

1. **Token identity:** the provider token is tied to the requesting connection. The old website-issued token cannot simply be handed to another machine. An ordinary viewer browser successfully obtained its own fresh token during this investigation.
2. **Readable video data:** the playlists allow cross-origin reads, but the tested fragments do not. HLS.js needs those fragment bytes. A successful master request does not establish playable video.
3. **Native media loading:** this Chromium build supports native HLS, demonstrated by the control stream. The actual provider stream still fails at a fragment with ORB, followed by a native demuxer network-read failure.

Attempting to set `Origin: https://stellarconductornexus.com` in ordinary page JavaScript did not change the sent Origin; the browser sent Kino's origin. `referrerPolicy: 'no-referrer'` can suppress Referer but does not grant control over Origin. [MDN documents Origin as a forbidden request header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin).

`no-cors` removes JavaScript's access to the response body. A Service Worker, a Web Worker, WebAssembly, a blob URL or MediaSource cannot turn those unreadable bytes into readable HLS fragments. [MDN explains opaque responses and the server/proxy remedies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors).

The native result also matters: switching to `<video src>` is not an untested escape hatch here. The public control played; this provider failed. [Chromium's isolation documentation describes ORB as a browser-level response restriction](https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md).

## Viable architectures

| Approach | Viewer installs anything? | Website carries video? | Assessment |
| --- | --- | --- | --- |
| Separate Node relay on a VM | No | No | Preserves Kino's existing player and full HUD. Best match if the candidate IP passes the provider checks |
| Relay on one existing home PC/mini-PC | No | No | This connection passed upstream checks. Requires an always-on machine, adequate upload and public HTTPS reachability |
| Provider-authorized CORS/media integration | No | No | Best direct-delivery design, but requires provider cooperation: accepted Kino origin, usable fragment headers and viewer-issued tokens |
| Provider iframe controlled through its API | No | No | Possible for some providers, but not equivalent to the current full HUD without a reliable API and a supported way to hide provider controls |
| PWA or Service Worker alone | No | No | Does not supply extension privileges or repair CORS/ORB |
| Current Cloudflare Worker | No | No | Already returned upstream 403 from its own egress IP; a fresh website token does not fix that |

The currently inspected upstream player accepts play, pause, mute/unmute, integer seek and TV episode messages. No complete native-quality, subtitle, source-switching and hidden-controls contract was established. Earlier iframe overlays in this repository also produced conflicting controls and state synchronization problems. Reintroducing them without proving those missing capabilities would not meet the full-HUD requirement.

## Free hosting: actual fit for a few viewers

Checked against the providers' current first-party documentation:

| Host | Useful allowance/behavior | Limitation for this use |
| --- | --- | --- |
| **Oracle Always Free** | 10 TB outbound/month; currently 2 ARM OCPUs and 12 GB total RAM for Always Free tenancies | Best candidate. Capacity can be unavailable, idle instances can be reclaimed, and upstream acceptance of its IP is unknown. [Official resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| Northflank Sandbox | Two free services; advertised as always on without sleeping | Its docs say the free plan should not be used for production and require a payment method. A confirmed sustained-video free egress allowance was not found; standard egress pricing is $0.06/GB. [Pricing](https://northflank.com/pricing), [billing documentation](https://northflank.com/docs/v1/application/billing/pricing-on-northflank) |
| Render Free | 750 free instance-hours per workspace/month | Sleeps after 15 idle minutes; outbound quotas apply; may suspend unusually high service-initiated traffic. Poor match for a continuous video relay. [Free service limits](https://render.com/docs/free) |
| Koyeb Free | One free instance; 100 GB outbound/month is included in its published pricing FAQ | Sleeps after one idle hour and cannot disable this; free instance is intended for testing/hobby use. 100 GB is small for shared video. [Instance limits](https://www.koyeb.com/docs/reference/instances), [bandwidth pricing](https://www.koyeb.com/docs/faqs/pricing) |
| alwaysdata Free | Personal free hosting | Free-account restrictions include network-intensive applications and generic programs running continuously without user interaction. Not a sound basis for promising a permanent streaming relay. [Official restrictions](https://help.alwaysdata.com/en/docs/admin-billing/profile/suspension/) |

None of these checks establishes a guaranteed, permanently free 24/7 streaming service. Oracle is the closest fit worth testing, not a proven deployment. Older claims of 4 free ARM OCPUs/24 GB should not be used for a new Always Free tenancy; the current resource page lists 2/12.

For a home-hosted relay, direct HTTPS avoids another provider's video-transfer quota but depends on ISP reachability and upload capacity. **Tailscale Funnel** can publish a local HTTPS service to visitors who do not have Tailscale installed; it has non-configurable bandwidth limits, so throughput must be measured before choosing it. [Funnel documentation](https://tailscale.com/docs/features/tailscale-funnel).

Cloudflare Tunnel is not an unlimited free video-delivery substitute: Cloudflare explicitly applies its video-delivery restrictions to public Tunnel hostname routes on Free, Pro and Business. [Current video policy](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/).

## Bandwidth sizing

Planning estimates, in decimal GB, before protocol overhead, buffering and abandoned playback:

`GB = average Mbps × viewer-hours × 0.45`

| Usage | At 5 Mbps | At 8 Mbps |
| --- | ---: | ---: |
| One viewer-hour | 2.25 GB | 3.6 GB |
| Three viewers, 2 hours/day each, 30 days | 405 GB/month | 648 GB/month |
| Three simultaneous viewers | 15 Mbps outbound | 24 Mbps outbound |

A 100 GB quota is only about 44 viewer-hours at 5 Mbps. A modest compute allowance can run the relay, but its network allowance is the deciding factor. These are estimates, not measurements of every title; initial buffering can create larger bursts. This relay forwards bytes rather than transcoding video.

## Concrete deployment path

The independent relay, signed links, token refresh, playlist rewriting, Range handling and private-address protection already exist in this repository. See [STREAM_RELAY_SETUP.md](STREAM_RELAY_SETUP.md).

Before installing the whole stack on a candidate machine, run the added preflight script there with Node 22 or newer:

```text
node scripts/check-stream-relay-host.mjs
```

It resolves LINK CLICK, Game of Thrones and Fight Club, obtains **that machine's** fresh token, reads master and variant playlists, and checks a bounded video sample for MPEG-TS/fMP4 data. It prints hostnames and results without printing signed URLs or JWTs. A failed check exits nonzero. Optional arguments select other Kino source-page URLs.

On this PC, all ten freshly observed hosts returned recognizable MPEG-TS samples. Inception's host initially returned HTTP 429; a later check passed. This demonstrates why provider rate limits and alternate sources must also be tested, particularly when all viewers share one relay IP. The formerly observed `diaphanousdogma.website` was not present in this fresh title sample.

Then:

1. Obtain an Oracle Always Free VM, or identify an existing always-on machine with public HTTPS reachability. No new hosting account was created here.
2. Run the preflight **on that host**. If it fails, do not switch Kino to that relay.
3. Deploy one relay instance behind HTTPS, using the existing guide and a shared signing secret. Keep token generation and upstream requests on the same egress path.
4. Test an extension-free browser against that relay with Kino's HUD, pause, seek, subtitles and alternate sources. Run a longer session with the intended number of concurrent viewers.
5. Only after those checks, configure Kino's external relay endpoint and signing key; keep website video proxying off. Extension viewers can continue using direct delivery.

The remaining dependency is a candidate host/account and its access check. The browser limitation is reproduced, and the software path for shared delivery is already available; free public hosting and sustained playback remain unverified.
