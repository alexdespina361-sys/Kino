# Design drift: the polish look

373 screens scanned, 108097 elements measured (2026-10-13). Made by `scripts/ui-walk/drift.mjs` from the walk's live-DOM scans.

## What the pages use

TV sizes are in em (what the CSS wrote; 1em = the TV's own scale), the phone's in px. 'screens' = how many of the walk's pictures have it.

### TV / desktop screen

21 distinct type sizes, 6 weights, 6 radii, 25 surface colours, 12 text colours, 52 shadows, 17 transitions.

**Type sizes**

| value | count | pages | sample |
|---|---|---|---|
| 1.7em | 1603 | 132 | button[rail-search] |
| 1.3em | 1397 | 107 | span.tv-tile-name "The Long Night" |
| 1em | 1059 | 96 | button[tv-browse-tile] (The Long Harbour) |
| 1.5em | 768 | 120 | button[tv-account-chip] (Sign in) |
| 8.7em | 238 | 34 | b "1" |
| 2em | 172 | 61 | p "Welcome" |
| 2.2em | 144 | 122 | span "Kin" |
| 3.2em | 88 | 84 | h1[tv-hero-title] "The Long Harbour" |
| 1.9em | 84 | 3 | button[key-a] "a" |
| 4.2em | 51 | 45 | h1[tv-detail-title] "Paper Moons" |
| 2.6em | 47 | 45 | h1[tv-hero-title] "Blue Hour" |
| 1.6em | 42 | 7 | button[tv-accent-red] (Red) |
| 3em | 30 | 3 | button[rate-score-1] "1" |
| 2.3em | 13 | 11 | button[tv-play-btn] (Pause) |
| 1.4em | 6 | 2 | button[key-space] "Space" |
| 1.2em | 6 | 2 | button[name-key-space] "Space" |
| 8.4em | 6 | 6 | p[pairing-code] "123 456" |
| 6.8em | 3 | 3 | p[tv-link-code] "ABCD-2345" |
| 1.8em | 2 | 2 | input[rate-note-input] |
| 3.4em | 2 | 2 | p[tv-friend-code] "ABCD-2345" |
| 7em | 1 | 1 | span "Kin" |

**Weights**

| value | count | pages | sample |
|---|---|---|---|
| 600 | 2600 | 132 | button[rail-search] |
| 400 | 2031 | 133 | button[fullscreen-toggle] (Full screen) |
| 700 | 703 | 133 | h1[tv-hero-title] "The Long Harbour" |
| 900 | 238 | 34 | b "1" |
| 800 | 189 | 122 | span "Kin" |
| 500 | 1 | 1 | span.tv-query-hint "Search titles" |

**Line heights**

| value | count | pages | sample |
|---|---|---|---|
| normal | 3786 | 133 | button[rail-search] |
| 1.7em | 560 | 77 | span.tv-tile-name "The Long Night" |
| 1.85em | 321 | 104 | button[tv-hero-play] "Play" |
| 6.8em | 238 | 34 | b "1" |
| 1.95em | 173 | 80 | span[score-badge] "7" |
| 2.2em | 142 | 122 | span "Kin" |
| 1.65em | 102 | 24 | button[tv-detail-close] "Close" |
| 2.1em | 91 | 10 | p.tv-hero-about "A dockworker's last winter in a town tha" |
| 2em | 55 | 11 | button.tv-btn (Back 10 seconds) |
| 3.6em | 41 | 41 | h1[tv-hero-title] "The Long Harbour" |
| 1.3em | 39 | 13 | button[name-key-space] "Space" |
| 2.3em | 39 | 26 | p "Sign in and what you watch on your phone" |

**Radii**

| value | count | pages | sample |
|---|---|---|---|
| pill / circle | 1582 | 133 | span.logo-o |
| 0.7em | 500 | 121 | button[tv-hero-play] "Play" |
| 0.45em | 212 | 10 | button[key-a] "a" |
| 1.1em | 35 | 23 | div.tv-qr |
| 0.75em | 4 | 2 | span.profile-picture |
| 3.9em | 1 | 1 | span.logo-o |

**Icon sizes**

| value | count | pages | sample |
|---|---|---|---|
| 1.95em | 540 | 60 | svg |
| 1.15em | 472 | 46 | svg |
| 1.2em | 353 | 31 | svg |
| 2em | 277 | 33 | svg |
| 1.7em | 140 | 57 | svg |
| 1.8em | 113 | 81 | svg |
| 1.5em | 103 | 72 | svg |
| 2.6em | 78 | 23 | svg |
| 1.3em | 72 | 30 | svg |
| 1.45em | 67 | 57 | svg |
| 1.35em | 63 | 31 | svg |
| 2.75em | 52 | 48 | svg |
| 2.7em | 42 | 42 | svg |
| 2.05em | 30 | 6 | svg |
| 4.6em | 23 | 13 | svg |

**Gaps**

| value | count | pages | sample |
|---|---|---|---|
| 1.35em | 792 | 88 | button[rail-search] |
| 0.6em | 238 | 50 | button[tv-hero-play] "Play" |
| 0.9em | 122 | 99 | button[tv-account-chip] (Sign in) |
| 0.85em | 109 | 54 | button[welcome-enter] "Start watching" |
| 0.35em | 108 | 42 | span[score-badge] "7" |
| 0.7em | 94 | 24 | button[filter-all] "All" |
| 0.75em | 84 | 3 | button[key-a] "a" |
| 0.2em | 58 | 20 | button[tv-category-tile] (Popular this week) |
| 0.8em | 55 | 11 | button.tv-btn (Back 10 seconds) |
| 0.5em | 46 | 21 | button[name-key-space] "Space" |
| 1.1em | 29 | 13 | button[tv-episode] |
| 0.3em | 25 | 11 | nav[tv-rail] (Library menu) |
| 3.4em | 23 | 7 | button[tv-autoplay] |
| 0.4em | 20 | 6 | span.tv-ep-meta "38 min" |
| 3em | 12 | 2 | button[tv-friends-lists] |

**Text colours**

| value | count | pages | sample |
|---|---|---|---|
| #c9c9d1 | 2175 | 101 | button[tv-account-chip] (Sign in) |
| #9b9ba3 | 1487 | 133 | button[rail-search] |
| #f5f5f7 | 1207 | 133 | button[rail-home] |
| #ffffff | 550 | 132 | h1[tv-hero-title] "The Long Harbour" |
| #0b0b0c | 286 | 67 | b "1" |
| #111111 | 21 | 7 | button[tv-accent-green] (Green) |
| #ffffff50% | 18 | 14 | span.tv-tile-initial "H" |
| #222222 | 10 | 10 | p "Or scan this with your camera" |
| #cfcfd4 | 4 | 2 | li "40% watched" |
| #ffb4b4 | 2 | 2 | button[friend-remove] "Remove friend" |
| #55555c | 1 | 1 | small "This screen plays, and the ones you invi" |
| #6f6f78 | 1 | 1 | span.tv-query-hint "Search titles" |

**Surface colours**

| value | count | pages | sample |
|---|---|---|---|
| #0b0b0c72% | 974 | 77 | span[tv-tile-corner] (Add to Favourites) |
| #0b0b0c | 368 | 138 | div |
| #232327 | 321 | 61 | button[key-b] "b" |
| #e50914 | 297 | 104 | button[tv-hero-play] "Play" |
| #ffffff8% | 255 | 101 | button[tv-account-chip] (Sign in) |
| #ffffff14% | 173 | 70 | svg |
| #000000 | 139 | 138 | main[tv] |
| #ffffff28% | 129 | 57 | span.tv-tile-progress |
| #0b0b0c45% | 112 | 88 | div.tv-browse-shade |
| #18181b | 76 | 33 | input[rate-note-input] |
| #ffffff | 50 | 47 | button[welcome-enter] "Start watching" |
| #e5091422% | 38 | 27 | button[filter-all] "All" |
| #ffffff38% | 11 | 11 | div.hud-bar-buffered |
| #3f3f46 | 9 | 9 | button[tv-episode] |
| #00000045% | 8 | 8 | span.tv-ep-play |
| #2b7fff | 7 | 7 | button[tv-accent-blue] (Blue) |
| #9b5cff | 7 | 7 | button[tv-accent-purple] (Purple) |
| #1fb86a | 7 | 7 | button[tv-accent-green] (Green) |
| #ff8a1f | 7 | 7 | button[tv-accent-orange] (Orange) |
| #ff4f9a | 7 | 7 | button[tv-accent-pink] (Pink) |

**Borders**

| value | count | pages | sample |
|---|---|---|---|
| 3 solid #e50914 | 5 | 5 | span.spinner |
| 2 solid #e50914 | 5 | 5 | input[auth-email] |
| 1 solid #e50914 | 2 | 2 | input[rate-note-input] |
| 2 solid #ffffff10% | 2 | 2 | input[auth-password] |
| 1 solid #ffffff10% | 2 | 2 | div[audio-subtitles-modal] (Playback speed) |
| 2 dashed #ffffff28% | 2 | 2 | span.profile-picture |
| 3 solid #ffffff10% | 1 | 1 | input[auth-email] |

**Shadows**

| value | count | pages | sample |
|---|---|---|---|
| rgba(255, 255, 255, 0.22) 0px 0px 0px 1px | 974 | 77 | span[tv-tile-corner] (Add to Favourites) |
| rgba(229, 9, 20, 0.5) 0px 2.816px 19.712px 0px, rgba(255, 255, 255, 0.3) 0px 1.9712px 0px 0px inset | 78 | 65 | span.logo-o |
| rgba(229, 9, 20, 0.5) 0px 4.224px 29.568px 0px, rgba(255, 255, 255, 0.3) 0px 2.9568px 0px 0px inset | 37 | 30 | span.logo-o |
| rgb(229, 9, 20) 0px 0px 0px 1.792px inset | 20 | 15 | button[filter-all] "All" |
| rgb(11, 11, 12) 0px 0px 0px 1.28px, rgb(255, 255, 255) 0px 0px 0px 3.84px, rgba(0, 0, 0, 0.6) 0px 8.96px 23.04px 0px | 13 | 12 | span.tv-tile-art |
| rgba(0, 0, 0, 0.6) 0px 8.96px 23.04px 0px | 11 | 11 | button[tv-back-to-library] "Back to the library" |
| rgba(229, 9, 20, 0.5) 0px 3.00377px 21.0264px 0px, rgba(255, 255, 255, 0.3) 0px 2.10264px 0px 0px inset | 9 | 9 | span.logo-o |
| rgba(229, 9, 20, 0.5) 0px 3.168px 22.176px 0px, rgba(255, 255, 255, 0.3) 0px 2.2176px 0px 0px inset | 9 | 9 | span.logo-o |

**Transitions**

| value | count | pages | sample |
|---|---|---|---|
| background, color, transform 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 2992 | 88 | button[tv-account-chip] (Sign in) |
| transform, color 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 2788 | 77 | button[tv-browse-tile] (The Long Harbour) |
| background, color, margin-right 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 792 | 88 | button[rail-search] |
| transform, background, color, box-shadow 0.18s, 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 621 | 83 | button[welcome-enter] "Start watching" |
| -webkit-text-stroke-color 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 546 | 55 | b "1" |
| background, color, transform, box-shadow 0.18s, 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 171 | 52 | button[tv-hero-play] "Play" |
| transform, box-shadow 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 150 | 30 | button[tv-category-tile] (Popular this week) |
| opacity 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 61 | 13 | span "Search" |
| background 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 35 | 9 | span.tv-switch |
| opacity 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) | 24 | 24 | div[tv-detail] (Paper Moons) |
| box-shadow 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 20 | 20 | span.tv-tile-art |
| border-color, box-shadow 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 14 | 11 | input[rate-note-input] |
| height 0.12s cubic-bezier(0.2, 0.8, 0.2, 1) | 11 | 11 | div.hud-bar-track |
| width 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 6 | 6 | nav[tv-rail] (Library menu) |
| opacity 0.12s cubic-bezier(0.2, 0.8, 0.2, 1) | 6 | 6 | span.tv-ep-play |

**Animations**

| value | count | pages | sample |
|---|---|---|---|
| tv-fade-in 1s | 112 | 88 | div.tv-hero-bg |
| tv-fade, tv-arrive 0.25s, 0.5s | 24 | 24 | div[tv-detail] (Paper Moons) |
| tv-welcome-in 0.9s | 2 | 1 | p "Welcome" |
| tv-blink 1s | 2 | 2 | i.tv-caret |
| tv-fade 0.2s | 2 | 2 | div.tv-menu-backdrop |
| spin 0.9s | 1 | 1 | span.spinner |

### Phone

20 distinct type sizes, 5 weights, 10 radii, 27 surface colours, 10 text colours, 13 shadows, 17 transitions.

**Type sizes**

| value | count | pages | sample |
|---|---|---|---|
| 16px | 3083 | 235 | span "Kin" |
| 14px | 2522 | 235 | button[account-button] "Sign in" |
| 13px | 1250 | 153 | span[tv-online] "TV connected" |
| 17.6px | 1020 | 195 | button[continue-list-toggle] (Add to a list: The Glass Orchard) |
| 18px | 807 | 229 | h1[tv-name] "TV 4F2A" |
| 20px | 568 | 229 | button[fullscreen-toggle] (Full screen) |
| 12px | 461 | 76 | span[tv-online] "TV connected" |
| 24px | 255 | 209 | h1 "Connect to your TV" |
| 36px | 118 | 118 | button[account-button] (Account and profiles: Dana) |
| 32px | 105 | 65 | span[control-code] "123 456" |
| 19.2px | 84 | 14 | button[accent-red] (Red) |
| 40px | 34 | 34 | button[pause] (Pause) |
| 12.8px | 28 | 22 | button[friend-request-decline] (Decline) |
| 16.8px | 6 | 6 | span "Kin" |
| 28.8px | 5 | 5 | input[code-input] (6-digit code from the TV) |
| 33.6px | 5 | 5 | input[code-input] (6-digit code from the TV) |
| 7.45px | 4 | 4 | span.cap-sample "This is how your subtitles will look" |
| 8.56px | 4 | 4 | span.cap-sample "This is how your subtitles will look" |
| 8.49px | 2 | 2 | span.cap-sample "This is how your subtitles will look" |
| 9.26px | 2 | 2 | span.cap-sample "This is how your subtitles will look" |

**Weights**

| value | count | pages | sample |
|---|---|---|---|
| 400 | 5064 | 235 | button[fullscreen-toggle] (Full screen) |
| 600 | 3530 | 235 | button[scan] "Scan the TV's QR code" |
| 700 | 1647 | 235 | button[account-button] "Sign in" |
| 800 | 112 | 70 | span "Kin" |
| 500 | 10 | 10 | small "1 friend" |

**Line heights**

| value | count | pages | sample |
|---|---|---|---|
| normal | 8286 | 235 | button[fullscreen-toggle] (Full screen) |
| 17.5px | 737 | 169 | span.lib-title "The Glass Orchard" |
| 28.8px | 209 | 203 | h2 "What do you want to watch?" |
| 22.5px | 203 | 203 | h1[tv-name] "TV 4F2A" |
| 18.85px | 193 | 83 | p[title-meta] "2011 · Movie" |
| 23.2px | 187 | 120 | p.muted "Open on your TV and choose in its menu. " |
| 18px | 118 | 118 | b[bell-badge] "2" |
| 0px | 118 | 118 | button[account-button] (Account and profiles: Dana) |
| 20.3px | 104 | 67 | p.muted "Open on your TV and choose in its menu. " |
| 17.4px | 96 | 38 | p[title-meta] "2011 · Movie" |
| 19.5px | 56 | 26 | span[score-badge] "10" |
| 24px | 12 | 12 | p.muted "Two sisters run a failing cinema and dec" |

**Radii**

| value | count | pages | sample |
|---|---|---|---|
| pill / circle | 2707 | 235 | span.logo-o |
| 12px | 1290 | 235 | button[scan] "Scan the TV's QR code" |
| 8px | 248 | 181 | button[switch-lang-en] "English" |
| 22px | 94 | 88 | div[title-sheet] (Paper Moons) |
| 14px | 18 | 6 | span.profile-picture |
| 10px | 12 | 12 | span[party-link-url] "http://127.0.0.1:9641/?party=349801" |
| 0.89px | 4 | 4 | span.cap-sample "This is how your subtitles will look" |
| 1.03px | 4 | 4 | span.cap-sample "This is how your subtitles will look" |
| 1.02px | 2 | 2 | span.cap-sample "This is how your subtitles will look" |
| 1.11px | 2 | 2 | span.cap-sample "This is how your subtitles will look" |

**Icon sizes**

| value | count | pages | sample |
|---|---|---|---|
| 18px | 1138 | 222 | svg |
| 14px | 725 | 210 | svg |
| 20px | 696 | 229 | svg |
| 19px | 288 | 197 | svg |
| 21px | 225 | 203 | svg |
| 16px | 192 | 66 | svg |
| 36px | 118 | 118 | svg.avatar (Fox) |
| 40px | 75 | 59 | svg |
| 32px | 70 | 36 | svg |
| 12px | 63 | 30 | svg |
| 17px | 46 | 28 | svg |
| 13px | 28 | 22 | svg |
| 72px | 25 | 25 | svg.avatar (Fox) |
| 104px | 24 | 24 | svg[pairing-qr] (QR code that lets another phone control this TV) |
| 11px | 13 | 13 | svg |

**Gaps**

| value | count | pages | sample |
|---|---|---|---|
| 6px | 1950 | 235 | button[account-button] "Sign in" |
| 8px | 516 | 229 | button[scan] "Scan the TV's QR code" |
| 12px | 440 | 135 | p.or "or type the 6-digit code" |
| 4px | 149 | 69 | div[language-switch] (Language) |
| 10px | 114 | 70 | button[rate-title-toggle] |
| 3px | 57 | 27 | span[score-badge] "10" |
| 5px | 19 | 6 | span.rating-badge "9/10" |

**Text colours**

| value | count | pages | sample |
|---|---|---|---|
| #f5f5f7 | 5710 | 235 | span "Kin" |
| #9b9ba3 | 2709 | 235 | button[fullscreen-toggle] (Full screen) |
| #ffffff | 1311 | 213 | button[scan] "Scan the TV's QR code" |
| #d2d2d9 | 255 | 100 | span.code-card-title "Control with more phones (1 connected)" |
| #46d369 | 218 | 203 | span[tv-online] "TV connected" |
| #ff6b6b | 59 | 57 | button[tv-forget] "Forget" |
| #111111 | 42 | 14 | button[accent-green] (Green) |
| #0b0b0c | 34 | 34 | button[pause] (Pause) |
| #ffffff50% | 19 | 19 | span.poster-initial "H" |
| #f6121d | 6 | 6 | button[library-list-toggle] (In your lists: Velvet Static) |

**Surface colours**

| value | count | pages | sample |
|---|---|---|---|
| #232328 | 1213 | 231 | button[account-button] "Sign in" |
| #00000062% | 1114 | 223 | button[continue-list-toggle] (Add to a list: The Glass Orchard) |
| #e50914 | 834 | 231 | button[scan] "Scan the TV's QR code" |
| #17171a | 563 | 228 | input[code-input] (6-digit code from the TV) |
| #00000055% | 456 | 173 | span.lib-progress |
| #2e2e34 | 392 | 88 | button[title-list] "My Lists" |
| #0b0b0c | 336 | 213 | div |
| #e5091422% | 131 | 69 | button[switch-lang-en] "English" |
| #1c1c20 | 94 | 88 | div[title-sheet] (Paper Moons) |
| #ffffff24% | 94 | 88 | div.sheet-grip |
| #ffffff20% | 71 | 65 | span.switch |
| #00000068% | 57 | 27 | span[score-badge] "10" |
| #25252a | 51 | 37 | section[rate-title] (Your rating) |
| #ffffff18% | 34 | 34 | div.seek-track |
| #ffffff | 34 | 34 | button[pause] (Pause) |
| #e5091420% | 20 | 20 | button[tv-switch] |
| #2b7fff | 14 | 14 | button[accent-blue] (Blue) |
| #9b5cff | 14 | 14 | button[accent-purple] (Purple) |
| #1fb86a | 14 | 14 | button[accent-green] (Green) |
| #ff8a1f | 14 | 14 | button[accent-orange] (Orange) |

**Borders**

| value | count | pages | sample |
|---|---|---|---|
| 1 solid #ffffff10% | 287 | 194 | input[code-input] (6-digit code from the TV) |
| 2 solid #ffffff30% | 37 | 10 | span.choice-dot |
| 2 solid #e50914 | 14 | 14 | span.choice-dot |
| 2 dashed #ffffff28% | 6 | 6 | span.profile-picture |

**Shadows**

| value | count | pages | sample |
|---|---|---|---|
| rgb(229, 9, 20) 0px 0px 0px 1.5px inset | 151 | 89 | button[switch-lang-en] "English" |
| rgb(11, 11, 12) 0px 0px 0px 2px | 117 | 117 | b[bell-badge] "2" |
| rgba(0, 0, 0, 0.5) 0px -12px 40px 0px | 94 | 88 | div[title-sheet] (Paper Moons) |
| rgba(255, 255, 255, 0.28) 0px 0px 0px 1px | 57 | 27 | span[score-badge] "10" |
| rgb(11, 11, 12) 0px 0px 0px 3px, rgb(255, 255, 255) 0px 0px 0px 5px | 14 | 14 | button[accent-red] (Red) |
| rgba(255, 255, 255, 0.16) 0px 0px 0px 1.5px inset | 12 | 12 | button[pick-new] |
| rgba(0, 0, 0, 0.45) 0px 6px 14px 0px | 12 | 12 | div[caption-preview] |
| rgba(229, 9, 20, 0.5) 0px 1.6px 11.2px 0px, rgba(255, 255, 255, 0.3) 0px 1.12px 0px 0px inset | 6 | 6 | span.logo-o |

**Transitions**

| value | count | pages | sample |
|---|---|---|---|
| background, transform 0.15s, 0.1s ease, ease | 10521 | 195 | button[continue-list-toggle] (Add to a list: The Glass Orchard) |
| transform, background, color 0.08s, 0.15s, 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 1880 | 235 | button[switch-lang-en] "English" |
| transform, background 0.08s, 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 667 | 235 | button[scan] "Scan the TV's QR code" |
| background 0.18s ease | 393 | 45 | span.switch |
| color, opacity 0.15s, 0.1s ease, ease | 390 | 195 | button[lists-manage] "Manage lists" |
| background, transform 0.15s, 0.08s ease, ease | 180 | 82 | button[library-result] (Harvest Moon Motel) |
| background 0.12s ease | 138 | 24 | button[menu-ratings] |
| transform, box-shadow 0.15s, 0.15s ease, ease | 120 | 120 | button[account-button] (Account and profiles: Dana) |
| transform 0.08s ease | 102 | 34 | button.round (Back 10 seconds) |
| border-color, box-shadow 0.15s, 0.15s ease, ease | 84 | 45 | input[tv-rename] |
| color 0.15s ease | 60 | 24 | svg |
| opacity 0.12s ease | 45 | 45 | svg |
| height 0.1s ease | 34 | 34 | div.seek-track |
| width, height 0.1s, 0.1s ease, ease | 34 | 34 | div.seek-thumb |
| background 0.15s ease | 24 | 18 | button[rate-title-toggle] |

**Animations**

| value | count | pages | sample |
|---|---|---|---|
| page-in 0.22s | 123 | 123 | div[account-screen] (Account) |
| fade-in 0.18s | 94 | 88 | div.sheet-backdrop |
| sheet-up 0.24s | 94 | 88 | div[title-sheet] (Paper Moons) |

# Rule breaks

## Text smaller than the floor (4)

TV: 1.15% of the screen width (the test suite's rule). Phone: 12 px.

| element | size | floor | count | pictures |
|---|---|---|---|---|
| span.cap-sample "This is how your subtitles will look" | 7.45 | 12 | 4 | 4 |
| span.cap-sample "This is how your subtitles will look" | 8.49 | 12 | 2 | 2 |
| span.cap-sample "This is how your subtitles will look" | 8.56 | 12 | 4 | 4 |
| span.cap-sample "This is how your subtitles will look" | 9.26 | 12 | 2 | 2 |



## Text with too little contrast (3)

4.5:1 (3:1 for large text). Text over a picture is not measured.

| element | ratio | need | fg | bg | count | pictures |
|---|---|---|---|---|---|---|
| small.cap-count "1" | 3.72 | 4.5 | #9b9ba3 | #404044 | 4 | 4 |
| span.tv-ep-meta "38 min" | 3.79 | 4.5 | #9b9ba3 | #3f3f46 | 3 | 3 |
| span.tv-ep-about "The harbour wakes late, and everyone pre" | 3.79 | 4.5 | #9b9ba3 | #3f3f46 | 3 | 3 |



## Controls with no name (36)

A control with no text, aria-label or title cannot be told apart by a screen reader.

| element | size | count | pictures |
|---|---|---|---|
| input[tv-rename] | 288x48 | 1 | 1 |
| input[auth-email] | 288x48 | 1 | 1 |
| input[auth-password] | 288x48 | 1 | 1 |
| input[password-current] | 288x48 | 1 | 1 |
| input[password-new] | 288x48 | 1 | 1 |
| input[tv-rename] | 328x48 | 1 | 1 |
| input[auth-email] | 328x48 | 1 | 1 |
| input[auth-password] | 328x48 | 1 | 1 |
| input[password-current] | 328x48 | 1 | 1 |
| input[password-new] | 328x48 | 1 | 1 |
| input[tv-rename] | 358x48 | 1 | 1 |
| input[auth-email] | 358x48 | 1 | 1 |
| input[auth-password] | 358x48 | 1 | 1 |
| input[password-current] | 358x48 | 1 | 1 |
| input[password-new] | 358x48 | 1 | 1 |
| input[tv-rename] | 648x48 | 3 | 3 |
| input[auth-email] | 520x48 | 1 | 1 |
| input[auth-password] | 520x48 | 1 | 1 |
| input[password-current] | 520x48 | 6 | 6 |
| input[password-new] | 520x48 | 6 | 6 |
| input[auth-email] | 386x48 | 1 | 1 |
| input[auth-password] | 386x48 | 1 | 1 |
| input[auth-email] | 430x48 | 1 | 1 |
| input[auth-password] | 430x48 | 1 | 1 |
| input[rate-note-input] | 896x54 | 1 | 1 |
| input[list-name-input] | 589x54 | 1 | 1 |
| input[auth-email] | 640x61 | 2 | 2 |
| input[auth-password] | 640x61 | 2 | 2 |
| input[tv-friend-tag-input] | 640x61 | 1 | 1 |
| input[profile-name-input] | 589x61 | 1 | 1 |
| input[tv-approve-input] | 640x61 | 1 | 1 |
| input[auth-email] | 960x92 | 1 | 1 |
| input[auth-password] | 960x92 | 1 | 1 |
| input[tv-friend-tag-input] | 960x92 | 1 | 1 |
| input[profile-name-input] | 883x92 | 1 | 1 |
| input[tv-approve-input] | 960x92 | 1 | 1 |



## Controls under 24 px (0)

WCAG 2.2 target size (minimum), AA.

None.

## Phone controls under 44 px (5)

The comfortable thumb target. Links inside running text are left out.

| element | size | count | pictures |
|---|---|---|---|
| button[accent-blue] (Blue) | 41x41 | 2 | 2 |
| button[accent-purple] (Purple) | 41x41 | 2 | 2 |
| button[accent-green] (Green) | 41x41 | 2 | 2 |
| button[accent-orange] (Orange) | 41x41 | 2 | 2 |
| button[accent-pink] (Pink) | 41x41 | 2 | 2 |



## Text or controls outside the TV's safe margin (38)

Inside 2.5% of the left/right edge or 5% of the top/bottom. What crosses an edge (a row that scrolls past it, the page under its fade) and the pictures of such a row with the words under them are not counted.

| element | edges | count | pictures |
|---|---|---|---|
| button[tv-season-1] "Season 1" | 7.3% .. 18.6% / 90.1% .. 97.6% | 1 | 1 |
| button[tv-season-2] "Season 2" | 19.5% .. 31.1% / 90.1% .. 97.6% | 1 | 1 |
| button[tv-season-3] "Season 3" | 31.9% .. 43.5% / 90.1% .. 97.6% | 1 | 1 |
| p.tv-hero-eyebrow "Series to binge" | 7.0% .. 58.0% / 4.6% .. 8.2% | 1 | 1 |
| button[tv-detail-remove] "Remove from Continue watching" | 7.0% .. 37.9% / 0.3% .. 6.1% | 1 | 1 |
| button[tv-play-btn] (Pause) | 4.8% .. 8.8% / 88.2% .. 95.3% | 1 | 1 |
| b[tv-bell-badge] "2" | 79.6% .. 81.6% / 4.7% .. 8.2% | 3 | 3 |
| b[tv-bell-badge] "1" | 79.6% .. 81.6% / 4.7% .. 8.2% | 11 | 11 |
| button[friend-remove] "Remove friend" | 7.0% .. 25.4% / 89.3% .. 96.8% | 1 | 1 |
| p.tv-hint "Pick which subtitle languages are listed" | 41.0% .. 87.6% / 94.7% .. 98.3% | 1 | 1 |
| button[tv-season-1] "Season 1" | 7.3% .. 18.7% / 90.1% .. 97.8% | 2 | 2 |
| button[tv-season-2] "Season 2" | 19.5% .. 31.1% / 90.1% .. 97.8% | 2 | 2 |
| button[tv-season-3] "Season 3" | 31.8% .. 43.5% / 90.1% .. 97.8% | 1 | 1 |
| p.tv-hero-eyebrow "Series to binge" | 7.0% .. 58.0% / 4.6% .. 8.1% | 1 | 1 |
| h1[tv-title] "long" | 5.0% .. 10.4% / 4.9% .. 11.1% | 1 | 1 |
| div.hud-clock "00:02" | 87.4% .. 95.0% / 4.9% .. 9.0% | 1 | 1 |
| button[tv-play-btn] (Pause) | 5.0% .. 8.6% / 88.5% .. 95.1% | 1 | 1 |
| button[tv-account-chip] (Sign in) | 80.1% .. 90.5% / 4.7% .. 10.4% | 7 | 7 |
| button[fullscreen-toggle] (Full screen) | 91.4% .. 95.0% / 4.7% .. 10.4% | 7 | 7 |
| button[tv-detail-close] "Close" | 86.0% .. 95.0% / 4.7% .. 9.6% | 3 | 3 |
| button[tv-season-1] "Season 1" | 7.3% .. 18.7% / 91.1% .. 97.9% | 1 | 1 |
| button[tv-season-2] "Season 2" | 19.4% .. 31.0% / 91.1% .. 97.9% | 1 | 1 |
| button[tv-season-3] "Season 3" | 31.9% .. 43.5% / 91.1% .. 97.9% | 1 | 1 |
| span.tv-ep-name "Salt" | 24.7% .. 27.4% / 96.2% .. 99.3% | 1 | 1 |
| span.tv-ep-meta "44 min" | 63.1% .. 67.0% / 96.6% .. 99.3% | 1 | 1 |
| h1[tv-title] "long" | 5.0% .. 10.4% / 4.4% .. 9.9% | 1 | 1 |
| div.hud-clock "00:02" | 87.4% .. 95.0% / 4.4% .. 8.0% | 1 | 1 |
| button[tv-play-btn] (Pause) | 5.0% .. 8.7% / 89.7% .. 95.6% | 1 | 1 |
| button[tv-season-1] "Season 1" | 7.3% .. 18.6% / 90.2% .. 97.8% | 1 | 1 |
| button[tv-season-2] "Season 2" | 19.5% .. 31.1% / 90.2% .. 97.8% | 1 | 1 |
| button[tv-season-3] "Season 3" | 31.9% .. 43.5% / 90.2% .. 97.8% | 1 | 1 |
| p.tv-hero-eyebrow "Series to binge" | 7.0% .. 58.0% / 4.5% .. 8.1% | 2 | 2 |
| button[tv-play-btn] (Pause) | 5.0% .. 8.7% / 88.5% .. 95.1% | 2 | 2 |
| b[tv-bell-badge] "2" | 79.6% .. 81.6% / 4.7% .. 8.1% | 3 | 3 |
| b[tv-bell-badge] "1" | 79.6% .. 81.6% / 4.7% .. 8.1% | 11 | 11 |
| button[friend-remove] "Remove friend" | 7.0% .. 25.4% / 89.2% .. 96.8% | 1 | 1 |
| p.tv-hint "Pick which subtitle languages are listed" | 41.0% .. 87.6% / 94.6% .. 98.1% | 1 | 1 |
| button[tv-season-3] "Season 3" | 31.9% .. 43.5% / 90.1% .. 97.8% | 1 | 1 |



## Text that is cut without an ellipsis (13)

| element | size | count | pictures |
|---|---|---|---|
| span.tv-category-name "My ratings" (cut off at the bottom) | 242x36 | 2 | 2 |
| span.tv-category-name "History" (cut off at the bottom) | 242x36 | 2 | 2 |
| span.tv-category-name "Sign in" (cut off at the bottom) | 242x36 | 1 | 1 |
| span.tv-category-name "Settings" (cut off at the bottom) | 242x36 | 2 | 2 |
| span.tv-category-name "Friends" (cut off at the bottom) | 242x36 | 1 | 1 |
| span.tv-category-name "Cy#1" (cut off at the bottom) | 252x36 | 6 | 6 |
| span.tv-category-name "Ben" (cut off at the bottom) | 252x36 | 5 | 5 |
| span.tv-category-name "Add a friend" (cut off at the bottom) | 242x36 | 5 | 5 |
| span.tv-category-name "Friends settings" (cut off at the bottom) | 242x36 | 5 | 5 |
| span.tv-category-name "My ratings" (cut off at the bottom) | 323x48 | 1 | 1 |
| span.tv-category-name "History" (cut off at the bottom) | 323x48 | 1 | 1 |
| span.tv-category-name "Sign in" (cut off at the bottom) | 323x48 | 1 | 1 |
| span.tv-category-name "Settings" (cut off at the bottom) | 323x48 | 1 | 1 |



## Screens that scroll sideways (0)

None.

## TV screens with nothing focused (19)

- tv-1280/21-signin-code
- tv-1280/23-connect
- tv-1280/26-player-hud
- tv-1280/26b-player-hud-live
- tv-1280/29-player-clean
- tv-1280-signed-in/s19-player-hud-signed-in
- tv-1366x768/23-connect
- tv-1366x768/26-player-hud
- tv-1366x768/29-player-clean
- tv-1440x900/23-connect
- tv-1440x900/26-player-hud
- tv-1440x900/29-player-clean
- tv-1920/23-connect
- tv-1920/26-player-hud
- tv-1920/29-player-clean
- tv-1920-signed-in/s19-player-hud-signed-in
- tv-2560/23-connect
- tv-2560/26-player-hud
- tv-2560/29-player-clean

## Screens with no keyboard-reachable control (5)

- tv-1280/29-player-clean
- tv-1366x768/29-player-clean
- tv-1440x900/29-player-clean
- tv-1920/29-player-clean
- tv-2560/29-player-clean
