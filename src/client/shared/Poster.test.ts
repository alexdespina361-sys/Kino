import { describe, expect, it } from "vitest";
import { posterSizes, sharper } from "./Poster";

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

  it("leaves alone a size already chosen, another site's picture, and none", () => {
    expect(posterSizes(sharper("https://image.tmdb.org/t/p/w500/abc.jpg"))).toBeUndefined(); // (the banner's 780, asked for on purpose)
    expect(posterSizes("https://image.tmdb.org/t/p/original/back.jpg")).toBeUndefined();
    expect(posterSizes("https://image.tmdb.org/t/p/w1280/a b.jpg")).toBeUndefined();
    expect(posterSizes("https://example.com/t/p/w500/abc.jpg")).toBeUndefined();
    expect(posterSizes("https://image.tmdb.org/t/p/w500/a b.jpg")).toBeUndefined(); // (a space would split the list)
    expect(posterSizes(undefined)).toBeUndefined();
  });
});
