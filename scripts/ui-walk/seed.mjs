// The guest of the TV walks (tv.mjs, tv-keys.mjs): things to continue, a favourites list and two lists of its own, some ratings, a few finished films.
import { base, guestData, movies, series } from "./lib.mjs";

const at = Date.now();
const day = (n) => at - n * 86_400_000;
const watch = (i) => `https://films.example/watch/${i}`;
const card = (i) => ({ title: movies[i].title, url: watch(i), image: movies[i].image, backdrop: movies[i].backdrop, year: movies[i].year });
const progress = (i, position, duration, extra = {}) => ({ key: `url:${watch(i)}`, at: at - (i + 1) * 600_000, position, duration, ...card(i), ...extra });
const saved = (i, list) => ({ key: list ? `${list}|url:${watch(i)}` : `url:${watch(i)}`, at: day(i % 5), ...(list ? { list } : {}), id: movies[i].id, description: movies[i].description, ...card(i) });
const rated = (i, score, note) => ({ key: `rate:${watch(i)}`, at: day(i % 6), kind: "movie", score, ratedAt: day(i % 6), ...(note ? { note } : {}), ...card(i) });

/** A guest who has been using the TV for a while: things to continue, a favourites list and two of its own, some ratings, a few finished films. */
export const seed = guestData({
  progress: [
    progress(5, 2700, 6600),
    progress(7, 5000, 6000),
    progress(9, 600, 7200),
    { key: "show:The Long Night", at: at - 7_200_000, title: series[0].title, url: `${base}/fixtures/pages/video.html?s=1&e=3`, image: series[0].image, backdrop: series[0].backdrop, year: series[0].year, position: 900, duration: 2400, season: 1, episode: 3 },
    progress(13, 6100, 6200, { done: true }),
    progress(15, 5400, 5400, { done: true }),
    progress(16, 7000, 7000, { done: true }),
    progress(17, 5900, 6000, { done: true }),
  ],
  list: [6, 8, 10, 12, 18].map((i) => saved(i)).concat([14, 19].map((i) => saved(i, "lweekend"))),
  listNames: [
    { key: "lweekend", at: day(3), name: "Weekend" },
    { key: "lclassics", at: day(2), name: "Classics" },
  ],
  ratings: [rated(11, 9, "Quiet, funny, and kinder than it looks."), rated(12, 7), rated(13, 8, "The ending lands."), rated(14, 10), rated(15, 6)],
});
