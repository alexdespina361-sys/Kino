# GIFs in a chat (KLIPY)

The GIF button in a chat searches [KLIPY](https://klipy.com) (Tenor's API closed on 30 Jun 2026 and GIPHY charges for production use; KLIPY is free).
It is on wherever the host has a KLIPY key, and only there.

## Turning it on and off

- **On:** `KLIPY_KEY=<the key>` in the server's environment (`/etc/kino-web.env` on the Oracle box), then restart `kino-web`. The key comes from
  KLIPY's panel, made by the site's owner with their own account.
- **Off:** take the line out and restart. Every screen loses the GIF button. GIFs already sent stay in the chats as their addresses and are still
  drawn as pictures, because the pictures come from KLIPY, not from Kino.
- The key is not a secret in the usual sense. KLIPY puts it in the address of every request a visitor's browser makes, so the server hands it to the
  pages (`/api/features`). Still, it is never written into this public repository or into notes.

## What KLIPY asks of the site, and how Kino keeps it

From KLIPY's integration requirements (docs.klipy.com), as read when this was built:

- Requests and pictures go from the visitor's browser straight to KLIPY. Kino's server never fetches or keeps a GIF.
- A picture's address is used exactly as KLIPY gave it.
- Search and Trending are shown in KLIPY's order, all of them. The box says "Search KLIPY", and "Powered by KLIPY" sits under the grid.
- The content filter is KLIPY's own (`content_filter`: medium for grown-ups, high on a child's profile, which has no GIF button anyway).

**In the KLIPY panel, for the owner:** turn ads off for this app (Kino shows none and asks for none), and ask for production access when the test
key's limits start to bite. Both are settings of the owner's KLIPY account; Kino's code needs no change for either.

## Privacy (what the privacy page says, `public/privacy.html#en-gifs`)

- When someone opens the GIF button, searches or scrolls for more, their browser tells KLIPY the search words, a country (from the browser or the
  site's language) and a random number made and kept by that browser (`customer_id`: KLIPY asks for one per user; it is not the account or the
  profile). As with any website, KLIPY also sees the visitor's internet address.
- A GIF sent is a message whose text is the picture's address at KLIPY, kept as long as messages are. Both screens load the picture from KLIPY.
- A child's profile has no GIF button, and GIFs a friend sends a child are shown as a line, not loaded.

## Keyboard GIFs (Gboard, Samsung keyboard)

A phone keyboard's own GIF button sends a picture *file* through Android's `commitContent`, which a web page cannot receive. In a browser, the box
gets nothing. It is planned for the Android app (a WebView app can take `commitContent` and send the picture on).

## Where it lives

- `src/client/chat/gifs.ts`: KLIPY's addresses, what counts as a GIF message, the browser's random number. `useGifs.ts`: the asking.
  `GifPick.tsx`: the grid on every screen.
- `src/server/app.ts`: `/api/features` hands the key to the pages when `KLIPY_KEY` is set.
- Tests: `src/client/chat/gifs.test.ts`, "GIFs in a chat" in `e2e/chat.spec.ts` (a fake KLIPY: the tests never ask the real one).
