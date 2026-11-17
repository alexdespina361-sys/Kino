# Personal stickers

A picture of one's own, made into a sticker on the page and sent in a chat as Kino's own stickers are (the owner's plan, 15 Nov 2026). They are the first
thing on this site that people put up themselves, so they are **off until the host turns them on**: `PERSONAL_STICKERS=on` in the server's environment
(`/etc/kino-web.env` on the Oracle box, then restart `kino-web`). Off, nothing of them is offered, made, sent or shown, and what was made is kept for
when they are on again.

## What people get

- In a chat's sticker sheet (phone) or page (TV, computer, a hand-held screen showing the TV's pages), **Yours** comes first, then Kino's.
- A screen that is touched or clicked has **Add a picture**: the page takes the middle square of the chosen picture, at 192 by 192, and sends it as a PNG.
  Nothing else of the file goes (where and when a photo was taken, the camera: the canvas leaves all of it behind). **Edit** shows a × on each to let it go.
- A TV that is only a remote sends the ones its profile has (made on a phone or computer of the same profile); it cannot add or edit.
- A friend's personal sticker in a chat can be pressed (phone, computer, hand-held screen): **Save to my stickers** puts it in one's own, to send on.
- Children's profiles have none (they have no friends, so no chat).

## The rules (the server's)

- `src/server/accounts/stickerImage.ts`: the server reads the size first (a square of 16 to 192), unpacks it to exactly the size it says (a file cut short or
  padded is refused), checks every chunk, and keeps a PNG it made itself from the pixels. A picture with nothing in it (all see-through) is refused.
- A profile has at most 24 (made and kept); an account makes at most 20 a day; the site keeps at most 3000 pictures and 200 MB (`PERSONAL_STICKERS_MB`
  to say another). The same picture made twice by one profile is the same sticker.
- A picture is shown to the profiles that have it, and in a chat to the two whose chat it was sent in, while they are friends: nobody else.
- A picture is kept while somebody has it. The last one to let it go (or a profile, or an account, going) lets it go for good, and the messages that were it
  say "no longer available". A browser that saw it may show it for up to five minutes more (`private, max-age=300`).
- A report of a chat (the ⋯, Report) sends the pictures of the personal stickers in it as `sticker1.png`, ... beside `chat.txt`, which names each.

## The team's side

```
node scripts/stickers.mjs                                  every one: its name, when it was made, its size, how many have it, the profile / account that made it
node scripts/stickers.mjs show <name>                      saves .stickers/<name>.png to look at (open it with the Read tool)
node scripts/stickers.mjs remove <name> --yes              takes it down everywhere: every collection, every chat
node scripts/stickers.mjs remove-by <profile or account> --yes   all the ones a profile, or an account's profiles, made
```

`node scripts/stickers.mjs` is the same as `node scripts/feedback.mjs stickers`. It finds the site and the team's token the same way the feedback does
([docs/feedback.md](feedback.md)). `.stickers/` is ignored by git, because people's pictures never go into this public repository.

## Where it lives

- `src/shared/stickers.ts`: the numbers, the names, what a message of one says in words (🖼️).
- `src/server/accounts/stickers.ts`: the book of who has which (in each account's document) and the switch; `stickerFiles.ts`: the pictures (table
  `kino_stickers` in Postgres, `stickers/` in a data folder, or memory); `stickerRoutes.ts`: the routes, the team's among them.
- `src/client/chat/personalStickers.ts`: making the picture, the calls, a profile's collection; `StickerPick.tsx` (Yours), `ChatLines.tsx` (the picture
  in a chat, and saving it).
- Tests: `src/server/accounts/stickers.test.ts`, `stickerWiring.test.ts`, the rows in `authorization.test.ts` and `robustness.test.ts`,
  `src/client/chat/personalStickers.test.ts`, and "personal stickers in a chat" in `e2e/chat.spec.ts`.
