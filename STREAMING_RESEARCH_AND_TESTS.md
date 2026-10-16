# Kino Streaming Research, Implementation, and Test Log

**Current result, 16 October 2026:** the [Kino Direct Playback extension](extensions/kino-direct/README.md) played the live source in Chromium
with Kino's HUD, pause, seek and resume, with no relay and no website video traffic. The companion website update must be present on the
server; installing the extension alone cannot upgrade an older website build. For browsers without extensions, the Cloudflare Worker remains rejected. The separate Node relay described in
[STREAM_RELAY_SETUP.md](STREAM_RELAY_SETUP.md) played the original live stream in Chromium with Kino's HUD, pause, seek and resume;
the local website carried zero video requests and zero video bytes. Public deployment still requires a reachable relay host.
Earlier test entries below are historical and include approaches later reverted.

## 16 October 2026: rotating-host extension 1.1.0 deployed and verified

- The enabled 1.0.0 extension missed LINK CLICK's `theorboofthorns.space` host. Current resolver output also revealed different domains for
  Game of Thrones, Fight Club, Inception, Interstellar and other titles. The live upstream player explicitly describes backend host rotation.
- Replaced the two-domain allowlist with per-host session rules installed before playback. The extension now requests HTTPS host access,
  while content injection and header-rule initiators remain limited to Kino. Rules target only a prepared public DNS hostname; private/local
  names, IP literals, credentials, arbitrary fetch paths and non-HTTPS sources are rejected. The viewer obtains the fresh provider token.
- Deployed commit `a5e8eaf`; live browser entry `index-CSkbyXer.js` and TV chunk `Tv-CfCfJpt4.js`. The exact production package was loaded
  from `output/playwright/TheExtension`, version **1.1.0**, in an isolated Chromium profile.
- Live-site LINK CLICK S1E1, Game of Thrones S1E1 and Fight Club rendered 152, 155 and 168 frames respectively. All passed pause, exactly
  10 seconds of seeking, and resume. Their respective media hosts were `theorboofthorns.space`, `quorumofquiddity.site` and `comityofcognomen.site`;
  media responses were HTTP 200. Relay requests were empty, and the website proxy remained at zero requests/bytes with video off.
- Hope's first resume check timed out. An independent recheck rendered 161 frames and passed play, pause, seek and resume with no browser errors
  or failed requests. These were short checks, not a sustained-playback validation. Brave itself was not runtime-tested.
- Validation: **75 test files, 1,452 tests passing**, TypeScript check and production build. New tests execute the actual distributed worker,
  cover every observed hostname and a future host, concurrent rule/token preparation, caller/source rejection and installation failure recovery.
- The ready-to-load folder and versioned ZIP are both available under `output/playwright`. No extension was installed in the user's existing profile.
- Follow-up: [investigation without viewer extensions](STREAMING_WITHOUT_EXTENSIONS.md) includes clean-browser CORS/ORB reproductions,
  current free-host limitations, bandwidth sizing and an executable candidate-host probe. A public relay is not yet provisioned.

## 16 October 2026: verified extension route, no hosted video relay

- Confirmed that background `fetch` with explicit extension host permissions sends neither Origin nor Referer on the tested GET requests.
  A control request from an ordinary page included its Origin. The background process obtained a fresh token, master, variant and 292,152-byte
  video segment, all HTTP 200.
- Independently tested Manifest V3 declarative rules removing Origin **and** Referer and setting readable CORS response headers. Ordinary page
  fetches then read the live master, variant and segment successfully, all HTTP 200. This supersedes the broad failure conclusion in historical Test 5:
  an Origin-removal-only attempt does not establish that this complete extension arrangement is impossible.
- Added `extensions/kino-direct`, restricted to Kino and the two current provider domains. It prepares viewer-IP tokens; the website's HLS.js
  fetches media directly under the scoped header rules. The player detects the extension and bypasses its selected relay using the raw stream address.
- Full browser check: normal `PLAY_URL`/Filmpire resolution, 153 decoded/rendered frames, Kino HUD visible, native controls disabled, pause,
  a 10-second seek, and resume. Only `farragoandfulcrum.website` received media requests, all HTTP 200. Relay requests were empty; the local
  website reported `bytes: 0, requests: 0, refused: 0, video: off`. No relay process was running.
- The test used Chromium 156 and an isolated profile. A development copy added localhost to the extension's site permissions; the packaged
  extension contains only the production Kino origin. Brave was not runtime-tested.
- Validation: **74 test files, 1,432 passing tests**, TypeScript check and production build. Tests include spoofed helper responses, substituted
  source rejection, timeout, provider errors and preventing late token responses from replacing a newer movie.
- Free hosting research: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) includes
  VM resources and 10 TB outbound/month but can reclaim idle VMs. [Render Free](https://render.com/docs/free) and [Koyeb Free](https://www.koyeb.com/docs/run-and-scale/scale-to-zero)
  sleep on inactivity. These are not guarantees of uninterrupted free hosting. The accepted extension route removes that hosting requirement.
- Remaining rollout step: deploy the companion website update and install the extension once on each playback browser. No public deployment
  or installation into the user's existing browser profile was performed during these tests.

## 16 October 2026: separate Node relay and verified Chromium playback

- Reproduced both logged Cloudflare Worker master requests and a fresh-token request returning HTTP 403. The body was an upstream block
  page showing Worker IP `2a06:98c0:3600::103`. The Worker added CORS headers but could not make the upstream accept its requests.
- The logged JWT contains `ip_cidr: 74.220.51.0/24`. The website previously issued it and handed it to a different machine, the Worker.
  This is a separate token/egress mismatch in the architecture; the live Worker block prevents establishing which check rejected the original token.
- Removed the player's automatic fallback that nested the Worker URL inside the website's `/api/proxy`. Native playback also stays on a
  separate relay, and the website's 720p bandwidth cap is applied only to its own proxy origin.
- Added `pnpm relay`, an independent Node service, with expiring HMAC links, private-address/DNS/redirect protection, Range support and HLS
  resource rewriting. It obtains and refreshes IP-bound upstream tokens itself. Filmpire skips website token generation when the signed relay is configured.
- Verified the normal `/api/resolve` path for `https://filmpire.sc/watch/1058424`: success via Filmpire, a signed relay stream with
  `hostToken=1`, two alternate sources and 50 subtitles. The freshly resolved master, variant and video segment all returned HTTP 200;
  the segment contained 292,152 bytes.
- In real Chromium, the original live video rendered 124 frames in the first five seconds (duration 9,421 seconds). Kino's own HUD was
  present, native video controls were disabled, and Kino controls paused, sought exactly 10 seconds and resumed playback.
- The browser requested media only from the separate local relay. The local website's health counters stayed at zero proxy bytes,
  zero proxy requests and zero refused requests, with video off.
- Validation: **73 test files, 1,422 passing tests**, TypeScript check and production build. Safari/Firefox were not runtime-tested.
- Deployment status: source, production browser build, Dockerfile and [setup guide](STREAM_RELAY_SETUP.md) are prepared locally. The public
  website and deployed Cloudflare Worker were not changed. A separate reachable host and matching server-side keys are still required.

This document tracks all investigations, hypotheses, implementations, empirical tests, and results for achieving native streaming with Kino's custom HUD on `https://kino.24-7.ro/`.

---

## 1. System Constraints & Goals
- **Goal**: Full custom HUD (play/pause, seekbar, time remaining, title, audio/subtitles, next episode, watch party sync) for any visitor on `https://kino.24-7.ro/`.
- **Target Browsers**: Desktop Chromium (Brave, Chrome, Edge) on Windows/macOS/Linux, plus Safari/Firefox.
- **Client Requirement**: 100% automated in the browser, zero local setup (no localhost proxies, no manual extension installs required for standard users).
- **Server Constraint**: Render server bandwidth must strictly remain **0 bytes** (`video: "off"`).

---

## 2. Completed Tests & Empirical Results Log

### Test 1: Cloudflare Worker Proxy (`kino-stream-edge.workers.dev`)
- **Hypothesis**: Route upstream HLS requests through a Cloudflare Worker to strip `Origin` and inject `Access-Control-Allow-Origin: *`.
- **Implementation**: Deployed `kino-stream-edge.alexdespina361.workers.dev` to proxy `/pl/` and `/content/` paths.
- **Result**: **FAILED (403 / Cloudflare Error 1020)**.
- **Root Cause**: Upstream CDN (`farragoandfulcrum.website` / `diaphanousdogma.website`) is protected by Cloudflare WAF, which blocks requests originating from Cloudflare Workers' datacenter IP subnet (`2a06:98c0:3600::/32`).

### Test 2: Native `<video src="...master.m3u8">` on Desktop Brave/Chromium
- **Hypothesis**: Bypass MSE/CORS by letting native HTML5 video element fetch segments in `no-cors` mode.
- **Implementation**: Set `<video src="https://.../master.m3u8">` directly on desktop Brave `v155.1.97.57`.
- **Result**: **FAILED (`MEDIA_ERR_SRC_NOT_SUPPORTED`, code 4)**.
- **Root Cause**: Desktop Chromium on Windows lacks built-in MPEG-TS demuxers and native HLS decoding. Only Safari (macOS/iOS) and Android Chromium support native HLS. Desktop Windows Chromium requires MSE (HLS.js).

### Test 3: Upstream Residential Token Generation (`generate.php`)
- **Hypothesis**: Fetch valid upstream JWT token directly from the user's browser using residential IP.
- **Implementation**: Implemented client-side token caching with `TOKEN_TTL_MS = (2 * 60 * 60 + 50) * 1000` (2h 50s) and in-flight request deduplication in `src/client/tv/engine.ts`.
- **Result**: **SUCCESS**.
- **Outcome**: Bypassed Nginx 1-per-10s rate limiter on `generate.php`. Upstream JWT token with `ip_cidr` matching user's IP (e.g. `86.127.88.0/24`) is successfully acquired and cached. Master and level playlists load with `200 OK`.

### Test 4: Segment-Level Origin Header Inspection (`page-N.html`)
- **Hypothesis**: Does the CDN block requests based on `Origin` or `Referer`?
- **Implementation**: Executed curl tests from residential IP (`86.127.88.125`):
  1. No `Origin` header $\rightarrow$ **`200 OK`** (579 KB video chunk downloaded in 3s).
  2. `Origin: https://stellarconductornexus.com` (embed partner) $\rightarrow$ **`200 OK`**.
  3. `Origin: https://nextgencloudfabric.com` $\rightarrow$ **`200 OK`**.
  4. `Origin: https://diaphanousdogma.website` (same origin) $\rightarrow$ **`200 OK`**.
  5. `Origin: https://kino.24-7.ro` $\rightarrow$ **`403 Forbidden`** (`Server: cloudflare`, `CF-RAY`).
  6. `Origin: null` $\rightarrow$ **`403 Forbidden`**.
- **Result**: **VERIFIED ROOT CAUSE**.
- **Outcome**: The upstream CDN explicitly allows requests with NO `Origin` or with its partner embed domains. Browser C++ network stack forces `Origin: https://kino.24-7.ro` on all JavaScript XHR/fetch requests, causing Cloudflare WAF to drop them.

### Test 5: MV3 DeclarativeNetRequest (DNR) Origin Stripping
- **Hypothesis**: Use a Chrome extension DNR rule to strip the `Origin` header from client requests.
- **Implementation**: Tested MV3 extension with `declarativeNetRequest` `removeHeaders: ["origin"]`.
- **Result**: **FAILED**.
- **Root Cause**: Chromium's network service restricts stripping the `Origin` header on webpage fetch requests initiated by non-extension origins.

### Test 6: Multi-Provider Scraper Extraction & Direct Media Analysis
- **Hypothesis**: Query alternative streaming APIs (VidLink, Videasy, Cinejoy, Vidcore) to find direct MP4/HLS streams that do not block `Origin: https://kino.24-7.ro`.
- **Findings**:
  1. **VidLink API (`https://vidlink.pro/api/b/...`)**: Returns direct MP4 qualities (360p, 480p, 1080p) hosted on `bcdn.hakunaymatata.com`. However, the response sets `requiresProxy: true`, and the CDN rate-limits direct browser requests (`429 Too Many Requests`) unless routed through high-bandwidth backend proxies (which violates our 0 bytes bandwidth constraint).
  2. **Videasy (`https://api.wecollege.net/...`)**: Returns HLS streams hosted on `moon.zenoak.top`. The CDN returns `200 OK` only when `Referer: https://player.videasy.to/` is sent. When `Referer: https://kino.24-7.ro/` or no referer is sent, it returns `403 Forbidden`.
  3. **Vidcore (`https://vidcore.io/...`)**: Protected by Cloudflare bot protection / TLS fingerprinting, returning 403 to standard HTTP clients.

### Test 7: VidLink Embedded Player Event Protocol & Bidirectional HUD Synchronization
- **Hypothesis**: Embed VidLink inside an `<iframe>` under `https://vidlink.pro` (which runs without CORS/WAF origin blocks because requests originate from `vidlink.pro`), and mount Kino's native `<Hud />` directly over the player by synchronizing via `window.postMessage`.
- **Reverse Engineering**:
  - Investigated VidLink client bundle (`1380-c3a72f07e0aaddeb.js`).
  - Verified outbound `window.parent.postMessage` schema:
    ```json
    {
      "type": "PLAYER_EVENT",
      "data": {
        "event": "play" | "pause" | "seeked" | "ended" | "timeupdate",
        "currentTime": 45.21,
        "duration": 3600.0,
        "mediaType": "movie" | "tv",
        "season": 1,
        "episode": 1
      }
    }
    ```
  - Identified supported player customization query params:
    - `title=false`: hides Vidlink's title bar
    - `autoplay=true`: starts playback automatically
    - `nextbutton=false`: hides Vidlink's next button so Kino controls navigation
    - `primaryColor=E50914`: matches Kino's Netflix-red brand color
- **Implementation**:
  1. **Server (`filmpire.ts`)**: Formats VidLink embed URLs:
     - Movie: `https://vidlink.pro/movie/${id}?title=false&autoplay=true&nextbutton=false&primaryColor=E50914`
     - TV: `https://vidlink.pro/tv/${id}/${s}/${e}?title=false&autoplay=true&nextbutton=false&primaryColor=E50914`
     - Fallback: AutoEmbed (`https://player.autoembed.co/...`)
  2. **Client State Synchronization (`Tv.tsx`)**:
     - Added global `window.addEventListener("message", handleMessage)`.
     - Handles `PLAYER_EVENT`: updates `player.currentTime`, `player.duration`, and `player.state` (`playing` vs `paused`).
     - Triggers `setEnded(true)` and launches the 15-second Up Next countdown card when `event === "ended"`.
     - Automatically persists watch history via `profileStore.playbackAt(currentMedia, player)`.
  3. **Bidirectional Control**:
     - `onToggle`: dispatches `{ method: "play" | "pause" }` postMessage to `iframeRef.current`.
     - `onSeekTo` & `onSkip`: dispatches `{ method: "seek", value: targetTime }` postMessage to `iframeRef.current`.
     - `onStop`: smoothly returns to Kino library.
     - `onNext`: triggers next episode transition with series metadata.
  4. **Seamless HUD Overlay (`tv.css` & `Hud.tsx`)**:
     - Rendered full native `<Hud />` over the embed iframe.
     - Sized with `pointer-events: none` on `.tv-overlay[data-embed="true"]` so video clicks pass through to the player, while `.hud-top`, `.hud-bottom`, `.hud-center button`, and `.hud-upnext` have `pointer-events: auto` for interactive seekbar and controls.
     - Added dedicated "Back to Library" button in `hud-top`.
  5. **Instant WAF Failover**:
     - When direct stream fails with `PlayerError.NotDirectlyPlayable` (due to Cloudflare Origin blocks on segments), `Tv.tsx` immediately transitions to the embed player (`setEmbedActive(true)`) instead of wasting time cycling through redundant failing servers.
- **Result**: **PARTIALLY WORKED (Upstream Provider Glitch on movie 169)**.
- **Root Cause Analysis (Movie 169)**:
  1. Direct HLS failed on fragment CORS (`Fragment loading blocked (WAF/CORS 403), falling back immediately`) as expected.
  2. Kino cleanly transitioned to embed mode and loaded VidLink.
  3. VidLink displayed the movie backdrop/first frame, but then failed internally because its upstream DASH manifest on `noon.mooncase.online` was blocked by CORS (`from origin 'https://vidlink.pro' has been blocked by CORS policy`).
  4. Adblockers on the client blocked VidLink tracker scripts (`ERR_BLOCKED_BY_CLIENT`).
  5. The single hardcoded embed URL left the player with no failover path when VidLink glitched.
  6. In Kino's HUD, `player.state` was not cleared of the previous direct HLS error, causing `useBusy` to keep controls sticky and render error markers.

---

### Test 8: Resilient Multi-Provider Embed Architecture, Cloudflare Partner Domain Bypass & Watchdog Failover
- **Hypothesis**: Provide a prioritized, multi-provider embed cascade (AutoEmbed, VidLink with JWPlayer and fallback_url, SmashyStream/AnyEmbed, 2Embed, VidSrc.to) with an automated 7-second watchdog failover and 1-click manual Source menu switching inside Kino's custom HUD.
- **Technical Discoveries**:
  1. **AutoEmbed (`https://player.autoembed.co/embed/...`)**:
     - Embeds `https://nextgencloudfabric.com/embed/...`.
     - `nextgencloudfabric.com` is the official upstream CDN partner domain. From Test 4, requests originating from `https://nextgencloudfabric.com` return **`200 OK`** without CORS blocks.
     - Resolves Cloudflare Turnstile invisibly in the browser background without user intervention.
     - Automatically forwards all postMessage events to `window.parent`.
     - Does not vendor aggressive `disable-devtool` scripts.
  2. **VidLink with `player=jw` and `fallback_url`**:
     - Supports `player=jw` (JWPlayer engine, bypassing dashjs `noon.mooncase.online` failures).
     - Accepts `fallback_url` parameter, automatically redirecting if VidLink fails to locate stream chunks.
  3. **SmashyStream & 2Embed & VidSrc.to**:
     - Verified working embed alternatives (Status 200, no blocking `X-Frame-Options` or restricting CSP).
- **Implementation**:
  1. **Schema & Adapter (`src/shared/media.ts`, `src/server/resolvers/adapters/filmpire.ts`)**:
     - Added `embedUrls` array to `NormalizedMediaSchema`.
     - Generates 5 prioritized provider URLs for any movie or TV series episode:
       - Provider 1: AutoEmbed (`player.autoembed.co`)
       - Provider 2: VidLink (`vidlink.pro` with `player=jw` & `fallback_url`)
       - Provider 3: SmashyStream (`player.smashystream.com`)
       - Provider 4: 2Embed (`www.2embed.cc`)
       - Provider 5: VidSrc.to (`vidsrc.to`)
  2. **Automated Watchdog Failover (`src/client/tv/Tv.tsx`)**:
     - Starts a 7-second timer when entering embed mode.
     - If active provider does not emit `play`, `timeupdate`, or `PLAYER_EVENT` within 7 seconds, Kino automatically advances `embedIndex` to the next provider and notifies the user with a toast.
     - When playback starts, the watchdog is instantly cleared.
  3. **Custom HUD Source Menu Integration (`src/client/tv/Tv.tsx`)**:
     - When `embedActive` is true, the HUD's "Source" menu dynamically populates with the embed providers: "Stream 1 (AutoEmbed)", "Stream 2 (VidLink)", "Stream 3 (Smashy)", "Stream 4 (2Embed)", "Stream 5 (VidSrc)".
     - Allows instant 1-click provider switching directly from Kino's native HUD.
  4. **Multi-Protocol Bidirectional HUD Control**:
     - Dispatches commands in all provider formats (`{ method }`, `{ type }`, `{ event, func }`, `{ action }`) for play, pause, and seek.
     - Supports incoming events from VidLink, JWPlayer, Plyr, Video.js, and HTML5 video.
  5. **HUD Overlay & Error Cleansing (`src/client/tv/Hud.tsx`, `src/client/tv/Tv.tsx`)**:
     - Fixed `useBusy`: sets `busy = false` when `embedActive` is true to eliminate blocking spinner over iframe.
     - Clears `player.error: undefined` on entering embed mode so error cards never obscure video playback.
- **Verification**:
  - Full test suite: 72 test files, **1413 tests passed** (100%).
  - Zero TypeScript errors (`npm run typecheck` clean).
  - Production build: clean in 324ms (`dist/client/assets/Tv-DLxTp8VU.js`).
  - Zero Render server bandwidth (`proxyVideo: false`).

### Test 9: React 19 Hook Ordering Integrity & Engine Teardown Isolation
- **Hypothesis**: Eliminate client crash `Cannot read properties of null (reading 'inst')` and prevent dormant HTML5 engine teardown from overwriting embed state back to idle.
- **Root Cause Analysis**:
  1. In `src/client/tv/Hud.tsx`, `useBusy` was invoked behind a short-circuit conditional: `const busy = !p.embedActive && useBusy(player, p.resolving);`. When `embedActive` flipped to `true`, the hook call was skipped. In React 19, this violated the Rules of Hooks and corrupted the fiber hook pointer linked list, crashing the subsequent `useOneLine` (`useLayoutEffect`).
  2. In `src/client/tv/Tv.tsx`, calling `engineRef.current?.stop()` triggered `this.teardown()`, which called `publish(IDLE_STATE)`. Without an early guard, this teardown event overwrote `player.state = "playing"` with `"idle"` during the transition to embed mode.
- **Implementation**:
  1. `src/client/tv/Hud.tsx`: Unconditionally invoke `const rawBusy = useBusy(player, p.resolving);` followed by `const busy = !p.embedActive && rawBusy;`.
  2. `src/client/tv/Tv.tsx`: Added `if (embedActiveRef.current) return;` at the very start of `publish(state)` to isolate embed state from background native player teardown.
  3. Ordered `engineRef.current?.stop()` before setting embed `player` state in the fallback handler.
- **Result**: **SUCCESS**.
- **Outcome**: React hook order remains strictly constant across all renders. Embed player transitions cleanly without hook exceptions or state clobbering.

### Test 10: Complete Embed HUD Bidirectional State Synchronization & Remote Control Alignment
- **Hypothesis**: Synchronize the entire Kino ecosystem (Kino TV HUD, mobile phone controller over WebSocket, watch parties, watch history store) when playing in embed mode, and ensure remote media keys (play, pause, seek, stop, source selection) map to embed commands.
- **Implementation**:
  1. **Unified State Publisher (`publishEmbedState`) in `src/client/tv/Tv.tsx`**:
     - Computes full `withTvState` including stream url, media metadata, sources/providers, and ending state.
     - Automatically broadcasts `TV_STATE` over WebSocket so paired phone controllers and watch party guests reflect current playback time, duration, and play/pause state in real-time.
     - Triggers `profileStore.playbackAt(currentMedia, player)` so the user's progress is saved in "Continue watching" and resume points are tracked.
  2. **Remote Phone Controller Integration (`TV_CMD`)**:
     - Mapped `PLAY`, `PAUSE`, and `SEEK` commands received from the phone controller to `sendEmbedCommand()` and `publishEmbedState()`.
     - Mapped `SET_SOURCE` to switch `embedIndex` dynamically across the 5 providers.
     - Added clean reset (`setEmbedActive(false)`, `setEmbedIndex(0)`) to `STOP`, `stopPlayback()`, and `cancelLoad()`.
  3. **Hardware / TV Remote Key Alignments (`keys.ts` & `onKey`)**:
     - Mapped dedicated `play` and `pause` hardware actions to embed commands.
  4. **CSS Refinement (`src/client/tv/tv.css`)**:
     - Added `border: 0;` to `.tv-video` to eliminate default browser borders on iframe elements.
- **Verification**:
  - Full test suite: 72 test files, 1413 tests passed (100%).
  - Zero TypeScript errors (`npm run typecheck` clean).
  - Production build: clean in 330ms (`dist/client/assets/Tv-D0WnFKQd.js`).

### Test 11: Reversion to Clean Native Fallback (Original Player HUD Without Conflicting Overlay)
- **Problem Statement & User Feedback**:
  - Superimposing Kino's custom overlay HUD (`<Hud />`) on cross-origin embed iframes created visual clutter and dual-HUD conflicts: the provider's original player HUD still appeared under/behind our controls, while postMessage synchronization across diverse upstream CDNs (AutoEmbed, VidLink, AnyEmbed) was inherently fragile and prone to timing desyncs.
  - Reverted to the clean, proven architecture:
    1. Try native direct HLS playback first with residential client token cache (no custom headers).
    2. On Chromium/Windows or when upstream WAF blocks direct segments (403), gracefully fall back to the embed iframe player.
    3. In embed mode, render the video player with its own original, fully functional HUD without layering Kino's HUD on top (`!embedActive`).
    4. Provide an unobtrusive floating "Back to Library" button (and stream selector pill) in the top-left corner so users can seamlessly exit or switch providers.
- **Implementation**:
  1. `src/client/tv/Tv.tsx`:
     - Guarded `<Hud />` with `!embedActive` so Kino's overlay controls are never rendered over the embed iframe.
     - Removed `sendEmbedCommand`, synthetic `publishEmbedState`, and iframe `postMessage` listeners that caused conflicting state mutations.
     - Restored the sleek floating "Back to Library" button and stream switcher pill in embed mode (`zIndex: 100`).
     - Kept client-side token caching (2h 50s TTL) for direct playback.
  2. `src/client/tv/Hud.tsx`:
     - Removed `embedActive` prop and `data-embed` attribute.
     - Kept unconditional `useBusy` hook call to preserve React 19 hook order integrity.
  3. `src/client/tv/tv.css`:
     - Removed `.tv-overlay[data-embed="true"]` rules.
- **Result**: **SUCCESS**.
- **Outcome**: Zero dual-HUD conflicts, zero pointer-event swallows. The embed player plays cleanly with full native playback controls, volume, seeking, quality, and subtitles, and users can exit to the library with a single click.

### Test 12: DOM Precedence Warning Resolution & Back-Forward Cache (bfcache) Lifecycle
- **Problem Statement**:
  1. Chromium logged: `Allow attribute will take precedence over 'allowfullscreen'` because both `allow="autoplay; fullscreen; ..."` and `allowFullScreen` were specified on the embed `<iframe>`.
  2. Chromium logged: `WebSocket connection to 'wss://.../ws' failed: Page entered Back-Forward Cache` when navigating away with an open WebSocket.
  3. External user extensions (e.g. `shuba` novel chapter reader) logged `Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist`.
- **Implementation**:
  1. `src/client/tv/Tv.tsx`:
     - Removed redundant legacy `allowFullScreen` prop from the `<iframe>`. Standard W3C Permissions Policy `allow="autoplay; fullscreen; encrypted-media; picture-in-picture"` is retained, fully silencing the Chromium precedence warning while preserving fullscreen privileges.
  2. `src/client/shared/socket.ts`:
     - Added `window.addEventListener("pagehide", onPageHide)`: cleanly closes the WebSocket (`code: 1000`) and disarms retry timers before Chromium puts the page into bfcache.
     - Added `window.addEventListener("pageshow", onPageShow)`: detects restoration from bfcache (`event.persisted`) and immediately reconnects the socket with fresh state handshake.
     - Added cleanup in `disconnect()`.
### Test 13: Upstream CDN Partner Integration (VidSrc.me / MultiEmbed) & Interactive Stream Dropdown Menu
- **Problem Statement & User Feedback**:
  - Direct HLS playback blocked by upstream Cloudflare WAF on fragment requests (`403 Forbidden` on `farragoandfulcrum.website/content/.../page-4.html`).
  - Previously prioritized embed options failed in desktop Brave with adblocking:
    1. `AutoEmbed`: loaded spam ad networks (`zfoo2relcykev7olu...` and `cxk.qjbjxlv6bk...`), which Brave/uBlock blocked with `ERR_BLOCKED_BY_CLIENT`, halting player initialization.
    2. `VidLink`: attempted to fetch DASH video manifests from `noon.mooncase.online`, which responded with `403 (Forbidden)` without CORS headers, and crashed with `TypeError: Cannot redefine property: aclib`.
  - The UI only presented a cycling button without an open menu, causing the user to try only Stream 1 and 2 ("both stream options") and think no working streams existed.
- **Root Cause & Technical Breakthrough**:
  - Reverse-engineered Filmpire's upstream pipeline: Filmpire's container page embeds `stellarconductornexus.com`.
  - Upstream CDN (`diaphanousdogma.website` / `farragoandfulcrum.website`) explicitly whitelists requests originating from `https://stellarconductornexus.com` (`Origin: https://stellarconductornexus.com` $\rightarrow$ `200 OK`).
  - `https://vidsrc.me/embed/movie/{id}` calls `/vs_src.php` which embeds `stellarconductornexus.com` directly, bypassing Cloudflare WAF and playing movie segments without CORS drop or adblock disruption.
  - Tested and verified 5 robust, working providers:
    1. **VidSrc.me**: `https://vidsrc.me/embed/movie/{id}` (dispatches to `stellarconductornexus.com`)
    2. **MultiEmbed**: `https://multiembed.mov/?video_id={id}&tmdb=1` (self-contained HTML5 player with multi-server failover)
    3. **VidSrc.to**: `https://vidsrc.to/embed/movie/{id}` (dispatches to `vsembed.ru`)
    4. **2Embed**: `https://www.2embed.cc/embed/{id}` (stable direct embed)
    5. **SmashyStream**: `https://player.smashystream.com/movie/{id}` (clean HTML5 player)
- **Implementation**:
  1. `src/server/resolvers/adapters/filmpire.ts`:
     - Prioritized `[vidsrcMeUrl, multiEmbedUrl, vidsrcToUrl, twoEmbedUrl, smashyUrl, autoEmbedUrl, vidLinkUrl]`.
  2. `src/client/tv/Tv.tsx`:
     - Replaced the blind cycling button with an interactive floating **Stream Dropdown Picker** (`streamMenuOpen`).
     - Shows all available streams with clear provider labels and checkmarks for the active stream.
     - Allows instant 1-click switching to any stream provider.
     - Updated `embedProviderName` to label each stream clearly.
- **Verification**:
  - Full test suite: 72 test files, 1413 tests passed (100%).
  - TypeScript typecheck: 0 errors (`npm run typecheck` clean).

### Test 14: Full Revert to Native Player & Custom HUD (Revert to 9eadf37)
- **User Directive**:
  - Revert completely back to the clean architecture prior to third-party embed experimentation (`9eadf37`).
  - Users watch 100% through Kino's native HUD.
  - Zero third-party embed iframes, zero external ads, zero tracker scripts.
- **Git Revert Execution**:
  - Executed a true Git revert (`git revert --no-commit 9eadf37..HEAD`), restoring all source files and client bundles to match `9eadf37` bit-for-bit.
  - Re-verified test suite: 72 test suites, 1412 tests passed (100%).
  - Pushed revert commit `a616ff8` to `main`.






