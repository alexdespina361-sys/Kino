import { describe, expect, it } from "vitest";
import { gridRows, stepFrom, type Pos, type Shape, type Zone } from "./browseNav";

const at = (zone: Zone, row: number, col: number): Pos => ({ zone, row, col });

describe("gridRows", () => {
  it("lays things out in rows of a fixed width", () => {
    expect(gridRows(0, 3)).toEqual([]);
    expect(gridRows(7, 3)).toEqual([3, 3, 1]);
    expect(gridRows(6, 3)).toEqual([3, 3]);
  });
});

describe("stepFrom on rows of titles", () => {
  const shape: Shape = { rail: [1, 1, 1, 1], top: [1], rows: [8, 3, 5] };

  it("walks along a row and stops at its ends", () => {
    expect(stepFrom(shape, at("rows", 0, 2), "right")).toEqual(at("rows", 0, 3));
    expect(stepFrom(shape, at("rows", 1, 2), "right")).toBeNull();
    expect(stepFrom(shape, at("rows", 0, 3), "left")).toEqual(at("rows", 0, 2));
  });

  it("opens the menu from the first title of a row, whichever row", () => {
    expect(stepFrom(shape, at("rows", 0, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom(shape, at("rows", 2, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
  });

  it("goes down and up between rows, keeping the column as far as the row has one", () => {
    expect(stepFrom(shape, at("rows", 0, 6), "down")).toEqual(at("rows", 1, 2));
    expect(stepFrom(shape, at("rows", 1, 2), "down")).toEqual(at("rows", 2, 2));
    expect(stepFrom(shape, at("rows", 2, 4), "up")).toEqual(at("rows", 1, 2));
    expect(stepFrom(shape, at("rows", 2, 4), "down")).toBeNull();
  });

  it("reaches the account button from the top row and comes back down to where it was", () => {
    expect(stepFrom(shape, at("rows", 0, 3), "up")).toEqual(at("top", 0, 0));
    expect(stepFrom(shape, at("top", 0, 0), "down")).toEqual({ zone: "content", row: -1, col: -1 });
    expect(stepFrom(shape, at("top", 0, 0), "left")).toBeNull();
  });

  it("walks the menu up and down, and right goes back to the titles", () => {
    expect(stepFrom(shape, at("rail", 1, 0), "down")).toEqual(at("rail", 2, 0));
    expect(stepFrom(shape, at("rail", 0, 0), "up")).toBeNull();
    expect(stepFrom(shape, at("rail", 3, 0), "down")).toBeNull();
    expect(stepFrom(shape, at("rail", 2, 0), "right")).toEqual({ zone: "content", row: -1, col: -1 });
    expect(stepFrom(shape, at("rail", 2, 0), "left")).toBeNull();
  });

  it("does not offer the account button when there is none", () => {
    expect(stepFrom({ rows: [3] }, at("rows", 0, 0), "up")).toBeNull();
  });

  it("walks from the account button to the full screen one beside it, and back", () => {
    const corner: Shape = { ...shape, top: [2] };
    expect(stepFrom(corner, at("rows", 0, 3), "up")).toEqual(at("top", 0, 0)); // (it lands on the account button, as before)
    expect(stepFrom(corner, at("top", 0, 0), "right")).toEqual(at("top", 0, 1));
    expect(stepFrom(corner, at("top", 0, 1), "right")).toBeNull();
    expect(stepFrom(corner, at("top", 0, 1), "left")).toEqual(at("top", 0, 0));
    expect(stepFrom(corner, at("top", 0, 0), "left")).toBeNull();
    expect(stepFrom(corner, at("top", 0, 1), "down")).toEqual({ zone: "content", row: -1, col: -1 });
    expect(stepFrom(shape, at("top", 0, 0), "right")).toBeNull(); // one button: nowhere to go
  });
});

describe("stepFrom with the banner's buttons (Play, My List)", () => {
  const shape: Shape = { rail: [1, 1, 1], top: [1], hero: [2], rows: [6, 4] };

  it("goes up from the first row to the buttons, and down from them to the titles", () => {
    expect(stepFrom(shape, at("rows", 0, 4), "up")).toEqual(at("hero", 0, 0));
    expect(stepFrom(shape, at("hero", 0, 1), "down")).toEqual({ zone: "content", row: -1, col: -1 });
    expect(stepFrom(shape, at("rows", 1, 0), "up")).toEqual(at("rows", 0, 0)); // only the first row leads to them
  });

  it("walks along the buttons, opens the menu to their left, and reaches the account button above them", () => {
    expect(stepFrom(shape, at("hero", 0, 0), "right")).toEqual(at("hero", 0, 1));
    expect(stepFrom(shape, at("hero", 0, 1), "right")).toBeNull();
    expect(stepFrom(shape, at("hero", 0, 1), "left")).toEqual(at("hero", 0, 0));
    expect(stepFrom(shape, at("hero", 0, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom(shape, at("hero", 0, 0), "up")).toEqual(at("top", 0, 0));
  });

  it("comes down from the account button onto the buttons when there are some, and onto the titles when there are none", () => {
    expect(stepFrom(shape, at("top", 0, 0), "down")).toEqual(at("hero", 0, 0));
    expect(stepFrom({ ...shape, hero: [] }, at("top", 0, 0), "down")).toEqual({ zone: "content", row: -1, col: -1 });
    expect(stepFrom({ ...shape, hero: [] }, at("rows", 0, 0), "up")).toEqual(at("top", 0, 0));
  });
});

describe("stepFrom on the search page", () => {
  // Six keys across and a last row of two wide ones, then the results three across.
  const shape: Shape = { rail: [1, 1], top: [1], keys: [6, 6, 6, 2], results: gridRows(7, 3) };

  it("walks the keys, and the wide keys keep to what is above them", () => {
    expect(stepFrom(shape, at("keys", 0, 1), "right")).toEqual(at("keys", 0, 2));
    expect(stepFrom(shape, at("keys", 2, 1), "down")).toEqual(at("keys", 3, 0)); // Space is under the left three
    expect(stepFrom(shape, at("keys", 2, 4), "down")).toEqual(at("keys", 3, 1)); // Delete under the right three
    expect(stepFrom(shape, at("keys", 3, 0), "up")).toEqual(at("keys", 2, 1));
    expect(stepFrom(shape, at("keys", 3, 1), "up")).toEqual(at("keys", 2, 4));
  });

  it("goes from the keys across to the results, and back to the end of the keys' row", () => {
    expect(stepFrom(shape, at("keys", 1, 5), "right")).toEqual(at("results", 1, 0));
    expect(stepFrom(shape, at("keys", 3, 1), "right")).toEqual(at("results", 2, 0)); // as low as the results go
    expect(stepFrom(shape, at("results", 1, 0), "left")).toEqual(at("keys", 1, 5));
    expect(stepFrom(shape, at("results", 2, 0), "left")).toEqual(at("keys", 2, 5));
  });

  it("opens the menu from the keys' first column, and goes nowhere right with no results", () => {
    expect(stepFrom(shape, at("keys", 1, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom({ ...shape, results: [] }, at("keys", 1, 5), "right")).toBeNull();
  });

  it("walks the results as a grid and goes up to the account button from the first row", () => {
    expect(stepFrom(shape, at("results", 0, 1), "down")).toEqual(at("results", 1, 1));
    expect(stepFrom(shape, at("results", 1, 2), "down")).toEqual(at("results", 2, 0)); // the last row has one
    expect(stepFrom(shape, at("results", 0, 2), "up")).toEqual(at("top", 0, 0));
  });
});

describe("stepFrom on a title's own page", () => {
  // Over the library: the page's buttons are all the arrow keys reach, however much lies under it.
  const shape: Shape = { rail: [1, 1], top: [1], hero: [2], rows: [8, 3], detail: [3], close: [1] };

  it("walks along the buttons and stops at the left end, without leaving for the menu", () => {
    expect(stepFrom(shape, at("detail", 0, 0), "right")).toEqual(at("detail", 0, 1));
    expect(stepFrom(shape, at("detail", 0, 1), "left")).toEqual(at("detail", 0, 0));
    expect(stepFrom(shape, at("detail", 0, 0), "left")).toBeNull();
  });

  it("reaches Close from the last button with Right, and from any button with Up, and comes back with Down or Left", () => {
    expect(stepFrom(shape, at("detail", 0, 2), "right")).toEqual(at("close", 0, 0));
    expect(stepFrom(shape, at("detail", 0, 0), "up")).toEqual(at("close", 0, 0));
    expect(stepFrom(shape, at("detail", 0, 1), "up")).toEqual(at("close", 0, 0));
    expect(stepFrom(shape, at("close", 0, 0), "down")).toEqual(at("detail", 0, 0));
    expect(stepFrom(shape, at("close", 0, 0), "left")).toEqual(at("detail", 0, 2));
    expect(stepFrom(shape, at("close", 0, 0), "up")).toBeNull();
    expect(stepFrom(shape, at("close", 0, 0), "right")).toBeNull();
  });

  it("goes nowhere down from a film's buttons, and stays on its last button without a Close", () => {
    expect(stepFrom(shape, at("detail", 0, 1), "down")).toBeNull();
    expect(stepFrom({ ...shape, close: [] }, at("detail", 0, 2), "right")).toBeNull();
    expect(stepFrom({ ...shape, close: [] }, at("detail", 0, 1), "up")).toBeNull();
  });
});

describe("stepFrom on a show's own page (buttons, seasons, episodes, one under the other)", () => {
  const shape: Shape = { rail: [1, 1], top: [1], rows: [8], detail: [2], close: [1], seasons: [4], episodes: [1, 1, 1] };

  it("goes down from the buttons to the seasons, then to the episodes, and back up the same way", () => {
    expect(stepFrom(shape, at("detail", 0, 1), "down")).toEqual(at("seasons", 0, 0));
    expect(stepFrom(shape, at("seasons", 0, 2), "down")).toEqual(at("episodes", 0, 0));
    expect(stepFrom(shape, at("episodes", 0, 0), "up")).toEqual(at("seasons", 0, 0));
    expect(stepFrom(shape, at("seasons", 0, 3), "up")).toEqual(at("detail", 0, 0));
    expect(stepFrom(shape, at("detail", 0, 0), "up")).toEqual(at("close", 0, 0));
  });

  it("walks along the seasons and stops at both ends", () => {
    expect(stepFrom(shape, at("seasons", 0, 0), "right")).toEqual(at("seasons", 0, 1));
    expect(stepFrom(shape, at("seasons", 0, 3), "right")).toBeNull();
    expect(stepFrom(shape, at("seasons", 0, 1), "left")).toEqual(at("seasons", 0, 0));
    expect(stepFrom(shape, at("seasons", 0, 0), "left")).toBeNull();
  });

  it("walks down the episodes and stops at the last, without leaving sideways", () => {
    expect(stepFrom(shape, at("episodes", 0, 0), "down")).toEqual(at("episodes", 1, 0));
    expect(stepFrom(shape, at("episodes", 1, 0), "up")).toEqual(at("episodes", 0, 0));
    expect(stepFrom(shape, at("episodes", 2, 0), "down")).toBeNull();
    expect(stepFrom(shape, at("episodes", 1, 0), "left")).toBeNull();
    expect(stepFrom(shape, at("episodes", 1, 0), "right")).toBeNull();
  });

  it("skips the seasons of a show that has one, and the episodes that are not there yet", () => {
    const oneSeason: Shape = { ...shape, seasons: [] };
    expect(stepFrom(oneSeason, at("detail", 0, 0), "down")).toEqual(at("episodes", 0, 0));
    expect(stepFrom(oneSeason, at("episodes", 0, 0), "up")).toEqual(at("detail", 0, 0));
    const loading: Shape = { ...shape, episodes: [] };
    expect(stepFrom(loading, at("seasons", 0, 1), "down")).toBeNull();
    expect(stepFrom({ ...loading, seasons: [] }, at("detail", 0, 0), "down")).toBeNull();
  });
});

describe("stepFrom with the search filter (All, Movies, Series)", () => {
  // The filter sits above the results, to the right of the keys.
  const shape: Shape = { rail: [1, 1], top: [1], keys: [6, 6, 6, 2], chips: [3], results: gridRows(7, 3) };

  it("reaches the filter from the first row of keys, and the rest of the keys still lead to the results", () => {
    expect(stepFrom(shape, at("keys", 0, 5), "right")).toEqual(at("chips", 0, 0));
    expect(stepFrom(shape, at("keys", 1, 5), "right")).toEqual(at("results", 1, 0));
  });

  it("walks along the filter and goes back to the keys from its first button", () => {
    expect(stepFrom(shape, at("chips", 0, 0), "right")).toEqual(at("chips", 0, 1));
    expect(stepFrom(shape, at("chips", 0, 2), "right")).toBeNull();
    expect(stepFrom(shape, at("chips", 0, 0), "left")).toEqual(at("keys", 0, 5));
  });

  it("goes between the filter and the results in the same column, and up from the filter to the account button", () => {
    expect(stepFrom(shape, at("chips", 0, 2), "down")).toEqual(at("results", 0, 2));
    expect(stepFrom(shape, at("results", 0, 1), "up")).toEqual(at("chips", 0, 1));
    expect(stepFrom(shape, at("chips", 0, 1), "up")).toEqual(at("top", 0, 0));
  });

  it("stays on the filter when there is nothing below it, and skips it when there is no filter", () => {
    expect(stepFrom({ ...shape, results: [] }, at("chips", 0, 1), "down")).toBeNull();
    expect(stepFrom({ ...shape, chips: [] }, at("results", 0, 1), "up")).toEqual(at("top", 0, 0));
  });
});

describe("stepFrom on the lists page (a row of buttons over the grid)", () => {
  const shape: Shape = { rail: [1, 1, 1], top: [1], chips: [5], grid: [5, 5, 2] };

  it("goes up from the first row of titles to the buttons, and down from them to the titles", () => {
    expect(stepFrom(shape, at("grid", 0, 3), "up")).toEqual(at("chips", 0, 3));
    expect(stepFrom(shape, at("grid", 1, 3), "up")).toEqual(at("grid", 0, 3));
    expect(stepFrom(shape, at("chips", 0, 2), "down")).toEqual(at("grid", 0, 2));
  });

  it("walks along the buttons, opens the menu from the first, and reaches the account button above them", () => {
    expect(stepFrom(shape, at("chips", 0, 1), "right")).toEqual(at("chips", 0, 2));
    expect(stepFrom(shape, at("chips", 0, 4), "right")).toBeNull();
    expect(stepFrom(shape, at("chips", 0, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom(shape, at("chips", 0, 2), "up")).toEqual(at("top", 0, 0));
  });

  it("stays on the buttons when the list has no titles, and goes up from the titles to the account button when there are no buttons", () => {
    expect(stepFrom({ ...shape, grid: [] }, at("chips", 0, 1), "down")).toBeNull();
    expect(stepFrom({ ...shape, chips: [] }, at("grid", 0, 1), "up")).toEqual(at("top", 0, 0));
  });
});

describe("stepFrom on a phone (the menu is a bar of four places along the bottom, the sections a row of buttons over the titles)", () => {
  const phone: Shape = { rail: [4], top: [2], chips: [5], rows: [6, 4, 5] };
  const CONTENT = { zone: "content", row: -1, col: -1 };

  it("walks the bar sideways, leaves it upwards for the titles, and has nothing under it", () => {
    expect(stepFrom(phone, at("rail", 0, 1), "right")).toEqual(at("rail", 0, 2));
    expect(stepFrom(phone, at("rail", 0, 3), "right")).toBeNull();
    expect(stepFrom(phone, at("rail", 0, 2), "left")).toEqual(at("rail", 0, 1));
    expect(stepFrom(phone, at("rail", 0, 0), "left")).toBeNull();
    expect(stepFrom(phone, at("rail", 0, 2), "up")).toEqual(CONTENT);
    expect(stepFrom(phone, at("rail", 0, 2), "down")).toBeNull();
  });

  it("reaches the bar from the bottom of the page, not from the side (there is no menu on the left)", () => {
    expect(stepFrom(phone, at("rows", 2, 1), "down")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom(phone, at("rows", 0, 0), "left")).toBeNull();
    expect(stepFrom(phone, at("chips", 0, 0), "left")).toBeNull();
    expect(stepFrom({ ...phone, rows: [], chips: [], grid: [4, 2], foot: [1] }, at("foot", 0, 0), "down")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom({ ...phone, rows: [], chips: [], grid: [4, 2] }, at("grid", 1, 1), "down")).toEqual({ zone: "rail", row: -1, col: -1 });
  });

  it("goes from the titles up to the sections' buttons, along them, down to the titles, and up again to the account button", () => {
    expect(stepFrom(phone, at("rows", 0, 3), "up")).toEqual(at("chips", 0, 0)); // (the page puts it on the one that is shown)
    expect(stepFrom(phone, at("rows", 1, 3), "up")).toEqual(at("rows", 0, 3));
    expect(stepFrom(phone, at("chips", 0, 1), "right")).toEqual(at("chips", 0, 2));
    expect(stepFrom(phone, at("chips", 0, 4), "right")).toBeNull();
    expect(stepFrom(phone, at("chips", 0, 2), "down")).toEqual(CONTENT);
    expect(stepFrom(phone, at("chips", 0, 2), "up")).toEqual(at("top", 0, 0));
    expect(stepFrom(phone, at("top", 0, 1), "down")).toEqual(at("chips", 0, 0));
  });

  it("goes from the buttons over a page's titles down to the bar when it has no titles", () => {
    expect(stepFrom({ ...phone, rows: [] }, at("chips", 0, 1), "down")).toEqual({ zone: "rail", row: -1, col: -1 });
  });

  it("is the TV's own, the menu down the left, wherever the menu is a column", () => {
    const tv: Shape = { ...phone, rail: [1, 1, 1, 1], chips: [] };
    expect(stepFrom(tv, at("rows", 0, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom(tv, at("rows", 2, 1), "down")).toBeNull();
    expect(stepFrom(tv, at("top", 0, 0), "down")).toEqual(CONTENT);
    expect(stepFrom(tv, at("rail", 0, 0), "down")).toEqual(at("rail", 1, 0));
  });
});

describe("stepFrom on a friend's page (buttons over the titles, one button under them)", () => {
  const shape: Shape = { rail: [1, 1, 1], top: [1], chips: [3], grid: [4, 2], foot: [1] };

  it("goes down from the last row of titles to the button under them, and up from it to the last row", () => {
    expect(stepFrom(shape, at("grid", 0, 2), "down")).toEqual(at("grid", 1, 1)); // (a row below still: the last one has only two)
    expect(stepFrom(shape, at("grid", 1, 1), "down")).toEqual(at("foot", 0, 0));
    expect(stepFrom(shape, at("foot", 0, 0), "up")).toEqual(at("grid", 1, 0));
  });

  it("reaches it from the buttons over the titles when there are no titles, and goes back up to them", () => {
    const none: Shape = { ...shape, grid: [] };
    expect(stepFrom(none, at("chips", 0, 1), "down")).toEqual(at("foot", 0, 0));
    expect(stepFrom(none, at("foot", 0, 0), "up")).toEqual(at("chips", 0, 0));
    expect(stepFrom({ ...none, chips: [] }, at("foot", 0, 0), "up")).toEqual(at("top", 0, 0));
  });

  it("has nothing beside or under it but the menu", () => {
    expect(stepFrom(shape, at("foot", 0, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom(shape, at("foot", 0, 0), "right")).toBeNull();
    expect(stepFrom(shape, at("foot", 0, 0), "down")).toBeNull();
  });

  it("is not a stop on a page without one: the last row of titles leads nowhere down", () => {
    expect(stepFrom({ ...shape, foot: [] }, at("grid", 1, 1), "down")).toBeNull();
    expect(stepFrom({ ...shape, grid: [], foot: [] }, at("chips", 0, 1), "down")).toBeNull();
  });
});