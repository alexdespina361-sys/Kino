# Playback without viewer extensions: investigation, 16 October 2026

The practical route for keeping Kino's full HUD and leaving video off the website server is **one separately hosted relay**. Viewers then use an ordinary browser. Oracle Always Free was selected and the public relay is now deployed. Its provider access, HTTPS and the live Kino website were tested with extensions disabled; see [ORACLE_RELAY_DEPLOYMENT.md](ORACLE_RELAY_DEPLOYMENT.md) for results, including one initial seek timeout and the successful recheck. Capacity, idle-reclamation and actual TV-device limitations still apply.

The extension fix is already deployed on Kino. Version 1.1.0 is available as a ready-to-load folder at `output/playwright/TheExtension`. It handles rotating Filmpire video hosts automatically rather than maintaining a fixed hostname list.

## Clarification: a setup-only host with zero video traffic

The operator reports a **5 GB/month allowance on the existing Render setup**. Treat that as the account's constraint, not a claim about every Render plan. A different service with a similarly small video-transfer allowance is unsuitable. Zero website video bandwidth does not imply that a separately hosted video relay has zero bandwidth: every forwarded video byte leaves that relay.

The newly supplied Gemini notes correctly distinguish successful client-token/playlist loading from the subsequent video-fragment Origin block. They do not establish a blanket ban on Render itself. The Worker egress block and the browser's Origin block are different restrictions.

| What a different host does | Video bytes through that host | Does it repair current direct fragment loading? |
| --- | --- | --- |
| Resolve addresses or return metadata | None | No. The browser still asks the CDN with the page's Origin |
| Obtain a token server-side | None | No. The token is bound to that host's connection, and the fragment Origin restriction remains |
| Redirect requests to the CDN | None | Failed in the controlled browser check below |
| Forward each fragment and return readable response headers | All delivered video bytes | A viable relay design if its egress IP is accepted, but its transfer quota matters |
| Serve Kino under another unrelated hostname | None | Does not create an allowlisted provider origin |

Fresh LINK CLICK fragment checks on 16 October reproduced HTTP 200 for absent Origin and `https://stellarconductornexus.com`. Kino's Origin, an unrelated website Origin and the literal `Origin: null` all returned HTTP 403. This test used a freshly issued token from the connection making the media requests, not the expired token pasted in the attachment.

A separate **extension-free Chromium test** simulated a third-party setup broker returning HTTP 302 with a permitted CORS header and an empty body. Both final CDN requests were real and unmodified. The master playlist loaded, but the video fragment failed. Chromium sent `Origin: null` to the CDN after the cross-origin redirects; changing the redirect response's headers did not grant access to the final fragment. The broker carried **zero video-body bytes**. This was a browser-semantics experiment, not a deployment to a new hosting company. [The Fetch redirect algorithm](https://fetch.spec.whatwg.org/#http-redirect-fetch) and [MDN's Origin documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin) explain the browser's origin handling.

Some blanket claims in the attachment have been superseded by testing: the current extension arrangement works, and the tested Chromium 156 build plays native HLS. A later direct-navigation test also played this provider's video in its own browser media page without the extension. Embedding a raw video in Kino is a different security context and failed; see the direct-click experiment below. These checks do not establish native support in the separately reported Brave build.

### Follow-up: completely absent Origin, not the string `null`

A further Chromium check captured actual transmitted request headers using `Network.requestWillBeSentExtraInfo`, rather than relying on provisional page request headers. Results for a fresh LINK CLICK segment:

| Method | Actual transmitted Origin | HTTP result | Bytes readable by page JavaScript |
| --- | --- | --- | --- |
| Set `Origin: ''` from page JavaScript | `https://kino.24-7.ro` | 403 | Request failed |
| Omit credentials and Referer | `https://kino.24-7.ro` | 403 | Request failed |
| `no-cors` GET | Header absent | 200 | Zero; opaque response |
| Follow the no-cors load with a normal `force-cache` read | `https://kino.24-7.ro` | 403 | Request failed |
| Production extension 1.1.0, normal page fetch | Header absent | 200 | **496,696 bytes** |

The no-cors cache-warming transfer ended with `net::ERR_ABORTED`; no usable readable-cache route was established. The upstream response also sends `Vary: Origin`, `X-Content-Type-Options: nosniff` and `Content-Type: text/html`, despite containing video data. The extension trace confirmed Referer absent too. No browser security checks were disabled in either profile.

Completely omitting Origin is therefore confirmed possible, and already implemented by the extension. Ordinary page fetch could omit it only in an unreadable mode in these checks. [Opaque response behavior](https://developer.mozilla.org/en-US/docs/Web/API/Response/type) and [request Origin construction](https://fetch.spec.whatwg.org/#append-a-request-origin-header) explain that distinction. No additional page-only production change was made on the basis of failed approaches.

The remaining approaches with no video traffic through a new host are the verified extension, provider-supported direct delivery, or a provider iframe with a sufficient control API. A high-transfer separate relay remains an alternative when zero video traffic is required only on the website host. A setup-only host cannot substitute for that relay under the currently observed restrictions.

### Follow-up: can locally cached video play without the extension?

Yes, once valid, readable video bytes have been acquired. An isolated browser experiment saved the first eight LINK CLICK MPEG-TS fragments, **40 seconds / 2,866,624 bytes**, directly from the CDN through the extension into browser CacheStorage. After closing Chromium and reopening the same profile with extensions disabled, a local Service Worker served those bytes to Kino's existing player and HUD. Playback reached **114 frames / 14.2 seconds**; pause, a 10-second seek and resume passed. All playlist/fragment responses came from the Service Worker. The playback phase made no external requests, the test website served no video bytes, and its video proxy stayed at zero.

This establishes local replay, not extension-free acquisition of a new title. The initial eight fragments were acquired with extension privileges. It is a short experiment in a separate test profile, not a shipped offline feature or a complete-film test.

The opaque-response question was also tested rather than inferred from `blob().size` alone:

| Cached response | Bytes actually retained internally | Native playback |
| --- | ---: | --- |
| Valid MP4 control fetched with `no-cors` | 739,847 | Played, despite remaining opaque to page JavaScript |
| Actual provider fragment fetched with `no-cors` | **0** | No usable video; the cached native-HLS attempt failed |
| Provider fragments acquired readably through the extension | 2,866,624 total | Played after the extension was disabled |

The internal sizes were inspected using privileged browser debugging, not a capability available to Kino's website. Both opaque responses appeared as zero-length blobs to page JavaScript, so that observation alone cannot distinguish hidden bytes from a response with no retained body. The control proves opaque cached media can sometimes play; this provider's tested cross-site fragment supplied no retained body to salvage. A normal readable fetch of the opaque Service Worker response also failed. [Cache.put permits opaque responses](https://developer.mozilla.org/en-US/docs/Web/API/Cache/put), while [respondWith restricts where opaque responses can be returned](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith).

Evidence and reproducible probes are under `output/playwright/`: `cache-opaque-result.txt`, `cache-native-inspect-result.txt`, `cache-readable-fill-result.txt`, `cache-local-playback-result.txt`, and `verified-browser-cache-no-extension.png`. These are local ignored test artifacts. The production extension and website code were not changed by these experiments.

### Follow-up: can Kino's Play button initiate the same connection?

A real, trusted Playwright button click on live Kino opened a freshly tokenized LINK CLICK master playlist directly on the provider's origin. Chromium was launched with `--disable-extensions`; no request or response headers were rewritten. The provider's native media page played **76 frames / 3.0 seconds**, with fragment responses HTTP 200 and observed fragment Origin headers absent. Video went directly from the provider to the viewer. This proves that a Play button can initiate direct playback in a separate provider page.

However, Kino's own page received **SecurityError** when it attempted to read that page's video element. The media page used browser-native controls. Opening it does not grant Kino access to its video bytes, player state or controls, or authorize subsequent cross-origin HLS.js requests from Kino.

A second trusted-click experiment placed the provider media document in an iframe on Kino, with autoplay allowed. It rendered **28 frames / 1.0 second**, and continued to 2.0 seconds after Kino sent the provider player's usual `{player:true, action:'pause'}` message: the raw browser media document did not respond to that command. Kino's attempted direct `video.pause()` access again raised **SecurityError**. The test automation could inspect the frame through privileged browser tooling; Kino's JavaScript could not. A first, longer iframe run rendered 65 frames before becoming paused at 2.57 seconds, without a media error; sustained iframe playback and autoplay behavior are not established by these short checks.

The extension's additional capability is not opening a network connection. Its `chrome.declarativeNetRequest` permission lets it remove Origin/Referer and alter response headers for Kino-initiated media requests. Moving the same JavaScript into an ordinary click handler does not provide that extension API or permission. [Chrome documents the extension-only request modification permissions](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest); [the same-origin policy limits access to another origin's document](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy).

Evidence: `output/playwright/manual-direct-probe.js`, `output/playwright/manual-direct-result.txt`, `output/playwright/manual-iframe-probe.js` and `output/playwright/manual-iframe-result.txt`. These were short Chromium 156 checks of LINK CLICK, not a production fallback, a full-HUD integration or a cross-browser guarantee.

### Follow-up: let the provider buffer/decode, then hand its downloaded parts to Kino

This exact sequence was tested with extensions disabled. A trusted click opened the freshly tokenized LINK CLICK stream on the provider's own origin. The native player displayed **76 frames / 3.0 seconds**, with **14.75 seconds buffered** and no media error. Only after this real download/playback did the Kino page request the same observed fragment URL. No privileged response body was copied into Kino.

| Handoff attempt after provider playback | Result |
| --- | --- |
| Kino's ordinary readable `fetch` with `cache: 'force-cache'` | Failed with `TypeError`; browser still transmitted Kino's Origin |
| `only-if-cached` with its required same-origin mode | Failed; cross-origin resources do not become same-origin after buffering |
| Kino's `no-cors`/`force-cache` fetch, saved into its own CacheStorage | Opaque response; zero readable bytes; privileged internal cache inspection also found **zero retained body bytes** |
| Kino reads the provider page's video element/cache object | `SecurityError` |

The observed fragment response again specified `Vary: Origin` and `Cache-Control: private, max-age=14400`. Buffered playback proves that usable media exists inside the provider's browser context; it does not establish an API by which Kino can take those bytes. The ordinary readable request retained its Origin despite the prior provider connection. Treating the browser's HTTP/media buffer as a user-selected disk file would bypass the actual access boundary and is not a valid implementation.

A separate, positive control tested a real local file selected for the website. Automation selected the existing **739,847-byte MP4 fixture**, simulating a user file-picker action. The Kino page created its own `blob:` URL, rendered **20 frames / 1.0 second**, and paused the video through its own button, with extensions disabled and only a `blob:` media source. This was a temporary native video element on Kino, not a shipped local-file feature or a test of the full Kino HUD. It confirms the manual workflow's first condition: once the user explicitly supplies a playable local file, page-side playback is possible. It does not show automatic provider downloading, complete-HLS saving or access to browser-managed caches. [The File API documents explicit file selection and object URLs](https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications).

Decoded output also has an access boundary. Kino cannot access the provider frame's video element, and cross-origin media/canvas capture has its own restrictions; decoding does not itself authorize exporting frames. [Media capture security considerations](https://w3c.github.io/mediacapture-fromelement/#security-considerations) and [canvas origin rules](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image) cover this.

An explicitly user-approved tab/screen capture is a different potential route: `getDisplayMedia()` can supply selected display output for local viewing/recording without an extension, but the browser must prompt on every capture session. It does not expose the original HLS fragments or provide control over the provider's original playback position. Recording is real-time and has different quality, audio-support and playback-buffer implications. This route was researched, not runtime-tested or implemented as a Kino fallback. [Screen capture API and permission requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).

Evidence: `output/playwright/buffer-cache-handoff-probe.js`, `output/playwright/buffer-cache-handoff-result.txt`, `output/playwright/selected-local-file-probe.js` and `output/playwright/selected-local-file-result.txt`. Temporary DOM elements and the new cache entry were removed, and the isolated test browser was closed. Production website and extension code were unchanged.

### Follow-up: cache permission from Play, unfinished video, and the viewer's Origin

**A complete movie download is not required for Kino playback.** Kino can start from valid initialization data and a few readable media segments, then load/append more. The earlier 40-second cache experiment used only part of the original episode. The complete MP4 in the manual file-picker control was a test fixture, not a universal requirement. An arbitrary truncated file is not necessarily decodable, but segmented playback is normal. [SourceBuffer.appendBuffer documents adding media segments](https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/appendBuffer).

An additional capability probe ran on live Kino with extensions disabled. The measured click was trusted and `navigator.userActivation.isActive` was **true**. Queries for `browser-cache`, `http-cache` and `cache-storage` each failed with `TypeError`: these were not recognized permission names. The real `persistent-storage` permission was recognized and reported `prompt`; that permission protects the site's own stored data from eviction, rather than authorizing access to other sites' media or the browser's internal HTTP cache. No persistent-storage permission was requested or granted. The page had ordinary CacheStorage and file-picker APIs, while the extension request-modification API was unavailable.

A click can initiate a browser-supported permission request, such as a file/folder picker or screen sharing. It does not create a new permission type or make a custom consent button equivalent to a browser grant. These storage mechanisms must be distinguished:

| Storage/access mechanism | What Kino can access |
| --- | --- |
| Kino's own CacheStorage | Entries already stored for Kino, subject to response-readability restrictions; this is not an inventory of the browser's global media cache |
| User-selected ordinary files/folder | Selected accessible files, after the actual browser picker/permission flow |
| Browser's HTTP cache and decoded media buffers | No general website API to enumerate and export another site's playback buffer |
| Browser profile/cache directory through a directory picker | Chromium's implementation blocks the profile/user-data directory and its children |

The directory restriction was checked in [Chromium's current permission-context source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc): `CheckPathAgainstBlocklist` adds the profile parent/user-data directory with `kBlockAllChildren`, including custom profile locations. This is source evidence, not a runtime claim that a user completed the native picker. The probe separately confirmed that `showDirectoryPicker` does not accept an arbitrary absolute path string as `startIn`; it accepts a well-known-directory name or an existing permitted handle. [Directory-picker parameters](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker), [origin-scoped storage keys and persistence](https://storage.spec.whatwg.org/#storage-keys), and [Chrome's HTTP cache partitioning](https://developer.chrome.com/blog/http-cache-partitioning/) explain the access boundaries.

There is no separate personal web Origin to substitute for Kino's Origin. For a viewer at `https://kino.24-7.ro`, the requesting page's Origin is `https://kino.24-7.ro`; the viewer's public IP is a different network property, already present on direct browser-to-provider connections. That is also distinct from this provider's IP-bound token. Browser page JavaScript cannot overwrite the browser-controlled Origin header just because the request follows a click. [Origin's definition and forbidden-header status](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin).

The observed delivery paths therefore remain:

| Request path | What happens |
| --- | --- |
| Viewer browser, Kino HLS.js readable request | Browser attaches Kino Origin; tested provider fragments reject it |
| Viewer browser, `no-cors` GET | Origin can be absent, but page receives an opaque response; this provider's tested cross-site copies retained no usable video body |
| Viewer browser, provider's own native media page | Direct video download/playback worked; Kino cannot take over that page's buffer/control without provider cooperation |
| Viewer browser with extension | Direct video; extension changes the restricted headers and makes media readable to Kino |
| Separate relay server | Can construct upstream headers without page-JavaScript restrictions if the provider accepts its IP/token; every delivered video byte passes through the relay |

Kino's website can send a viewer the stream address and metadata with negligible video bandwidth. If a server actually fetches video and forwards it to the viewer, that is video delivery by the server; setting a header to a viewer's address does not make the video bypass it. Finding an internal cache path does not bridge this distinction. No new cache-permission workaround was found or deployed.

Probe evidence: `output/playwright/cache-permission-probe.js` and `output/playwright/cache-permission-result.txt`. The temporary button was removed and the isolated browser was closed after checking the result. The initial click also triggered Kino's existing fullscreen behavior; the recorded result is the subsequent click, with active user activation explicitly verified.

### Follow-up: the fetch-robot iframe approach

The supplied [Daniel Brain article](https://bluepnume.medium.com/reinventing-cross-origin-requests-without-cors-b9c4cb645376) describes a relevant client-side bridge: the parent asks a cooperating iframe on the target origin to fetch data, and the iframe sends results back through cross-window messages. This is not a video relay server. If the helper's origin is allowed to read this provider's fragments, the viewer's browser can obtain the bytes and pass them locally to Kino without video crossing Render or a separate relay host.

The necessary cooperation is explicit in [fetch-robot's README](https://github.com/krakenjs/fetch-robot): its example requires a target-domain `/fetch-robot-proxy` page that loads the library and calls `fetchRobot.serve(...)`. The [serve implementation](https://raw.githubusercontent.com/krakenjs/fetch-robot/master/src/server/server.js) installs the message listener and invokes `window.fetch` from that frame. Loading the client library only on Kino cannot install this handler inside another origin's page. A helper hosted on an unrelated free service would still face the provider's Origin restriction; a `srcdoc`/Kino helper does not acquire the provider's origin merely by mentioning its URLs.

The original package is also not a binary HLS loader: [server serialization](https://raw.githubusercontent.com/krakenjs/fetch-robot/master/src/server/serdes.js) exposes `response.text`, and [client deserialization](https://raw.githubusercontent.com/krakenjs/fetch-robot/master/src/client/serdes.js) reconstructs a Response from that text. This is code-inspected evidence, not a playback test. Arbitrary MPEG-TS/fMP4 fragments need a binary-safe design, such as `arrayBuffer()` plus transferable buffers and an HLS loader. [Window.postMessage documents transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

The provider player script already inspected locally (`output/playwright/provider-script-2.js`, message handler around line 652) supports playback commands and progress events, but its inspected handler does not expose an arbitrary fetch/media-byte bridge. That observation does not establish that every provider endpoint was searched. No cooperating provider-origin fetch-robot endpoint has been found or runtime-verified. The useful prerequisite is a provider-supplied helper page or supported player API; installing fetch-robot on Kino alone is insufficient. No package was installed and production playback code was unchanged.

The proposed two-player variation has the same boundary. An invisible provider iframe can download/play media, while a separate Kino-owned iframe can run our bridge code. The missing operation is reading/exporting video from the first iframe. Running `serve()` in a Kino-owned outer wrapper does not run it in the nested provider document: its `window.fetch` remains bound to the wrapper's browser context. Placing another origin's iframe inside our document does not give our code that iframe's origin or access to its DOM/media buffer. [The same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) applies independently to the nested document.

Importantly, fetch-robot's inspected implementation does not capture existing video or recover an iframe's already-buffered data. Its message handler issues a new `window.fetch(url, ...)` and returns that result. Already having rendered video in the provider iframe does not supply this handler with readable bytes. A provider-installed handler could send bytes to another iframe; the original document without such a handler cannot be turned into that sender by code installed only on Kino.

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
| Same, native LINK CLICK HLS embedded as a video on Kino | Zero frames; media error 4; segment request failed with `net::ERR_BLOCKED_BY_ORB` |
| No extension, trusted click opens LINK CLICK on the provider's own origin | 76 frames; fragment HTTP 200; parent Kino cannot access the native player (`SecurityError`) |
| No extension, trusted click embeds provider media document in iframe | Rendered video; parent control access denied; native media document ignored the provider JavaScript player's pause-message format |
| Extension-filled browser cache, then restart with extensions disabled | 40 seconds cached; Kino HUD; 114 frames; pause/seek/resume passed; no external playback requests or website-served video |

These are short Chromium 156 checks on Windows. They are not a sustained playback or concurrency test, and Brave, Firefox and Safari were not runtime-tested. The original separate Node relay had already passed a local Chromium playback/control check; that proves this PC's connection works, not that a free cloud host works.

The live inventory found ten current CDN domains, plus the previously observed `diaphanousdogma.website`. The provider's own `player.js` states that its backend rotates hosts per request. A finite hostname list cannot cover future changes. Extension 1.1.0 therefore installs a host-specific session rule before preparing each `/pl/*.m3u8` source. HTTPS host permission is broad; content injection and rule initiators remain scoped to Kino. This handles the Filmpire token/playlist protocol; it is not a universal adapter for unrelated video sites.

## Why browser-only header tricks do not solve the current stream

There are separate checks at separate points:

1. **Token identity:** the provider token is tied to the requesting connection. The old website-issued token cannot simply be handed to another machine. An ordinary viewer browser successfully obtained its own fresh token during this investigation.
2. **Readable video data:** the playlists allow cross-origin reads, but the tested fragments do not. HLS.js needs those fragment bytes. A successful master request does not establish playable video.
3. **Native media loading:** this Chromium build supports native HLS, demonstrated by the control stream and the provider's own media page. Loading this provider as a video element on Kino still fails at a fragment with ORB. Navigating to a separate provider media page works, but Kino cannot control that cross-origin document without a cooperative API.

Attempting to set `Origin: https://stellarconductornexus.com` in ordinary page JavaScript did not change the sent Origin; the browser sent Kino's origin. `referrerPolicy: 'no-referrer'` can suppress Referer but does not grant control over Origin. [MDN documents Origin as a forbidden request header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin).

`no-cors` removes JavaScript's access to the response body. A Service Worker, a Web Worker, WebAssembly, a blob URL or MediaSource cannot turn those unreadable bytes into readable HLS fragments. [MDN explains opaque responses and the server/proxy remedies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors).

The native result also matters: switching to `<video src>` on Kino was tested and failed for this provider. A separate provider-origin media document has a different result and different control limitations; it must not be conflated with a video element owned by Kino. [Chromium's isolation documentation describes ORB as a browser-level response restriction](https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md).

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

### Oracle's 30-day credit versus ongoing Always Free resources

Rechecked Oracle's primary documentation after the concern that this was only a one-month offer. These are separate parts of the same signup: **US$300 promotional credit expires after up to 30 days**, while **Always Free resources have no scheduled 30-day expiry**. Oracle's free-tier page says that doing nothing after 30 days leaves Always Free services available. Its resource documentation explicitly lists **10 TB per month of outbound data under Always Free**. This is a recurring monthly allowance under the current offering, not 10 TB purchased from the trial credit. [Free-tier explanation](https://www.oracle.com/cloud/free/), [Always Free outbound allowance](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

A credit/debit card is still required for identity verification, including possible temporary authorization holds. Paid trial resources can be reclaimed when the trial ends; resources must remain within the ongoing Always Free limits. The standard free account can continue without upgrading to Pay As You Go. Oracle notes exceptions for some special trial offers, so use the standard Cloud Free Tier signup and check the tenancy's actual limits and resource eligibility. [Oracle's Free Tier FAQ](https://www.oracle.com/cloud/free/faq/).

This is not a guarantee of uninterrupted permanent hosting: Always Free capacity may be unavailable, idle instances can be reclaimed, and the free tier has no SLA. The user subsequently created an account and VM; that VM's upstream preflight and live website playback passed. This result applies to the tested VM's egress IP, not every Oracle address. No paid account upgrade was performed by this chat.

### TV access without an extension

The user reports a friend's Amazon Fire Stick/Hi Browser setup, with the exact device and whether the browser runs on the stick or Hisense TV unavailable. The preference is to preserve website access without requiring TV setup. A shared HTTPS relay fits that preference: the TV loads Kino normally, while video flows provider → relay → TV and stays off Render.

An installed app is an alternative execution environment, not a requirement to rewrite Kino's JavaScript. On a compatible Fire OS device, a thin native host could keep the web HUD while handling media requests through native networking or a native player. Android documents [WebView resource interception](https://developer.android.com/reference/android/webkit/WebViewClient#shouldInterceptRequest(android.webkit.WebView,%20android.webkit.WebResourceRequest)) and [streamed native responses to web content](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge). A wrapper that merely loads the site without a native media/network implementation would retain the same browser restrictions. This route is not built or device-tested. Fire Stick models now include both Fire OS and Vega OS, so Android APK compatibility cannot be assumed for an unknown stick. [Amazon's current platform/device mapping](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html).

Given the stated website preference, a native TV app is not the primary deployment path. A relay can also run on an existing home PC, but it needs continuous availability, sufficient upload and public HTTPS reachability. It still forwards all delivered video bytes; it avoids cloud relay transfer charges only when those bytes use the operator's own connection.

| Host | Useful allowance/behavior | Limitation for this use |
| --- | --- | --- |
| **Oracle Always Free** | 10 TB outbound/month; currently 2 ARM OCPUs and 12 GB total RAM for Always Free tenancies | Deployed and tested on the allocated VM. Capacity can be unavailable and idle instances can be reclaimed; other IPs need their own access check. [Official resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| Northflank Sandbox | Two free services; advertised as always on without sleeping | Its docs say the free plan should not be used for production and require a payment method. A confirmed sustained-video free egress allowance was not found; standard egress pricing is $0.06/GB. [Pricing](https://northflank.com/pricing), [billing documentation](https://northflank.com/docs/v1/application/billing/pricing-on-northflank) |
| Render Free | 750 free instance-hours per workspace/month | Sleeps after 15 idle minutes; outbound quotas apply; may suspend unusually high service-initiated traffic. Poor match for a continuous video relay. [Free service limits](https://render.com/docs/free) |
| Koyeb Free | One free instance; 100 GB outbound/month is included in its published pricing FAQ | Sleeps after one idle hour and cannot disable this; free instance is intended for testing/hobby use. 100 GB is small for shared video. [Instance limits](https://www.koyeb.com/docs/reference/instances), [bandwidth pricing](https://www.koyeb.com/docs/faqs/pricing) |
| alwaysdata Free | Personal free hosting | Free-account restrictions include network-intensive applications and generic programs running continuously without user interaction. Not a sound basis for promising a permanent streaming relay. [Official restrictions](https://help.alwaysdata.com/en/docs/admin-billing/profile/suspension/) |

None of these checks establishes a guaranteed, permanently free 24/7 streaming service. The Oracle deployment now has successful live playback checks, without establishing long-term availability or concurrent-viewer capacity. Older claims of 4 free ARM OCPUs/24 GB should not be used for a new Always Free tenancy; the current resource page lists 2/12.

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

1. Obtain an Oracle Always Free VM, or identify an existing always-on machine with public HTTPS reachability. The user has now allocated the Oracle VM documented in the deployment report.
2. Run the preflight **on that host**. If it fails, do not switch Kino to that relay.
3. Deploy one relay instance behind HTTPS, using the existing guide and a shared signing secret. Keep token generation and upstream requests on the same egress path.
4. Test an extension-free browser against that relay with Kino's HUD, pause, seek, subtitles and alternate sources. Run a longer session with the intended number of concurrent viewers.
5. Only after those checks, configure Kino's external relay endpoint and signing key; keep website video proxying off. Extension viewers can continue using direct delivery.

The allocated Oracle VM, upstream access check, public HTTPS, Render integration and extension-free Chromium playback are now verified. The friend's actual TV browser, longer playback sessions and the intended concurrent-viewer load remain unverified.
