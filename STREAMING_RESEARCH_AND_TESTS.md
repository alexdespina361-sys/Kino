# Kino Streaming Research, Implementation, and Test Log

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

