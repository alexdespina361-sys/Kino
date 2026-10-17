# Library discovery: more titles, a looser search, recommendations

Branch `feat/library-discovery`, on `main` after the UI polish (PR #16) and the pointer-focus fixes (PR #17). It follows the polish program's rules
(`docs/ui-polish/DESIGN_SYSTEM.md`, `DECISIONS.md`): one look, focus ring plus lift, one easing curve, the type scale, old TV browsers as the floor.
No new look, no new tokens.

## What was asked

Rows of about 20 titles; a search that does not forgive a slip and fails on a word that is not in the title; nothing "old but gold" on the home page
(Harry Potter is found by search, never met by scrolling). Wanted: far more titles per category, a looser "most like" search that forgives
misspellings (research a better searcher), Netflix-like endless scrolling with recommendations, and no hand-made lists of franchises.

## What the code did before

- `filmpire.ts` listed 31 hard-coded TMDB categories, page 1 each: 20 titles a row, and only what is popular, trending or top rated *now* (genre rows by
  `popularity.desc`). Nothing reached further than that, so no older title was ever on a row.
- The search made a MiniSearch index of the titles on the screen **on every call**, matched only those, asked TMDB (which forgives no slip and takes the
  last word as unfinished) and, with fewer than three answers, asked again with blind guesses. A word that is not in a title ("harry potter movie") failed the
  search outright.
- "Because you watched" had one row, for the last title only. Nothing went further than the rows the server first sent.

## Findings

**TMDB** (developer.themoviedb.org, read 2026-10-17): `/discover/{movie,tv}` takes dates (`primary_release_date.gte/lte`, `first_air_date.gte/lte`),
`with_genres`, `with_original_language`, `vote_count.gte/lte`, `vote_average.gte`, `with_type` and a sort (`vote_count.desc` is "known by many", which is what
finds the older classics; `vote_average.desc` is only sane with a `vote_count.gte`). 20 titles a page, up to 500 pages. About 40 requests a second are
tolerated. The free licence is non-commercial and asks for an attribution notice; results may be cached for up to six months. TMDB's daily id exports exist
and were **not** used (no download without the owner's say). Nothing here was run against TMDB: this machine has no key of its own (the one in the repo is
not to be used for tests); the server code is tested with injected answers, as `filmpire.test.ts` already does.

**Searcher bake-off** (scratch harness, 1,434 titles written by hand from franchises, foreign films, classics, short and numeric titles, shows and anime;
1,800 queries made by a seeded typo generator: swap, delete, insert, substitute, doubled letters, phonetic, two slips, spaces, half-typed, half-typed with a
slip, no article, noise words, year):

| Engine (pool = the whole corpus) | hit in top 10 | MRR | p50 per query |
|---|---|---|---|
| today's code (index rebuilt per call) | 80.5 % | .801 | 6.7 ms |
| MiniSearch, one cached index | 80.5 % | .801 | 0.5 ms |
| + relaxed (a letter more forgiven) | 87.4 % | .869 | 1.2 ms |
| **+ loose (any of the words, half at least)** | **98.7 %** | **.979** | 2.0 ms |
| + a vocabulary spell-corrector | 98.7 % | .972 | 4.6 ms |
| Fuse.js | 94.7 % | .937 | 9.5 ms (181 ms at 21,000 titles) |
| uFuzzy | 76.1 % | .744 | 0.6 ms |
| Orama (best of three settings) | 77.6 % | .626 | 1.9 ms |
| FlexSearch | 39.3 % | .385 | 0.0 ms |

At 21,434 titles MiniSearch builds in 123 ms (+24 MB), answers in 1-2 ms (p95 under 9 ms), and takes 2,000 more titles one by one in 14 ms.

The whole pipeline (the part the title is in the pool + TMDB, simulated as "every word whole, the last may be unfinished, 60 at most") was measured with
35 % and 70 % of the titles in the pool:

| Pipeline | 35 % pool | 70 % pool |
|---|---|---|
| today | 73.1 % | 77.8 % |
| cached index, same answers | 73.1 % | 77.8 % |
| + relaxed + loose tiers | 88.1 % | 94.2 % |
| + words that are no part of a title left out of what TMDB is asked | **89.6 %** | **95.1 %** |
| + the query corrected from the pool's words | 87.4 % | 94.5 % (S@1 down 3-7 points) |

So: the library stays MiniSearch (already a dependency, no new one); the gain is in how it is used. The spell-corrector earned nothing and is not built.
A bigger pool helps every line (+5 points from 35 % to 70 %), which is a reason to remember every title the server has ever seen.

## Decisions

1. **Shelves, not categories.** `src/server/library/shelves.ts` generates ~100 further TMDB queries from small tables (decades by votes and by rating, classic and
   best-ever by genre, hidden gems, cult classics, world cinema, anime, miniseries, series by decade and genre). Nothing is about a franchise: "old but gold" is
   a date window sorted by `vote_count.desc`. The 31 existing categories stay the first rows, with the ids and names they had.
2. **Paging in the server, not in the page.** `GET /api/library/rows?cursor=&kind=` gives the next five shelves (page 1 of each);
   `GET /api/library/more?row=&page=` gives the next 20 titles of one row. Both are remembered for the library's six hours, share one request between
   askers, leave out titles the library hides (`played()`), and never cache a failure.
3. **The page asks when it is near the end**, whichever way it got there: remote, mouse wheel, finger. A row asks for 20 more when it is two screens from its
   end; the page asks for five more rows when it is three rows from the bottom. A row holds 100 titles at most, a category grid 300, the feed 60 rows. Titles
   already on the page are not shown again in a later row (a row left with under 8 is dropped).
4. **Recommendations come from what TMDB already knows**: up to three "Because you watched/loved X" rows (the last titles watched, then the best rated),
   and one "Top picks for you" that ranks the titles several of those seeds agree on. No tracking of anything else, no genre model.
5. **The search**: one cached index that grows with every title the server has seen (rows, pages, answers; 30,000 at most); three tiers (strict,
   relaxed, loose); noise words ("movie", "full", "watch"...) left out of what places are asked; the old blind guesses stay as the last rescue. The answer says
   how many titles are exact (`exact`); the rest are "closest matches", shown after, and said so when nothing is exact.
6. **Translations**: one name per shelf in `category.*` like the 31 before, in en, ro and it (the test that guards the existing names takes in the new ones).
7. **TMDB's notice** is added to the library's credit line.

## Not done on purpose

- **Windowing the DOM** (unmounting rows far from the remote). Caps keep the page near 2.5 times today's tile count at the very most; if a TV struggles, the
  place to look is `tv-rows`. Tile pictures are still the w1280 backdrop (UI-056 in the polish issues list, open): endless scrolling makes that one matter more.
- **A franchise row** ("More in this collection") from TMDB's `belongs_to_collection`: it costs a request per title page, so it is a follow-up.
- **Genre taste** (a model of what a profile likes by genre): needs genres in every item; the seeds approach gets most of the value without it.
- The provider probe in `search`/`similar` is untouched (not extended to the new shelves; titles that never play are learned from failed plays as before).
  Three "because" rows ask `similar` up to three times as often as the one row did: each is remembered for six hours.

## Checking it

`pnpm vitest` for `shelves`, `filmpire`, `library`, `search`, `feed`, `recommend`, `pages`, `i18n`; Playwright `e2e/library-discovery.spec.ts` (TV and phone, with
the server's answers faked, as the other library specs do). `docs/library-discovery.md` is updated at the end of the round with what was built.
