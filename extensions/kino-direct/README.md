# Kino Direct Playback

The extension lets Kino's player download video directly from the provider. Kino keeps its HUD, play/pause, seeking, quality controls and phone controls. No video relay or always-on server is needed.

**The matching Kino website update in this repository must be deployed too. Installing the extension alone does not update the public website.**

## Install once per playback browser

1. Extract the extension ZIP to a permanent folder, or use this `extensions/kino-direct` folder directly.
2. Open `chrome://extensions` in desktop Chrome, or `brave://extensions` in desktop Brave.
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. After the updated website is deployed, reload Kino and play a movie normally.

Keep the extracted folder in place. Install on the browser that plays the video; a phone used only as a remote needs no extension. This package is for desktop Chromium browsers. Mobile Chrome and TV browsers without extension support still need a separate relay or provider-supported direct playback.

This follows Chrome's documented [unpacked-extension installation](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked). Brave documents [Chromium-extension compatibility](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave).

## What it does

The extension prepares a fresh IP-bound video token from the viewer's own connection. For requests from Kino to the two supported video hosts, Chrome's declarative rules remove Origin and Referer and supply readable CORS response headers. HLS.js then fetches playlists, pieces, keys and other media normally, directly from the video provider. Segments do not pass through extension messaging or the website.

The package is limited to `https://kino.24-7.ro` and the current providers `farragoandfulcrum.website` and `diaphanousdogma.website`. It does not request access to all websites, cookies, browsing history or browser debugging. If the provider changes domains, both this allowlist and the website's direct-playback helper must be updated.

Chrome documents [header rules](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) and [extension background requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

## Website deployment

Deploy the updated source and generated browser build from this repository. The player detects the extension automatically; no new button is needed. Keep `PROXY_VIDEO=off` on the website. A separate relay key or endpoint is not required for viewers using the extension. For supported streams, the extension path takes precedence over an existing Worker URL.

No extension was installed into the user's existing browser profile during testing. The public website has not been updated by these local tests.

## Verified on 16 October 2026

- Real Chromium playback of the original movie source through the normal Kino movie resolver and phone command path.
- Kino HUD present; native video controls disabled.
- Pause, seek forward exactly 10 seconds, and resume succeeded.
- Video responses were HTTP 200, directly from `farragoandfulcrum.website`.
- No relay requests; website proxy counters stayed at zero requests and zero bytes, with video off.
- Browser tests used an isolated profile and a development copy that also permits the local test website. The distributed package permits only the production Kino domain.

Brave itself was not runtime-tested in this workspace.
