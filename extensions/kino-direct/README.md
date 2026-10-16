# Kino Direct Playback

The extension lets Kino's player download video directly from the provider. Kino keeps its HUD, play/pause, seeking, quality controls and phone controls. No video relay or always-on server is needed.

Version **1.1.0** supports the provider's rotating hosts. Version 1.0.0 only recognized two hosts and failed on titles such as LINK CLICK. The matching website update is also required.

## Install once per playback browser

1. Use the ready-to-load `output/playwright/TheExtension` folder, this `extensions/kino-direct` folder, or extract the ZIP to a permanent folder. Developer mode loads folders, not ZIP files.
2. Open `chrome://extensions` in desktop Chrome, or `brave://extensions` in desktop Brave.
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. After the updated website is deployed, reload Kino and play a movie normally.

Keep the extracted folder in place. Install on the browser that plays the video; a phone used only as a remote needs no extension. This package is for desktop Chromium browsers. Mobile Chrome and TV browsers without extension support still need a separate relay or provider-supported direct playback.

To upgrade an existing installation, replace the files in its installed folder with version 1.1.0, click the extension's reload arrow, check that its details show **1.1.0**, then reload Kino. Alternatively, remove the old extension and load the new folder. Accept the updated HTTPS access permission; restricting access to the original two domains prevents the new video hosts from working.

This follows Chrome's documented [unpacked-extension installation](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked). Brave documents [Chromium-extension compatibility](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave).

## What it does

The extension prepares a fresh IP-bound video token from the viewer's own connection. Before playback, it registers a session rule for the resolved video host. For requests from Kino to that host, Chrome's declarative rules remove Origin and Referer and supply readable CORS response headers. HLS.js then fetches playlists, pieces, keys and other media normally, directly from the video provider. Segments do not pass through extension messaging or the website. Rules survive the background worker sleeping and are recreated as needed after restarting the browser.

The package requests access to **all HTTPS sites** because the provider rotates unrelated video domains. Its content script runs only on `https://kino.24-7.ro`; header rules apply only to requests initiated by Kino and only to hosts prepared for playback. The background accepts only HTTPS `/pl/*.m3u8` addresses on public DNS names and only fetches `/generate.php` without cookies or redirects. It does not request browsing history, cookies or browser debugging permissions. Keep full HTTPS access enabled for rotating hosts to work.

Observed hosts on 16 October 2026 include `farragoandfulcrum.website`, `diaphanousdogma.website`, `theorboofthorns.space`, `quorumofquiddity.site`, `comityofcognomen.site`, `peregrinepalaver.space`, `roilandrelic.website`, `noosphere-nectar.site`, `welkinwanderer.space`, `zealotsofzenith.site` and `ataraxiaoftheapex.space`. This is an observed inventory, not a complete or permanent upstream list. Future hosts matching the same stream protocol do not require another extension update.

Chrome documents [header rules](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) and [extension background requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

## Website deployment

Deploy the updated source and generated browser build from this repository. The player detects the extension automatically; no new button is needed. Keep `PROXY_VIDEO=off` on the website. A separate relay key or endpoint is not required for viewers using the extension. For supported streams, the extension path takes precedence over an existing Worker URL.

No extension is installed into the user's existing browser profile by the test tooling. Tests use an isolated Chromium profile.

## Verified on 16 October 2026

- Real Chromium playback of the original movie source through the normal Kino movie resolver and phone command path.
- Kino HUD present; native video controls disabled.
- Pause, seek forward exactly 10 seconds, and resume succeeded.
- Video responses were HTTP 200, directly from `farragoandfulcrum.website`.
- No relay requests; website proxy counters stayed at zero requests and zero bytes, with video off.
- The original local test used a development copy; the subsequent live-site test used the production extension and Kino domain.

Brave itself was not runtime-tested in this workspace.
