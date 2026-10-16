# Design drift: the polish look

180 screens scanned, 37166 elements measured (2026-10-16). Made by `scripts/ui-walk/drift.mjs` from the walk's live-DOM scans.

## What the pages use

TV sizes are in em (what the CSS wrote; 1em = the TV's own scale), the phone's in px. 'screens' = how many of the walk's pictures have it.

### TV / desktop screen

21 distinct type sizes, 6 weights, 10 radii, 28 surface colours, 12 text colours, 60 shadows, 20 transitions.

**Type sizes**

| value | count | pages | sample |
|---|---|---|---|
| 1.7em | 1415 | 124 | button[rail-search] |
| 1.3em | 1392 | 112 | span.tv-tile-name "The Long Night" |
| 1em | 1049 | 98 | button[tv-browse-tile] (The Long Harbour) |
| 1.5em | 957 | 125 | button[tv-account-chip] (Sign in) |
| 2.2em | 241 | 127 | span "Kin" |
| 8.7em | 238 | 34 | b "1" |
| 2em | 211 | 83 | p "Welcome" |
| 1.9em | 92 | 3 | button[key-a] "a" |
| 3.2em | 83 | 79 | h1[tv-hero-title] "The Long Harbour" |
| 4.2em | 61 | 55 | h1[tv-detail-title] "Paper Moons" |
| 1.6em | 60 | 10 | button[tv-accent-red] (Red) |
| 2.6em | 59 | 56 | h1[tv-hero-title] "Blue Hour" |
| 3em | 30 | 3 | button[rate-score-1] "1" |
| 2.3em | 15 | 12 | button[tv-play-btn] (Pause) |
| 1.2em | 6 | 2 | button[name-key-space] "Space" |
| 8.4em | 6 | 6 | p[pairing-code] "123 456" |
| 6.8em | 3 | 3 | p[tv-link-code] "ABCD-2345" |
| 1.4em | 2 | 2 | button[key-space] "Space" |
| 1.8em | 2 | 2 | input[rate-note-input] |
| 3.4em | 2 | 2 | p[tv-friend-code] "ABCD-2345" |
| 7em | 1 | 1 | span "Kin" |

**Weights**

| value | count | pages | sample |
|---|---|---|---|
| 600 | 2617 | 139 | button[rail-search] |
| 400 | 2069 | 139 | button[fullscreen-toggle] (Full screen) |
| 700 | 716 | 139 | h1[tv-hero-title] "The Long Harbour" |
| 800 | 284 | 127 | span "Kin" |
| 900 | 238 | 34 | b "1" |
| 500 | 1 | 1 | span.tv-query-hint "Search titles" |

**Line heights**

| value | count | pages | sample |
|---|---|---|---|
| normal | 3717 | 139 | button[rail-search] |
| 1.7em | 560 | 77 | span.tv-tile-name "The Long Night" |
| 1.95em | 259 | 90 | span[score-badge] "7" |
| 6.8em | 238 | 34 | b "1" |
| 2.2em | 237 | 127 | span "Kin" |
| 1.85em | 224 | 88 | button[tv-hero-play] "Play" |
| 1.65em | 150 | 65 | button[tv-detail-close] "Close" |
| 2.1em | 107 | 18 | p.tv-hero-about "A dockworker's last winter in a town tha" |
| 2em | 60 | 12 | button.tv-btn (Back 10 seconds) |
| 2.15em | 46 | 13 | span.tv-category-name "Popular this week" |
| 2.3em | 44 | 30 | p.tv-profile-line "Sign in and what you watch on your phone" |
| 1.3em | 42 | 14 | button[name-key-space] "Space" |

**Radii**

| value | count | pages | sample |
|---|---|---|---|
| pill / circle | 1827 | 139 | span.logo-o |
| 0.7em | 426 | 126 | button[tv-hero-play] "Play" |
| 0.45em | 232 | 20 | button[key-a] "a" |
| 1.1em | 100 | 44 | button[tv-category-tile] (My ratings) |
| 3.9em | 6 | 6 | span.logo-o |
| 0.75em | 4 | 2 | span.profile-picture |
| 1.95em | 4 | 2 | button[tv-row-next] |
| 2.6em | 2 | 2 | span.tv-profile-guest |
| 3.65em | 1 | 1 | span.tv-profile-guest |
| 3.45em | 1 | 1 | span.tv-profile-guest |

**Icon sizes**

| value | count | pages | sample |
|---|---|---|---|
| 1.95em | 496 | 62 | svg |
| 1.15em | 472 | 46 | svg |
| 1.2em | 353 | 31 | svg |
| 2em | 307 | 41 | svg |
| 1.5em | 198 | 89 | svg |
| 1.7em | 159 | 69 | svg |
| 1.8em | 124 | 86 | svg |
| 1.45em | 112 | 57 | svg |
| 2.6em | 79 | 24 | svg |
| 1.3em | 73 | 31 | svg |
| 2.05em | 71 | 22 | svg |
| 1.35em | 65 | 33 | svg |
| 2.75em | 54 | 50 | svg |
| 2.7em | 42 | 42 | svg |
| 2.4em | 27 | 17 | svg |

**Gaps**

| value | count | pages | sample |
|---|---|---|---|
| 1.35em | 720 | 90 | button[rail-search] |
| 0.6em | 262 | 70 | button[tv-hero-play] "Play" |
| 0.35em | 130 | 52 | span[score-badge] "7" |
| 0.9em | 125 | 102 | button[tv-account-chip] (Sign in) |
| 0.75em | 99 | 10 | button[key-a] "a" |
| 0.85em | 72 | 39 | button[welcome-enter] "Start watching" |
| 0.3em | 66 | 52 | nav[tv-rail] (Library menu) |
| 0.8em | 60 | 12 | button.tv-btn (Back 10 seconds) |
| 0.7em | 59 | 17 | button[filter-all] "All" |
| 3em | 56 | 12 | button[tv-ratings-switch] |
| 0.5em | 48 | 22 | button[name-key-space] "Space" |
| 0.4em | 44 | 24 | button[tv-detail-close] "Close" |
| 0.2em | 36 | 22 | button[tv-category-tile] (Popular this week) |
| 1.1em | 29 | 13 | button[tv-episode] |
| 1.7em | 13 | 3 | button.tv-opt |

**Text colours**

| value | count | pages | sample |
|---|---|---|---|
| #c9c9d1 | 2189 | 133 | button[tv-account-chip] (Sign in) |
| #9b9ba3 | 1450 | 139 | button[rail-search] |
| #f5f5f7 | 1338 | 139 | span "Kin" |
| #ffffff | 577 | 138 | h1[tv-hero-title] "The Long Harbour" |
| #0b0b0c | 299 | 75 | b "1" |
| #111111 | 30 | 10 | button[tv-accent-green] (Green) |
| #ffffff50% | 18 | 14 | span.tv-tile-initial "H" |
| #222222 | 10 | 10 | p "Or scan this with your camera" |
| #ffb4b4 | 6 | 4 | button[friend-remove] "Remove friend" |
| #cfcfd4 | 4 | 2 | li "40% watched" |
| #55555c | 3 | 3 | small "This screen plays, and the ones you invi" |
| #6f6f78 | 1 | 1 | span.tv-query-hint "Search titles" |

**Surface colours**

| value | count | pages | sample |
|---|---|---|---|
| #0b0b0c72% | 986 | 77 | span[tv-tile-corner] (Add to Favourites) |
| #0b0b0c | 388 | 144 | div |
| #e50914 | 317 | 111 | button[tv-hero-play] "Play" |
| #ffffff8% | 304 | 132 | button[tv-account-chip] (Sign in) |
| #232327 | 296 | 61 | button[key-b] "b" |
| #ffffff14% | 181 | 74 | svg |
| #000000 | 145 | 144 | main[tv] |
| #ffffff28% | 133 | 61 | span.tv-tile-progress |
| #0b0b0c45% | 114 | 90 | div.tv-browse-shade |
| #18181b | 94 | 37 | input[rate-note-input] |
| #ffffff | 58 | 55 | button[welcome-enter] "Start watching" |
| #e5091422% | 34 | 29 | button[filter-all] "All" |
| #e5091420% | 30 | 30 | button[tv-account-chip] (Sign in) |
| #ffffff38% | 12 | 12 | div.hud-bar-buffered |
| #2772e5 | 10 | 10 | button[tv-accent-blue] (Blue) |
| #8e54ea | 10 | 10 | button[tv-accent-purple] (Purple) |
| #1fb86a | 10 | 10 | button[tv-accent-green] (Green) |
| #ff8a1f | 10 | 10 | button[tv-accent-orange] (Orange) |
| #ff4f9a | 10 | 10 | button[tv-accent-pink] (Pink) |
| #00000045% | 8 | 8 | span.tv-ep-play |

**Borders**

| value | count | pages | sample |
|---|---|---|---|
| 3 solid #e50914 | 5 | 5 | span.spinner |
| 2 solid #e50914 | 5 | 5 | input[auth-email] |
| 1 solid #ffffff10% | 3 | 3 | div[audio-subtitles-modal] (Playback speed) |
| 1 solid #e50914 | 2 | 2 | input[rate-note-input] |
| 2 solid #ffffff10% | 2 | 2 | input[auth-password] |
| 2 dashed #ffffff28% | 2 | 2 | span.profile-picture |
| 3 solid #ffffff10% | 1 | 1 | input[auth-email] |

**Shadows**

| value | count | pages | sample |
|---|---|---|---|
| rgba(255, 255, 255, 0.22) 0px 0px 0px 1px | 974 | 77 | span[tv-tile-corner] (Add to Favourites) |
| rgba(229, 9, 20, 0.5) 0px 2.816px 19.712px 0px, rgba(255, 255, 255, 0.3) 0px 1.9712px 0px 0px inset | 131 | 70 | span.logo-o |
| rgba(229, 9, 20, 0.5) 0px 4.224px 29.568px 0px, rgba(255, 255, 255, 0.3) 0px 2.9568px 0px 0px inset | 58 | 30 | span.logo-o |
| rgba(255, 255, 255, 0.06) 0px 0px 0px 1px inset, rgba(255, 255, 255, 0.05) 0px 1px 0px 0px inset | 42 | 10 | div.tv-group-body |
| rgb(11, 11, 12) 0px 0px 0px 1.28px, rgb(255, 255, 255) 0px 0px 0px 3.84px, rgba(0, 0, 0, 0.6) 0px 8.96px 23.04px 0px | 25 | 24 | span.tv-tile-art |
| rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inset, rgba(255, 255, 255, 0.06) 0px 1px 0px 0px inset | 21 | 10 | button[tv-category-tile] (My ratings) |
| rgb(229, 9, 20) 0px 0px 0px 1.792px inset | 17 | 17 | button[filter-all] "All" |
| rgba(229, 9, 20, 0.8) 0px 0px 0px 1.536px inset | 16 | 16 | button[tv-account-chip] (Sign in) |

**Transitions**

| value | count | pages | sample |
|---|---|---|---|
| background, color, transform 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 2996 | 90 | button[tv-account-chip] (Sign in) |
| transform, color 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 2788 | 77 | button[tv-browse-tile] (The Long Harbour) |
| background, color, margin-right 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 720 | 90 | button[rail-search] |
| transform, background, color, box-shadow 0.18s, 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 667 | 87 | button[welcome-enter] "Start watching" |
| -webkit-text-stroke-color 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 546 | 55 | b "1" |
| background, color, transform, box-shadow 0.18s, 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 195 | 64 | button[tv-hero-play] "Play" |
| transform, box-shadow 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 158 | 35 | button[tv-category-tile] (Popular this week) |
| opacity 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 58 | 16 | span "Search" |
| background 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 56 | 12 | span.tv-switch |
| opacity 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) | 24 | 24 | div[tv-detail] (Paper Moons) |
| box-shadow 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) | 20 | 20 | span.tv-tile-art |
| border-color, box-shadow 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 14 | 11 | input[rate-note-input] |
| opacity, background, color 0.18s, 0.18s, 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 12 | 12 | button[tv-row-next] |
| height 0.12s cubic-bezier(0.2, 0.8, 0.2, 1) | 12 | 12 | div.hud-bar-track |
| transform 0.12s ease | 12 | 12 | div.hud-bar-thumb |

**Animations**

| value | count | pages | sample |
|---|---|---|---|
| polish-picture-in 0.4s | 1350 | 49 | img |
| tv-fade-in 1s | 114 | 90 | div.tv-hero-bg |
| tv-fade, tv-arrive 0.25s, 0.5s | 24 | 24 | div[tv-detail] (Paper Moons) |
| tv-fade 0.2s | 3 | 3 | div.tv-menu-backdrop |
| tv-welcome-in 0.9s | 2 | 1 | p "Welcome" |
| spin 0.9s | 1 | 1 | span.spinner |

### Phone

15 distinct type sizes, 5 weights, 7 radii, 27 surface colours, 10 text colours, 13 shadows, 17 transitions.

**Type sizes**

| value | count | pages | sample |
|---|---|---|---|
| 16px | 613 | 36 | span "Kin" |
| 14px | 469 | 36 | button[account-button] "Sign in" |
| 13px | 352 | 35 | span[tv-online] "TV connected" |
| 18px | 161 | 35 | h1[tv-name] "TV 4F2A" |
| 17.6px | 140 | 29 | button[continue-list-toggle] (Add to a list: The Glass Orchard) |
| 20px | 85 | 35 | button[fullscreen-toggle] (Full screen) |
| 24px | 38 | 32 | h1 "Connect to your TV" |
| 32px | 18 | 11 | span[control-code] "123 456" |
| 36px | 17 | 17 | button[account-button] (Account and profiles: Dana) |
| 19.2px | 12 | 2 | button[accent-red] (Red) |
| 40px | 6 | 6 | button[pause] (Pause) |
| 12.8px | 6 | 5 | button[friend-request-decline] (Decline) |
| 33.6px | 3 | 3 | input[code-input] (6-digit code from the TV) |
| 9.26px | 2 | 2 | span.cap-sample "This is how your subtitles will look" |
| 16.8px | 1 | 1 | span "Kin" |

**Weights**

| value | count | pages | sample |
|---|---|---|---|
| 400 | 922 | 36 | button[fullscreen-toggle] (Full screen) |
| 600 | 648 | 36 | button[scan] "Scan the TV's QR code" |
| 700 | 315 | 36 | button[account-button] "Sign in" |
| 800 | 36 | 17 | span "Kin" |
| 500 | 2 | 2 | small "1 friend" |

**Line heights**

| value | count | pages | sample |
|---|---|---|---|
| normal | 1524 | 36 | button[fullscreen-toggle] (Full screen) |
| 17.5px | 167 | 29 | span.lib-title "The Glass Orchard" |
| 23.2px | 43 | 28 | p.muted "Open on your TV and choose in its menu. " |
| 18.85px | 39 | 21 | p[title-meta] "2011 · Movie" |
| 28.8px | 32 | 31 | h2 "What do you want to watch?" |
| 22.5px | 31 | 31 | h1[tv-name] "TV 4F2A" |
| 19.5px | 27 | 12 | span[score-badge] "7" |
| 18px | 17 | 17 | b[bell-badge] "2" |
| 0px | 17 | 17 | button[account-button] (Account and profiles: Dana) |
| 18.2px | 15 | 9 | small.switch-hint "Shows a box on the home screen where a v" |
| 24px | 3 | 3 | p.muted "Two sisters run a failing cinema and dec" |
| 15.6px | 2 | 2 | span[party-link-url] "http://127.0.0.1:9303/?party=029396" |

**Radii**

| value | count | pages | sample |
|---|---|---|---|
| pill / circle | 457 | 36 | span.logo-o |
| 12px | 207 | 36 | button[scan] "Scan the TV's QR code" |
| 8px | 36 | 27 | button[switch-lang-en] "English" |
| 22px | 16 | 15 | div[title-sheet] (Paper Moons) |
| 14px | 3 | 1 | span.profile-picture |
| 10px | 2 | 2 | span[party-link-url] "http://127.0.0.1:9303/?party=029396" |
| 1.11px | 2 | 2 | span.cap-sample "This is how your subtitles will look" |

**Icon sizes**

| value | count | pages | sample |
|---|---|---|---|
| 18px | 166 | 35 | svg |
| 14px | 120 | 32 | svg |
| 20px | 107 | 35 | svg |
| 19px | 43 | 29 | svg |
| 21px | 36 | 31 | svg |
| 16px | 36 | 15 | svg |
| 12px | 27 | 12 | svg |
| 36px | 17 | 17 | svg.avatar (Fox) |
| 40px | 15 | 11 | svg |
| 32px | 13 | 7 | svg |
| 13px | 6 | 5 | svg |
| 17px | 5 | 4 | svg |
| 104px | 4 | 4 | svg[pairing-qr] (QR code that lets another phone control this TV) |
| 72px | 3 | 3 | svg.avatar (Fox) |
| 11px | 2 | 2 | svg |

**Gaps**

| value | count | pages | sample |
|---|---|---|---|
| 6px | 394 | 36 | button[account-button] "Sign in" |
| 8px | 82 | 35 | button[scan] "Scan the TV's QR code" |
| 12px | 79 | 23 | p.or "or type the 6-digit code" |
| 3px | 27 | 12 | span[score-badge] "7" |
| 10px | 24 | 14 | button[rate-title-toggle] |
| 4px | 23 | 11 | div[language-switch] (Language) |
| 5px | 4 | 1 | span.rating-badge "9/10" |

**Text colours**

| value | count | pages | sample |
|---|---|---|---|
| #f5f5f7 | 1104 | 36 | span "Kin" |
| #9b9ba3 | 496 | 36 | button[fullscreen-toggle] (Full screen) |
| #ffffff | 202 | 32 | button[scan] "Scan the TV's QR code" |
| #d2d2d9 | 58 | 23 | h3.sheet-section "Episodes" |
| #46d369 | 34 | 31 | span[tv-online] "TV connected" |
| #ff6b6b | 11 | 10 | button[disconnect] "Disconnect from this TV" |
| #111111 | 6 | 2 | button[accent-green] (Green) |
| #0b0b0c | 6 | 6 | button[pause] (Pause) |
| #f6121d | 3 | 3 | button[library-list-toggle] (In your lists: Velvet Static) |
| #ffffff50% | 3 | 3 | span.poster-initial "H" |

**Surface colours**

| value | count | pages | sample |
|---|---|---|---|
| #232328 | 198 | 36 | button[account-button] "Sign in" |
| #00000062% | 156 | 34 | button[continue-list-toggle] (Add to a list: The Glass Orchard) |
| #e50914 | 118 | 36 | button[scan] "Scan the TV's QR code" |
| #17171a | 84 | 36 | input[code-input] (6-digit code from the TV) |
| #2e2e34 | 80 | 15 | button[title-list] "My Lists" |
| #00000055% | 55 | 26 | span.lib-progress |
| #0b0b0c | 50 | 33 | div |
| #00000068% | 27 | 12 | span[score-badge] "7" |
| #e5091422% | 22 | 10 | button[switch-lang-en] "English" |
| #1c1c20 | 16 | 15 | div[title-sheet] (Paper Moons) |
| #ffffff24% | 16 | 15 | div.sheet-grip |
| #ffffff20% | 12 | 12 | span.switch |
| #25252a | 10 | 7 | section[rate-title] (Your rating) |
| #ffffff18% | 6 | 6 | div.seek-track |
| #ffffff | 6 | 6 | button[pause] (Pause) |
| #e5091420% | 3 | 3 | button[tv-switch] |
| #ffffff7% | 2 | 2 | span[party-link-url] "http://127.0.0.1:9303/?party=029396" |
| #2772e5 | 2 | 2 | button[accent-blue] (Blue) |
| #8e54ea | 2 | 2 | button[accent-purple] (Purple) |
| #1fb86a | 2 | 2 | button[accent-green] (Green) |

**Borders**

| value | count | pages | sample |
|---|---|---|---|
| 1 solid #ffffff10% | 47 | 30 | input[code-input] (6-digit code from the TV) |
| 2 solid #ffffff30% | 7 | 2 | span.choice-dot |
| 2 solid #e50914 | 2 | 2 | span.choice-dot |
| 2 dashed #ffffff28% | 1 | 1 | span.profile-picture |

**Shadows**

| value | count | pages | sample |
|---|---|---|---|
| rgba(255, 255, 255, 0.28) 0px 0px 0px 1px | 27 | 12 | span[score-badge] "7" |
| rgb(229, 9, 20) 0px 0px 0px 1.5px inset | 25 | 13 | button[switch-lang-en] "English" |
| rgb(11, 11, 12) 0px 0px 0px 2px | 17 | 17 | b[bell-badge] "2" |
| rgba(0, 0, 0, 0.5) 0px -12px 40px 0px | 16 | 15 | div[title-sheet] (Paper Moons) |
| rgba(229, 9, 20, 0.8) 0px 0px 0px 1px | 3 | 3 | button[library-list-toggle] (In your lists: Velvet Static) |
| rgba(255, 255, 255, 0.16) 0px 0px 0px 1.5px inset | 2 | 2 | button[pick-new] |
| rgb(23, 23, 26) 0px 0px 0px 3px, rgb(255, 255, 255) 0px 0px 0px 5px | 2 | 2 | button[accent-red] (Red) |
| rgba(0, 0, 0, 0.45) 0px 6px 14px 0px | 2 | 2 | div[caption-preview] |

**Transitions**

| value | count | pages | sample |
|---|---|---|---|
| background, transform 0.15s, 0.1s ease, ease | 1563 | 29 | button[continue-list-toggle] (Add to a list: The Glass Orchard) |
| transform, background, color 0.08s, 0.15s, 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 288 | 36 | button[switch-lang-en] "English" |
| transform, background 0.08s, 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), cubic-be | 96 | 36 | button[scan] "Scan the TV's QR code" |
| background 0.18s ease | 76 | 9 | span.switch |
| color, opacity 0.15s, 0.1s ease, ease | 58 | 29 | button[lists-manage] "Manage lists" |
| background, transform 0.15s, 0.08s ease, ease | 28 | 11 | button[library-result] (Harvest Moon Motel) |
| background 0.12s ease | 22 | 5 | button[party-open] |
| transform 0.08s ease | 18 | 6 | button.round (Back 10 seconds) |
| transform, box-shadow 0.15s, 0.15s ease, ease | 17 | 17 | button[account-button] (Account and profiles: Dana) |
| border-color, box-shadow 0.15s, 0.15s ease, ease | 11 | 6 | input[tv-rename] |
| color 0.15s ease | 10 | 4 | svg |
| opacity 0.12s ease | 7 | 7 | svg |
| height 0.1s ease | 6 | 6 | div.seek-track |
| width, height 0.1s, 0.1s ease, ease | 6 | 6 | div.seek-thumb |
| background 0.15s ease | 4 | 3 | button[rate-title-toggle] |

**Animations**

| value | count | pages | sample |
|---|---|---|---|
| polish-picture-in 0.4s | 960 | 29 | img |
| page-in 0.22s | 17 | 17 | div[account-screen] (Account) |
| fade-in 0.18s | 16 | 15 | div.sheet-backdrop |
| sheet-up 0.24s | 16 | 15 | div[title-sheet] (Paper Moons) |

# Rule breaks

## Text smaller than the floor (1)

TV: 1.15% of the screen width (the test suite's rule). Phone: 12 px.

| element | size | floor | count | pictures |
|---|---|---|---|---|
| span.cap-sample "This is how your subtitles will look" | 9.26 | 12 | 2 | 2 |



## Text with too little contrast (0)

4.5:1 (3:1 for large text). Text over a picture is not measured.

None.

## Controls with no name (22)

A control with no text, aria-label or title cannot be told apart by a screen reader.

| element | size | count | pictures |
|---|---|---|---|
| input[tv-rename] | 358x48 | 1 | 1 |
| input[auth-email] | 358x48 | 1 | 1 |
| input[auth-password] | 358x48 | 1 | 1 |
| input[password-current] | 358x48 | 1 | 1 |
| input[password-new] | 358x48 | 1 | 1 |
| button[tv-row-next] | 51x51 | 4 | 4 |
| input[rate-note-input] | 896x54 | 1 | 1 |
| input[list-name-input] | 589x54 | 1 | 1 |
| input[auth-email] | 640x61 | 2 | 2 |
| input[auth-password] | 640x61 | 2 | 2 |
| input[tv-friend-tag-input] | 640x61 | 1 | 1 |
| input[profile-name-input] | 589x61 | 1 | 1 |
| input[tv-approve-input] | 640x61 | 1 | 1 |
| button[tv-row-next] | 55x55 | 2 | 2 |
| button[tv-row-next] | 58x58 | 1 | 1 |
| button[tv-row-next] | 77x77 | 4 | 4 |
| input[auth-email] | 960x92 | 1 | 1 |
| input[auth-password] | 960x92 | 1 | 1 |
| input[tv-friend-tag-input] | 960x92 | 1 | 1 |
| input[profile-name-input] | 883x92 | 1 | 1 |
| input[tv-approve-input] | 960x92 | 1 | 1 |
| button[tv-row-next] | 102x102 | 1 | 1 |



## Controls under 24 px (0)

WCAG 2.2 target size (minimum), AA.

None.

## Phone controls under 44 px (0)

The comfortable thumb target. Links inside running text are left out.

None.

## Text or controls outside the TV's safe margin (65)

Inside 2.5% of the left/right edge or 5% of the top/bottom. What crosses an edge (a row that scrolls past it, the page under its fade) and the pictures of such a row with the words under them are not counted.

| element | edges | count | pictures |
|---|---|---|---|
| button[tv-row-next] | 94.6% .. 98.6% / 87.4% .. 94.4% | 2 | 2 |
| button[tv-season-1] "Season 1" | 7.3% .. 18.6% / 90.1% .. 97.6% | 1 | 1 |
| button[tv-season-2] "Season 2" | 19.5% .. 31.1% / 90.1% .. 97.6% | 1 | 1 |
| button[tv-season-3] "Season 3" | 31.9% .. 43.5% / 90.1% .. 97.6% | 1 | 1 |
| p.tv-hero-eyebrow "Series to binge" | 7.0% .. 58.0% / 4.6% .. 8.2% | 1 | 1 |
| button[tv-detail-remove] "Remove from Continue watching" | 7.0% .. 37.9% / 0.3% .. 6.1% | 1 | 1 |
| button[tv-play-btn] (Pause) | 4.8% .. 8.8% / 88.2% .. 95.3% | 1 | 1 |
| b[tv-bell-badge] "2" | 79.6% .. 81.6% / 4.7% .. 8.2% | 3 | 3 |
| button[tv-row-next] | 94.6% .. 98.6% / 82.2% .. 89.3% | 1 | 1 |
| b[tv-bell-badge] "1" | 79.6% .. 81.6% / 4.7% .. 8.2% | 11 | 11 |
| button[friend-remove] "Remove friend" | 7.0% .. 25.4% / 89.3% .. 96.8% | 1 | 1 |
| button[rail-search] | 1.8% .. 5.3% / 13.8% .. 21.1% | 4 | 4 |
| button[rail-home] | 1.8% .. 5.3% / 21.6% .. 28.9% | 4 | 4 |
| button[rail-movies] | 1.8% .. 5.3% / 29.4% .. 36.7% | 4 | 4 |
| button[rail-series] | 1.8% .. 5.3% / 37.1% .. 44.4% | 4 | 4 |
| button[rail-categories] | 1.8% .. 5.3% / 44.9% .. 52.2% | 4 | 4 |
| button[rail-list] | 1.8% .. 5.3% / 52.7% .. 60.0% | 4 | 4 |
| button[rail-party] | 1.8% .. 5.3% / 63.0% .. 70.3% | 4 | 4 |
| button[rail-connect] | 1.8% .. 5.3% / 70.7% .. 78.0% | 4 | 4 |
| button[tv-season-1] "Season 1" | 7.3% .. 18.7% / 90.1% .. 97.8% | 2 | 2 |
| button[tv-season-2] "Season 2" | 19.5% .. 31.1% / 90.1% .. 97.8% | 2 | 2 |
| button[tv-season-3] "Season 3" | 31.8% .. 43.5% / 90.1% .. 97.8% | 1 | 1 |
| p.tv-hero-eyebrow "Series to binge" | 7.0% .. 58.0% / 4.6% .. 8.1% | 1 | 1 |
| h1[tv-title] "long" | 5.0% .. 10.4% / 4.9% .. 11.1% | 1 | 1 |
| div.hud-clock "01:39" | 87.4% .. 95.0% / 4.9% .. 9.0% | 1 | 1 |
| button[tv-play-btn] (Pause) | 5.0% .. 8.6% / 88.5% .. 95.1% | 1 | 1 |
| button[tv-account-chip] (Sign in) | 80.1% .. 90.5% / 4.7% .. 10.4% | 7 | 7 |
| button[fullscreen-toggle] (Full screen) | 91.4% .. 95.0% / 4.7% .. 10.4% | 7 | 7 |
| button[tv-row-next] | 94.6% .. 98.6% / 86.7% .. 93.1% | 1 | 1 |
| button[rail-search] | 1.8% .. 5.3% / 12.4% .. 18.9% | 4 | 4 |
| button[rail-home] | 1.8% .. 5.3% / 19.4% .. 25.9% | 4 | 4 |
| button[rail-movies] | 1.8% .. 5.3% / 26.3% .. 32.8% | 4 | 4 |
| button[rail-series] | 1.8% .. 5.3% / 33.2% .. 39.7% | 4 | 4 |
| button[rail-categories] | 1.8% .. 5.3% / 40.1% .. 46.6% | 4 | 4 |
| button[rail-list] | 1.8% .. 5.3% / 47.0% .. 53.4% | 4 | 4 |
| button[rail-party] | 1.8% .. 5.3% / 56.2% .. 62.7% | 4 | 4 |
| button[rail-connect] | 1.8% .. 5.3% / 63.1% .. 69.6% | 4 | 4 |
| button[tv-detail-close] "Close" | 86.3% .. 95.0% / 4.7% .. 10.4% | 3 | 3 |
| button[tv-season-1] "Season 1" | 7.3% .. 18.7% / 91.1% .. 97.9% | 1 | 1 |
| button[tv-season-2] "Season 2" | 19.4% .. 31.0% / 91.1% .. 97.9% | 1 | 1 |

...and 25 more in the json.

## Text that is cut without an ellipsis (0)

None.

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
