# Design drift: the classic look

152 screens scanned, 32127 elements measured (2026-10-13). Made by `scripts/ui-walk/drift.mjs` from the walk's live-DOM scans.

## What the pages use

TV sizes are in em (what the CSS wrote; 1em = the TV's own scale), the phone's in px. 'screens' = how many of the walk's pictures have it.

### TV / desktop screen

31 distinct type sizes, 5 weights, 15 radii, 31 surface colours, 28 text colours, 45 shadows, 16 transitions.

**Type sizes**

| value | count | pages | sample |
|---|---|---|---|
| 1.7em | 971 | 88 | button[rail-search] |
| 1em | 962 | 84 | button[tv-browse-tile] (The Long Harbour) |
| 1.3em | 617 | 93 | p[tv-hero-eyebrow] "Popular this week" |
| 1.5em | 497 | 96 | button[tv-account-chip] (Sign in) |
| 1.25em | 463 | 67 | span.tv-tile-year "2022" |
| 8.7em | 231 | 33 | b "1" |
| 1.8em | 188 | 62 | button[welcome-enter] "Start watching" |
| 1.15em | 169 | 65 | span[score-badge] "7" |
| 2.2em | 146 | 104 | span "Kin" |
| 1.6em | 134 | 52 | span.tv-category-name "Popular this week" |
| 1.4em | 100 | 62 | p.tv-hero-meta "2019" |
| 2em | 90 | 35 | p "Welcome" |
| 1.1em | 68 | 27 | span.tv-category-count "Movies · 12 titles" |
| 1.9em | 58 | 12 | button[key-a] "a" |
| 3em | 51 | 42 | h1[tv-hero-title] "The Long Harbour" |
| 2.4em | 46 | 44 | h1[tv-hero-title] "Blue Hour" |
| 3.4em | 29 | 27 | h1.tv-headline "Your rating" |
| 4em | 27 | 21 | h1.tv-headline "Watch party" |
| 4.4em | 19 | 19 | h1[tv-detail-title] "Paper Moons" |
| 2.1em | 16 | 7 | b "Start a party" |
| 1.2em | 14 | 8 | button[name-key-space] "Space" |
| 1.75em | 13 | 6 | span.tv-step-no "1" |
| 2.3em | 12 | 10 | button[tv-play-btn] (Pause) |
| 1.45em | 8 | 4 | span "Wants to be friends" |
| 9.25em | 5 | 5 | p[pairing-code] "123 456" |
| 1.35em | 4 | 2 | small "you" |
| 3.2em | 3 | 3 | h1[tv-account-name] "Not signed in" |
| 2.05em | 2 | 2 | b[tv-friend-request-name] "Ben#1" |
| 6.1em | 2 | 2 | p[tv-party-code] "123 456" |
| 7em | 1 | 1 | span "Kin" |
| 7.5em | 1 | 1 | p[tv-link-code] "ABCD-2345" |

**Weights**

| value | count | pages | sample |
|---|---|---|---|
| 600 | 1830 | 113 | button[rail-search] |
| 400 | 1740 | 114 | button[fullscreen-toggle] (Full screen) |
| 700 | 654 | 94 | p[tv-hero-eyebrow] "Popular this week" |
| 800 | 492 | 114 | span "Kin" |
| 900 | 231 | 33 | b "1" |

**Line heights**

| value | count | pages | sample |
|---|---|---|---|
| normal | 3249 | 114 | button[rail-search] |
| 1.65em | 506 | 63 | button[tv-hero-play] "Play" |
| 6.8em | 231 | 33 | b "1" |
| 1.75em | 192 | 59 | span[score-badge] "7" |
| 2em | 135 | 54 | button[welcome-enter] "Start watching" |
| 2.2em | 122 | 104 | span "Kin" |
| 1.6em | 81 | 6 | span.tv-tile-name "The Glass Orchard" |
| 1.85em | 57 | 19 | button[tv-detail-play] "Play" |
| 2.1em | 48 | 2 | button[key-a] "a" |
| 3.3em | 41 | 41 | h1[tv-hero-title] "The Long Harbour" |
| 1.3em | 36 | 12 | button[name-key-space] "Space" |
| 2.65em | 34 | 34 | h1[tv-hero-title] "Blue Hour" |

**Radii**

| value | count | pages | sample |
|---|---|---|---|
| pill / circle | 1378 | 114 | span.logo-o |
| 0.9em | 165 | 59 | button[welcome-enter] "Start watching" |
| 0.85em | 140 | 78 | button[rail-home] |
| 0.75em | 106 | 29 | button[tv-hero-play] "Play" |
| 0.6em | 95 | 19 | span.tv-tile-art |
| 0.65em | 43 | 33 | button[tv-detail-close] "Close" |
| 0.5em | 28 | 14 | button[tv-episode] |
| 1em | 18 | 9 | button[tv-party-start] |
| 1.1em | 15 | 5 | button[tv-autoplay] |
| 0.8em | 12 | 9 | input[auth-email] |
| 1.05em | 10 | 1 | button[rate-score-1] "1" |
| 1.2em | 10 | 10 | div.tv-qr |
| 0.7em | 8 | 3 | input[rate-note-input] |
| 0.55em | 3 | 1 | button[key-space] "Space" |
| 3.9em | 1 | 1 | span.logo-o |

**Icon sizes**

| value | count | pages | sample |
|---|---|---|---|
| 1.15em | 480 | 49 | svg |
| 1.95em | 432 | 48 | svg |
| 1.2em | 376 | 31 | svg |
| 2em | 277 | 33 | svg |
| 1.8em | 119 | 73 | svg |
| 1.5em | 95 | 56 | svg |
| 1.45em | 68 | 57 | svg |
| 1.7em | 46 | 18 | svg |
| 2.7em | 42 | 42 | svg |
| 2.6em | 39 | 13 | svg |
| 2.75em | 34 | 34 | svg |
| 1.3em | 27 | 27 | svg |
| 2.05em | 25 | 5 | svg |
| 1.35em | 23 | 23 | svg |
| 4.6em | 23 | 13 | svg |

**Gaps**

| value | count | pages | sample |
|---|---|---|---|
| 1.35em | 692 | 76 | button[rail-search] |
| 0.9em | 195 | 113 | button[tv-account-chip] (Sign in) |
| 0.3em | 118 | 39 | span[score-badge] "7" |
| 0.75em | 94 | 25 | button[tv-hero-play] "Play" |
| 0.6em | 78 | 2 | button[name-key-a] "a" |
| 0.7em | 68 | 18 | button[filter-all] "All" |
| 0.85em | 59 | 21 | button[tv-detail-play] "Play" |
| 0.2em | 56 | 20 | button[tv-category-tile] (Popular this week) |
| 0.8em | 50 | 10 | button.tv-btn (Back 10 seconds) |
| 0.5em | 42 | 19 | button[name-key-space] "Space" |
| 1.1em | 24 | 12 | button[tv-episode] |
| 0.65em | 23 | 23 | button[tv-detail-close] "Close" |
| 0.35em | 15 | 5 | span.tv-ep-meta "38 min" |
| 3em | 12 | 2 | button[tv-friends-lists] |
| 3.6em | 11 | 3 | button[tv-autoplay] |

**Text colours**

| value | count | pages | sample |
|---|---|---|---|
| #bdbdc4 | 1235 | 67 | button[tv-browse-tile] (Paper Moons) |
| #ffffff | 943 | 114 | button[rail-home] |
| #b4b4bb | 659 | 76 | button[rail-search] |
| #9b9ba3 | 562 | 96 | span.tv-tile-year "2022" |
| #e6e6e6 | 342 | 84 | button[tv-account-chip] (Sign in) |
| #0b0b0c | 231 | 33 | b "1" |
| #e8e8ec | 159 | 64 | h2.tv-row-title "Popular this week" |
| #e6e6ea | 144 | 5 | button[key-b] "b" |
| #f5f5f7 | 137 | 104 | span "Kin" |
| #d4d4d4 | 100 | 51 | button[filter-movie] "Movies" |
| #e50914 | 89 | 64 | p[tv-hero-eyebrow] "Popular this week" |
| #cfcfd4 | 74 | 55 | p.tv-hero-meta "2019" |
| #ffffff78% | 54 | 20 | span.tv-category-count "Movies · 12 titles" |
| #dddddd | 42 | 15 | button[tv-episode] |
| #000000 | 38 | 29 | button[welcome-enter] "Start watching" |

**Surface colours**

| value | count | pages | sample |
|---|---|---|---|
| #00000062% | 588 | 66 | span[tv-tile-corner] (Add to Favourites) |
| #e50914 | 396 | 99 | button[tv-hero-play] "Play" |
| #0b0b0c | 309 | 119 | div |
| #ffffff12% | 234 | 96 | button[tv-account-chip] (Sign in) |
| #ffffff11% | 143 | 5 | button[key-b] "b" |
| #000000 | 120 | 119 | main[tv] |
| #00000068% | 118 | 39 | span[score-badge] "7" |
| #0b0b0c45% | 95 | 76 | div.tv-browse-shade |
| #ffffff28% | 82 | 39 | span.tv-tile-progress |
| #ffffff16% | 78 | 40 | button[tv-hero-list] "Favourites" |
| #ffffff10% | 78 | 32 | button[filter-movie] "Movies" |
| #ffffff14% | 76 | 62 | svg |
| #ffffff | 39 | 37 | button[welcome-enter] "Start watching" |
| #e5091430% | 23 | 20 | button[filter-all] "All" |
| #ffffff9% | 21 | 5 | button[tv-autoplay] |
| #ffffff6% | 16 | 7 | button[tv-episode] |
| #17171a | 14 | 11 | input[rate-note-input] |
| #e5091425% | 11 | 11 | button[tv-episode] |
| #ffffff38% | 10 | 10 | div.hud-bar-buffered |
| #00000045% | 7 | 7 | span.tv-ep-play |

**Borders**

| value | count | pages | sample |
|---|---|---|---|
| 2 solid #e50914 | 6 | 6 | span.spinner |
| 3 solid #e50914 | 4 | 4 | input[auth-password] |
| 1 solid #e50914 | 2 | 2 | input[rate-note-input] |
| 2 solid #ffffff10% | 2 | 2 | input[auth-password] |
| 1 solid #ffffff14% | 2 | 2 | div[audio-subtitles-modal] (Playback speed) |
| 2 dashed #ffffff28% | 2 | 2 | span.profile-picture |
| 3 solid #ffffff10% | 1 | 1 | input[auth-email] |

**Shadows**

| value | count | pages | sample |
|---|---|---|---|
| rgba(255, 255, 255, 0.4) 0px 0px 0px 1.024px | 236 | 29 | span[tv-tile-corner] (Add to Favourites) |
| rgba(255, 255, 255, 0.4) 0px 0px 0px 1.536px | 130 | 19 | span[tv-tile-corner] (Remove from Continue watching) |
| rgba(255, 255, 255, 0.4) 0px 0px 0px 1.09228px | 74 | 6 | span[tv-tile-corner] (Remove from Continue watching) |
| rgba(255, 255, 255, 0.4) 0px 0px 0px 1.152px | 74 | 6 | span[tv-tile-corner] (Remove from Continue watching) |
| rgba(255, 255, 255, 0.4) 0px 0px 0px 2.048px | 74 | 6 | span[tv-tile-corner] (Remove from Continue watching) |
| rgba(229, 9, 20, 0.5) 0px 2.816px 19.712px 0px, rgba(255, 255, 255, 0.3) 0px 1.9712px 0px 0px inset | 58 | 47 | span.logo-o |
| rgba(255, 255, 255, 0.3) 0px 0px 0px 1.1776px | 47 | 14 | span[score-badge] "7" |
| rgba(229, 9, 20, 0.5) 0px 4.224px 29.568px 0px, rgba(255, 255, 255, 0.3) 0px 2.9568px 0px 0px inset | 37 | 30 | span.logo-o |

**Transitions**

| value | count | pages | sample |
|---|---|---|---|
| background, color, transform 0.15s, 0.15s, 0.15s ease, ease, ease | 2740 | 103 | button[tv-account-chip] (Sign in) |
| transform, color 0.18s, 0.18s ease, ease | 2302 | 67 | button[tv-browse-tile] (The Long Harbour) |
| background, color, margin-right 0.15s, 0.15s, 0.2s ease, ease, ease | 684 | 76 | button[rail-search] |
| -webkit-text-stroke-color 0.18s ease | 448 | 45 | b "1" |
| transform, background 0.12s, 0.12s ease, ease | 149 | 20 | button[tv-episode] |
| background, color, transform 0.12s, 0.12s, 0.12s ease, ease, ease | 145 | 5 | button[key-a] "a" |
| transform, box-shadow 0.18s, 0.18s ease, ease | 84 | 22 | button[tv-category-tile] (Popular this week) |
| background, color, transform, box-shadow 0.15s, 0.15s, 0.15s, 0.15s ease, ease, ease, ease | 68 | 18 | button[filter-all] "All" |
| opacity 0.15s ease | 48 | 8 | span "Search" |
| transform, box-shadow 0.15s, 0.15s ease, ease | 42 | 5 | button[tv-accent-red] (Red) |
| background 0.18s ease | 23 | 5 | span.tv-switch |
| box-shadow 0.18s ease | 18 | 18 | span.tv-tile-art |
| border-color, box-shadow 0.15s, 0.15s ease, ease | 14 | 11 | input[rate-note-input] |
| height 0.12s ease | 10 | 10 | div.hud-bar-track |
| opacity 0.12s ease | 5 | 5 | span.tv-ep-play |

**Animations**

| value | count | pages | sample |
|---|---|---|---|
| tv-fade-in 1s | 95 | 76 | div.tv-hero-bg |
| tv-fade, tv-arrive 0.25s, 0.5s | 19 | 19 | div[tv-detail] (Paper Moons) |
| tv-welcome-in 0.9s | 2 | 1 | p "Welcome" |
| tv-fade 0.2s | 2 | 2 | div.tv-menu-backdrop |
| tv-blink 1s | 1 | 1 | i.tv-caret |
| spin 0.9s | 1 | 1 | span.spinner |

### Phone

26 distinct type sizes, 5 weights, 7 radii, 21 surface colours, 8 text colours, 8 shadows, 19 transitions.

**Type sizes**

| value | count | pages | sample |
|---|---|---|---|
| 16px | 506 | 33 | button[scan] "Scan the TV's QR code" |
| 13.6px | 386 | 33 | button[account-button] "Sign in" |
| 12px | 200 | 32 | span[tv-online] "TV connected" |
| 17.6px | 168 | 32 | h1[tv-name] "TV 4F2A" |
| 16.8px | 96 | 30 | span "Kin" |
| 12.8px | 87 | 25 | p[title-meta] "2011 · Movie" |
| 20px | 79 | 32 | button[fullscreen-toggle] (Full screen) |
| 12.48px | 68 | 22 | span[score-badge] "7" |
| 15.2px | 52 | 32 | p.muted "Open on your TV and choose in its menu. " |
| 18.4px | 32 | 28 | h2 "Paper Moons" |
| 24px | 26 | 25 | h2 "What do you want to watch?" |
| 14.4px | 17 | 10 | span[rate-title-value] "Rate" |
| 11.2px | 17 | 17 | b[bell-badge] "2" |
| 36px | 17 | 17 | button[account-button] (Account and profiles: Dana) |
| 19.2px | 12 | 2 | button[accent-red] (Red) |
| 32px | 10 | 6 | span[control-code] "123 456" |
| 13.33px | 6 | 4 | small "4" |
| 13.12px | 4 | 4 | span.code-card-title "Control with more phones (1 connected)" |
| 33.6px | 3 | 3 | input[code-input] (6-digit code from the TV) |
| 24.8px | 3 | 3 | h2[media-title] "long" |
| 40px | 3 | 3 | button[pause] (Pause) |
| 10.88px | 3 | 3 | small "Speed" |
| 22.4px | 3 | 3 | h1[account-profile-name] "Dana" |
| 35.2px | 3 | 3 | span.poster-initial "H" |
| 14.72px | 2 | 2 | button[party-link-copy] "Copy link" |
| 25.6px | 1 | 1 | h1 "Connect to your TV" |

**Weights**

| value | count | pages | sample |
|---|---|---|---|
| 400 | 876 | 33 | button[fullscreen-toggle] (Full screen) |
| 600 | 595 | 33 | button[scan] "Scan the TV's QR code" |
| 700 | 295 | 33 | button[account-button] "Sign in" |
| 800 | 36 | 17 | span "Kin" |
| 500 | 2 | 2 | small "1 friend" |

**Line heights**

| value | count | pages | sample |
|---|---|---|---|
| normal | 1415 | 33 | button[fullscreen-toggle] (Full screen) |
| 17px | 165 | 29 | span.lib-title "The Glass Orchard" |
| 18.56px | 52 | 20 | p[title-meta] "2011 · Movie" |
| 22.04px | 41 | 28 | p.muted "Open on your TV and choose in its menu. " |
| 22px | 28 | 28 | h1[tv-name] "TV 4F2A" |
| 18.72px | 27 | 12 | span[score-badge] "7" |
| 28.8px | 26 | 25 | h2 "What do you want to watch?" |
| 18px | 17 | 17 | b[bell-badge] "2" |
| 0px | 17 | 17 | button[account-button] (Account and profiles: Dana) |
| 22.8px | 3 | 3 | p.muted "Two sisters run a failing cinema and dec" |
| 29.76px | 3 | 3 | h2[media-title] "long" |
| 19.72px | 3 | 3 | p.muted "Signed in as dana" |

**Radii**

| value | count | pages | sample |
|---|---|---|---|
| pill / circle | 400 | 33 | span.logo-o |
| 12px | 191 | 33 | button[scan] "Scan the TV's QR code" |
| 8px | 32 | 26 | button[paste] "Paste" |
| 22px | 13 | 12 | div[title-sheet] (Paper Moons) |
| 14px | 9 | 7 | input[code-input] (6-digit code from the TV) |
| 9px | 6 | 4 | button[switch-lang-en] "English" |
| 10px | 2 | 2 | span[party-link-url] "http://127.0.0.1:8810/?party=562409" |

**Icon sizes**

| value | count | pages | sample |
|---|---|---|---|
| 18px | 159 | 32 | svg |
| 14px | 146 | 29 | svg |
| 20px | 95 | 32 | svg |
| 19px | 45 | 30 | svg |
| 21px | 30 | 28 | svg |
| 16px | 29 | 11 | svg |
| 12px | 27 | 12 | svg |
| 36px | 17 | 17 | svg.avatar (Fox) |
| 40px | 12 | 8 | svg |
| 32px | 7 | 4 | svg |
| 13px | 6 | 5 | svg |
| 104px | 4 | 4 | svg[pairing-qr] (QR code that lets another phone control this TV) |
| 72px | 3 | 3 | svg.avatar (Fox) |
| 11px | 2 | 2 | svg |
| 84px | 1 | 1 | svg.avatar (Fox) |

**Gaps**

| value | count | pages | sample |
|---|---|---|---|
| 6px | 411 | 33 | button[account-button] "Sign in" |
| 8px | 83 | 32 | button[scan] "Scan the TV's QR code" |
| 12px | 69 | 22 | p.or "or type the 6-digit code" |
| 3px | 27 | 12 | span[score-badge] "7" |
| 10px | 19 | 11 | button[rate-title-toggle] |
| 4px | 16 | 8 | div[language-switch] (Language) |
| 5px | 4 | 1 | span.rating-badge "9/10" |

**Text colours**

| value | count | pages | sample |
|---|---|---|---|
| #f5f5f7 | 1016 | 33 | span "Kin" |
| #9b9ba3 | 498 | 33 | button[fullscreen-toggle] (Full screen) |
| #ffffff | 228 | 30 | button[scan] "Scan the TV's QR code" |
| #46d369 | 31 | 28 | span[tv-online] "TV connected" |
| #000000 | 14 | 11 | button[switch-lang-en] "English" |
| #ff6b6b | 8 | 7 | button[disconnect] "Disconnect from this TV" |
| #111111 | 6 | 2 | button[accent-green] (Green) |
| #ffffff50% | 3 | 3 | span.poster-initial "H" |

**Surface colours**

| value | count | pages | sample |
|---|---|---|---|
| #232328 | 209 | 33 | button[account-button] "Sign in" |
| #00000062% | 150 | 31 | button[continue-list-toggle] (Add to a list: The Glass Orchard) |
| #e50914 | 144 | 33 | button[scan] "Scan the TV's QR code" |
| #17171a | 95 | 33 | input[code-input] (6-digit code from the TV) |
| #00000055% | 55 | 26 | span.lib-progress |
| #0b0b0c | 47 | 30 | div |
| #00000068% | 27 | 12 | span[score-badge] "7" |
| #ffffff20% | 25 | 19 | div.sheet-grip |
| #ffffff | 14 | 11 | button[switch-lang-en] "English" |
| #1c1c20 | 13 | 12 | div[title-sheet] (Paper Moons) |
| #ff6b6b14% | 8 | 7 | button[disconnect] "Disconnect from this TV" |
| #e5091420% | 4 | 4 | button[link-box-toggle] |
| #ffffff7% | 2 | 2 | span[party-link-url] "http://127.0.0.1:8810/?party=562409" |
| #2b7fff | 2 | 2 | button[accent-blue] (Blue) |
| #9b5cff | 2 | 2 | button[accent-purple] (Purple) |
| #1fb86a | 2 | 2 | button[accent-green] (Green) |
| #ff8a1f | 2 | 2 | button[accent-orange] (Orange) |
| #ff4f9a | 2 | 2 | button[accent-pink] (Pink) |
| #e5091414% | 1 | 1 | div.pair-icon |
| #ffffff10% | 1 | 1 | button[friend-invite-code-copy] "Copy code" |

**Borders**

| value | count | pages | sample |
|---|---|---|---|
| 1 solid #ffffff10% | 47 | 30 | input[code-input] (6-digit code from the TV) |
| 2 solid #ffffff30% | 5 | 1 | span.choice-dot |
| 2 solid #e50914 | 3 | 3 | span.choice-dot |
| 2 dashed #ffffff28% | 1 | 1 | span.profile-picture |

**Shadows**

| value | count | pages | sample |
|---|---|---|---|
| rgba(255, 255, 255, 0.28) 0px 0px 0px 1px | 27 | 12 | span[score-badge] "7" |
| rgb(11, 11, 12) 0px 0px 0px 2px | 17 | 17 | b[bell-badge] "2" |
| rgb(229, 9, 20) 0px 0px 0px 1.5px inset | 4 | 4 | button[link-box-toggle] |
| rgba(229, 9, 20, 0.5) 0px 1.68px 11.76px 0px, rgba(255, 255, 255, 0.3) 0px 1.176px 0px 0px inset | 2 | 2 | span.logo-o |
| rgba(255, 255, 255, 0.16) 0px 0px 0px 1.5px inset | 2 | 2 | button[pick-new] |
| rgb(11, 11, 12) 0px 0px 0px 3px, rgb(255, 255, 255) 0px 0px 0px 5px | 2 | 2 | button[accent-red] (Red) |
| rgba(229, 9, 20, 0.55) 0px 0px 0px 1.5px inset | 1 | 1 | button[title-episode] |
| rgb(229, 9, 20) 0px 0px 0px 3px | 1 | 1 | span.profile-picture |

**Transitions**

| value | count | pages | sample |
|---|---|---|---|
| background, transform 0.15s, 0.1s ease, ease | 1563 | 29 | button[continue-list-toggle] (Add to a list: The Glass Orchard) |
| background, color 0.15s, 0.15s ease, ease | 126 | 29 | button[switch-lang-en] "English" |
| transform, background 0.08s, 0.15s ease, ease | 90 | 33 | button[scan] "Scan the TV's QR code" |
| background 0.18s ease | 63 | 7 | span.switch |
| color, opacity 0.15s, 0.1s ease, ease | 58 | 29 | button[lists-manage] "Manage lists" |
| transform, box-shadow 0.12s, 0.12s ease, ease | 42 | 7 | button[accent-red] (Red) |
| background, transform 0.15s, 0.08s ease, ease | 27 | 12 | button[library-result] (Harvest Moon Motel) |
| transform, box-shadow 0.15s, 0.15s ease, ease | 17 | 17 | button[account-button] (Account and profiles: Dana) |
| background 0.12s ease | 16 | 3 | button[menu-ratings] |
| border-color, box-shadow 0.15s, 0.15s ease, ease | 11 | 6 | input[tv-rename] |
| color 0.15s ease | 10 | 4 | svg |
| transform 0.08s ease | 9 | 3 | button.round (Back 10 seconds) |
| opacity 0.12s ease | 7 | 7 | svg |
| background 0.15s ease | 4 | 3 | button[rate-title-toggle] |
| color, background 0.15s, 0.15s ease, ease | 3 | 2 | button[password-eye] (Show password) |

**Animations**

| value | count | pages | sample |
|---|---|---|---|
| page-in 0.22s | 17 | 17 | div[account-screen] (Account) |
| fade-in 0.18s | 13 | 12 | div.sheet-backdrop |
| sheet-up 0.24s | 13 | 12 | div[title-sheet] (Paper Moons) |

# Rule breaks

## Text smaller than the floor (52)

TV: 1.15% of the screen width (the test suite's rule). Phone: 12 px.

| element | size | floor | count | pictures |
|---|---|---|---|---|
| small "Speed" | 10.88 | 12 | 3 | 3 |
| b[bell-badge] "2" | 11.2 | 12 | 2 | 2 |
| b[bell-badge] "1" | 11.2 | 12 | 15 | 15 |
| span.tv-category-count "Movies · 12 titles" | 14.08 | 14.7 | 3 | 1 |
| span.tv-category-count "Series · 8 titles" | 14.08 | 14.7 | 1 | 1 |
| span.tv-ep-about "The harbour wakes late, and everyone pre" | 14.08 | 14.7 | 2 | 1 |
| span.tv-category-count "6 ratings · average 8" | 14.08 | 14.7 | 1 | 1 |
| span.tv-category-count "8 titles" | 14.08 | 14.7 | 1 | 1 |
| span.tv-category-count "Keep your lists and ratings on every scr" | 14.08 | 14.7 | 1 | 1 |
| span.tv-category-count "Account, language, playback and more" | 14.08 | 14.7 | 2 | 2 |
| span.tv-category-count "4 ratings · average 8.5" | 14.08 | 14.7 | 1 | 1 |
| span.tv-category-count "1 friend · 1 unread" | 14.08 | 14.7 | 1 | 1 |
| span.tv-category-count "6 titles" | 14.08 | 14.7 | 1 | 1 |
| span.tv-category-count "Wants to be friends" | 14.08 | 14.7 | 6 | 6 |
| span.tv-category-count "Watching Harbour Lights" | 14.08 | 14.7 | 5 | 5 |
| p "A friend can scan this with a phone" | 14.08 | 14.7 | 1 | 1 |
| p "On a phone: scan this, or open the addre" | 14.08 | 14.7 | 1 | 1 |
| b[tv-bell-badge] "2" | 14.4 | 14.7 | 3 | 3 |
| b[tv-bell-badge] "1" | 14.4 | 14.7 | 11 | 11 |
| small "Wants to be friends" | 14.4 | 14.7 | 3 | 2 |
| small "Watching Harbour Lights · now" | 14.4 | 14.7 | 1 | 1 |
| span.tv-ep-about "The harbour wakes late, and everyone pre" | 15.02 | 15.7 | 2 | 1 |
| span.tv-category-count "5 ratings · average 8" | 15.02 | 15.7 | 1 | 1 |
| span.tv-category-count "8 titles" | 15.02 | 15.7 | 1 | 1 |
| span.tv-category-count "Keep your lists and ratings on every scr" | 15.02 | 15.7 | 1 | 1 |
| span.tv-category-count "Account, language, playback and more" | 15.02 | 15.7 | 1 | 1 |
| span.tv-ep-about "The harbour wakes late, and everyone pre" | 15.84 | 16.6 | 2 | 1 |
| span.tv-category-count "5 ratings · average 8" | 15.84 | 16.6 | 1 | 1 |
| span.tv-category-count "8 titles" | 15.84 | 16.6 | 1 | 1 |
| span.tv-category-count "Keep your lists and ratings on every scr" | 15.84 | 16.6 | 1 | 1 |
| span.tv-category-count "Account, language, playback and more" | 15.84 | 16.6 | 1 | 1 |
| span.tv-ep-about "The harbour wakes late, and everyone pre" | 21.12 | 22.1 | 2 | 1 |
| span.tv-category-count "5 ratings · average 8" | 21.12 | 22.1 | 1 | 1 |
| span.tv-category-count "8 titles" | 21.12 | 22.1 | 1 | 1 |
| span.tv-category-count "Keep your lists and ratings on every scr" | 21.12 | 22.1 | 1 | 1 |
| span.tv-category-count "Account, language, playback and more" | 21.12 | 22.1 | 2 | 2 |
| span.tv-category-count "4 ratings · average 8.5" | 21.12 | 22.1 | 1 | 1 |
| span.tv-category-count "1 friend · 1 unread" | 21.12 | 22.1 | 1 | 1 |
| span.tv-category-count "6 titles" | 21.12 | 22.1 | 1 | 1 |
| span.tv-category-count "Wants to be friends" | 21.12 | 22.1 | 6 | 6 |

...and 12 more in the json.

## Text with too little contrast (17)

4.5:1 (3:1 for large text). Text over a picture is not measured.

| element | ratio | need | fg | bg | count | pictures |
|---|---|---|---|---|---|---|
| b "1" | 1 | 3 | #0b0b0c | #0b0b0c | 33 | 33 |
| b "2" | 1 | 3 | #0b0b0c | #0b0b0c | 33 | 33 |
| b "3" | 1 | 3 | #0b0b0c | #0b0b0c | 33 | 33 |
| b "4" | 1 | 3 | #0b0b0c | #0b0b0c | 33 | 33 |
| b "5" | 1 | 3 | #0b0b0c | #0b0b0c | 33 | 33 |
| b "6" | 1 | 3 | #0b0b0c | #0b0b0c | 33 | 33 |
| b "7" | 1 | 3 | #0b0b0c | #0b0b0c | 33 | 33 |
| p[tv-hero-eyebrow] "Popular this week" | 4.1 | 4.5 | #e50914 | #0b0b0c | 10 | 10 |
| p[tv-hero-eyebrow] "Continue watching" | 4.1 | 4.5 | #e50914 | #0b0b0c | 7 | 7 |
| p[tv-hero-eyebrow] "Weekend" | 4.1 | 4.5 | #e50914 | #0b0b0c | 2 | 2 |
| p.tv-hero-eyebrow "Popular this week" | 4.1 | 4.5 | #e50914 | #0b0b0c | 6 | 6 |
| p[tv-hero-eyebrow] "Series to binge" | 4.1 | 4.5 | #e50914 | #0b0b0c | 4 | 4 |
| p.tv-hero-eyebrow "Series to binge" | 4.1 | 4.5 | #e50914 | #0b0b0c | 4 | 4 |
| p[tv-hero-eyebrow] "Guest" | 4.1 | 4.5 | #e50914 | #0b0b0c | 2 | 2 |
| p[tv-hero-eyebrow] "Ana" | 4.1 | 4.5 | #e50914 | #0b0b0c | 1 | 1 |
| p[tv-hero-eyebrow] "Friend requests" | 4.1 | 4.5 | #e50914 | #0b0b0c | 1 | 1 |
| p[tv-hero-eyebrow] "Your friends" | 4.1 | 4.5 | #e50914 | #0b0b0c | 5 | 5 |



## Controls with no name (17)

A control with no text, aria-label or title cannot be told apart by a screen reader.

| element | size | count | pictures |
|---|---|---|---|
| input[tv-rename] | 358x48 | 1 | 1 |
| input[auth-email] | 358x48 | 1 | 1 |
| input[auth-password] | 358x48 | 1 | 1 |
| input[password-current] | 358x48 | 1 | 1 |
| input[password-new] | 358x48 | 1 | 1 |
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

## Phone controls under 44 px (81)

The comfortable thumb target. Links inside running text are left out.

| element | size | count | pictures |
|---|---|---|---|
| button[fullscreen-toggle] (Full screen) | 40x40 | 1 | 1 |
| button[account-button] "Sign in" | 92x34 | 12 | 12 |
| button[switch-lang-en] "English" | 95x34 | 1 | 1 |
| button[switch-lang-ro] "Română" | 95x34 | 1 | 1 |
| button[switch-lang-it] "Italiano" | 95x34 | 1 | 1 |
| button[menu] (TV menu) | 40x40 | 28 | 28 |
| button[paste] "Paste" | 72x34 | 25 | 25 |
| button[continue-list-toggle] (Add to a list: The Glass Orchard) | 36x36 | 9 | 9 |
| button[continue-remove] (Remove from Continue watching: The Glass Orchard) | 36x36 | 26 | 26 |
| button[lists-manage] "Manage lists" | 88x26 | 26 | 26 |
| button[list-remove] (Remove from Favourites: Harvest Moon Motel) | 36x36 | 26 | 26 |
| button[list-remove] (Remove from Favourites: Midwinter Parade) | 36x36 | 26 | 26 |
| button[list-remove] (Remove from Weekend: Blue Hour) | 36x36 | 9 | 9 |
| button[list-remove] (Remove from Weekend: Sundown Protocol) | 36x36 | 9 | 9 |
| button[ratings-all] "See all" | 50x26 | 21 | 21 |
| button.field-btn "✕" | 29x37 | 1 | 1 |
| button[filter-all] "All" | 46x32 | 3 | 3 |
| button[filter-movies] "Movies" | 74x32 | 3 | 3 |
| button[filter-series] "Series" | 66x32 | 3 | 3 |
| button[library-list-toggle] (Add to a list: The Long Harbour) | 36x36 | 3 | 3 |
| button[library-list-toggle] (Add to a list: Paper Moons) | 36x36 | 3 | 3 |
| button[library-list-toggle] (Add to a list: The Long Night) | 36x36 | 3 | 3 |
| button[library-list-toggle] (Add to a list: Harbour Lights) | 36x36 | 3 | 3 |
| button[library-list-toggle] (In your lists: Velvet Static) | 36x36 | 3 | 3 |
| button[library-list-toggle] (Add to a list: The Orchard Year) | 36x36 | 3 | 3 |
| button[sheet-close] (Close) | 40x40 | 13 | 12 |
| button[title-season-1] "Season 1" | 83x36 | 1 | 1 |
| button[title-season-2] "Season 2" | 85x36 | 1 | 1 |
| button[title-season-3] "Season 3" | 85x36 | 1 | 1 |
| button[page-back] (Back) | 40x40 | 17 | 17 |
| button[auth-switch] "New here? Create an account" | 218x40 | 1 | 1 |
| button[lang-en] "English" | 114x43 | 2 | 2 |
| button[lang-ro] "Română" | 114x43 | 2 | 2 |
| button[lang-it] "Italiano" | 114x43 | 2 | 2 |
| button[accent-blue] (Blue) | 42x42 | 2 | 2 |
| button[accent-purple] (Purple) | 42x42 | 2 | 2 |
| button[accent-green] (Green) | 42x42 | 2 | 2 |
| button[accent-orange] (Orange) | 42x42 | 2 | 2 |
| button[accent-pink] (Pink) | 42x42 | 2 | 2 |
| button[look-classic] "Classic" | 114x43 | 2 | 2 |

...and 41 more in the json.

## Text or controls outside the TV's safe margin (183)

Inside 2.5% of the left/right edge or 5% of the top/bottom. What crosses an edge (a row that scrolls past it, the page under its fade) and the pictures of such a row with the words under them are not counted.

| element | edges | count | pictures |
|---|---|---|---|
| button[rail-search] | 1.2% .. 4.8% / 10.7% .. 17.9% | 33 | 33 |
| button[rail-home] | 1.2% .. 4.8% / 18.5% .. 25.7% | 33 | 33 |
| button[rail-movies] | 1.2% .. 4.8% / 26.1% .. 33.3% | 33 | 33 |
| button[rail-series] | 1.2% .. 4.8% / 33.9% .. 41.1% | 33 | 33 |
| button[rail-categories] | 1.2% .. 4.8% / 41.7% .. 48.9% | 33 | 33 |
| button[rail-list] | 1.2% .. 4.8% / 49.3% .. 56.5% | 33 | 33 |
| button[rail-party] | 1.2% .. 4.8% / 59.9% .. 67.1% | 33 | 33 |
| button[rail-connect] | 1.2% .. 4.8% / 67.6% .. 74.9% | 33 | 33 |
| button[rail-profile] | 1.2% .. 4.8% / 75.3% .. 82.5% | 33 | 33 |
| span "Kin" | 7.0% .. 12.6% / 4.6% .. 8.5% | 34 | 34 |
| button[tv-account-chip] (Sign in) | 80.7% .. 91.1% / 3.2% .. 9.6% | 34 | 34 |
| span "Sign in" | 84.8% .. 89.5% / 4.6% .. 8.2% | 20 | 20 |
| button[fullscreen-toggle] (Full screen) | 92.0% .. 95.6% / 3.2% .. 9.6% | 62 | 62 |
| button[rail-search] | 1.2% .. 24.3% / 10.7% .. 17.9% | 1 | 1 |
| button[rail-home] | 1.2% .. 24.3% / 18.5% .. 25.7% | 1 | 1 |
| button[rail-movies] | 1.2% .. 24.3% / 26.1% .. 33.3% | 1 | 1 |
| button[rail-series] | 1.2% .. 24.3% / 33.9% .. 41.1% | 1 | 1 |
| button[rail-categories] | 1.2% .. 24.3% / 41.7% .. 48.9% | 1 | 1 |
| button[rail-list] | 1.2% .. 24.3% / 49.3% .. 56.5% | 1 | 1 |
| button[rail-party] | 1.2% .. 24.3% / 59.9% .. 67.1% | 1 | 1 |
| button[rail-connect] | 1.2% .. 24.3% / 67.6% .. 74.9% | 1 | 1 |
| button[rail-profile] | 1.2% .. 24.3% / 75.3% .. 82.5% | 1 | 1 |
| button[tv-detail-close] "Close" | 87.3% .. 95.5% / 4.2% .. 9.0% | 7 | 7 |
| button[tv-season-1] "Season 1" | 7.3% .. 19.3% / 89.7% .. 97.9% | 1 | 1 |
| button[tv-season-2] "Season 2" | 20.2% .. 32.5% / 89.7% .. 97.9% | 1 | 1 |
| button[tv-season-3] "Season 3" | 33.3% .. 45.6% / 89.7% .. 97.9% | 1 | 1 |
| h1[tv-title] "long" | 3.2% .. 8.4% / 3.9% .. 9.6% | 7 | 7 |
| div.hud-clock "19:35" | 89.2% .. 96.8% / 3.9% .. 7.8% | 4 | 4 |
| button[tv-play-btn] (Pause) | 3.2% .. 6.9% / 89.6% .. 96.1% | 6 | 6 |
| button.tv-btn (Back 10 seconds) | 7.7% .. 10.7% / 90.1% .. 95.4% | 6 | 6 |
| button.tv-btn (Forward 10 seconds) | 11.3% .. 14.2% / 90.1% .. 95.4% | 5 | 5 |
| button[tv-speed-btn] "1×" | 71.3% .. 74.8% / 90.6% .. 95.1% | 5 | 5 |
| button[tv-party-btn] (Watch party) | 75.2% .. 86.3% / 90.6% .. 95.1% | 5 | 5 |
| button[tv-mute-btn] (Mute) | 86.8% .. 89.8% / 90.1% .. 95.4% | 6 | 6 |
| button[tv-fullscreen-btn] (Fullscreen) | 90.3% .. 93.3% / 90.1% .. 95.4% | 6 | 6 |
| button[tv-stop-btn] (Stop) | 93.8% .. 96.8% / 90.1% .. 95.4% | 6 | 6 |
| button[tv-bell] (Notifications, 2 waiting) | 78.2% .. 81.8% / 3.2% .. 9.6% | 6 | 6 |
| b[tv-bell-badge] "2" | 80.5% .. 82.2% / 2.8% .. 5.8% | 3 | 3 |
| button[tv-account-chip] (Account and profiles: Ana) | 82.7% .. 91.1% / 3.2% .. 9.6% | 14 | 14 |
| span "Ana" | 86.8% .. 89.5% / 4.6% .. 8.2% | 14 | 14 |

...and 143 more in the json.

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
