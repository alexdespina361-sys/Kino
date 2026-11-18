import { describe, expect, it } from "vitest";
import { posterSizes, sharper, TILE_FIT } from "./Poster";

describe("posterSizes", () => {
  it("offers the movie database's 342, 500 and 780 px of a library poster, for the browser to take the smallest that is sharp where it is drawn", () => {
    expect(posterSizes("https://image.tmdb.org/t/p/w500/abc.jpg")).toEqual({
      srcSet: "https://image.tmdb.org/t/p/w342/abc.jpg 342w, https://image.tmdb.org/t/p/w500/abc.jpg 500w, https://image.tmdb.org/t/p/w780/abc.jpg 780w",
      sizes: "auto, 160px",
    });
  });

  it("offers the 300, 780 and 1280 px of a library still (a wide card takes the 780 one, a fifth of the bytes)", () => {
    expect(posterSizes("https://image.tmdb.org/t/p/w1280/back.jpg")).toEqual({
      srcSet: "https://image.tmdb.org/t/p/w300/back.jpg 300w, https://image.tmdb.org/t/p/w780/back.jpg 780w, https://image.tmdb.org/t/p/w1280/back.jpg 1280w",
      sizes: "auto, 400px",
    });
  });

  it("a TV tile adds the 185 px poster and says its own width, for a browser that cannot measure it (every TV before Chromium 126)", () => {
    expect(posterSizes("https://image.tmdb.org/t/p/w500/abc.jpg", TILE_FIT)).toEqual({
      srcSet: "https://image.tmdb.org/t/p/w185/abc.jpg 185w, https://image.tmdb.org/t/p/w342/abc.jpg 342w, https://image.tmdb.org/t/p/w500/abc.jpg 500w, https://image.tmdb.org/t/p/w780/abc.jpg 780w",
      sizes: `auto, ${TILE_FIT.poster}`,
    });
    expect(posterSizes("https://image.tmdb.org/t/p/w1280/back.jpg", TILE_FIT)?.sizes).toBe(`auto, ${TILE_FIT.still}`);
  });

  it("leaves alone a size already chosen, another site's picture, and none", () => {
    expect(posterSizes(sharper("https://image.tmdb.org/t/p/w500/abc.jpg"))).toBeUndefined();
    expect(posterSizes("https://image.tmdb.org/t/p/original/back.jpg")).toBeUndefined();
    expect(posterSizes("https://image.tmdb.org/t/p/w1280/a b.jpg")).toBeUndefined();
    expect(posterSizes("https://example.com/t/p/w500/abc.jpg")).toBeUndefined();
    expect(posterSizes("https://image.tmdb.org/t/p/w500/a b.jpg")).toBeUndefined();
    expect(posterSizes(undefined)).toBeUndefined();
  });
});
