import { describe, expect, it } from "vitest";
import { DEFAULT_LIST, listKey } from "../../shared";
import { listTap } from "./listTap";

const URL = "https://example.test/watch/1";
const ONE = [{ id: DEFAULT_LIST }];
const SEVERAL = [{ id: DEFAULT_LIST }, { id: "horror" }, { id: "kids" }];
const savedIn = (...lists: string[]) => new Set(lists.map((list) => listKey(URL, list)));

describe("one tap on a title's +", () => {
  it("puts a title that is in no list in the main list, with one list or several", () => {
    expect(listTap(ONE, savedIn(), URL)).toBe("add");
    expect(listTap(SEVERAL, savedIn(), URL)).toBe("add");
  });

  it("takes a title that is only in the main list out of it, with one list or several", () => {
    expect(listTap(ONE, savedIn(DEFAULT_LIST), URL)).toBe("remove");
    expect(listTap(SEVERAL, savedIn(DEFAULT_LIST), URL)).toBe("remove");
  });

  it("asks which list for a title that is in another list, with or without the main one", () => {
    expect(listTap(SEVERAL, savedIn("horror"), URL)).toBe("pick");
    expect(listTap(SEVERAL, savedIn(DEFAULT_LIST, "kids"), URL)).toBe("pick");
  });

  it("goes by this title only, and by the lists there are (a list that was removed does not count)", () => {
    expect(listTap(SEVERAL, new Set([listKey("https://example.test/watch/2", "horror")]), URL)).toBe("add");
    expect(listTap(ONE, savedIn("gone"), URL)).toBe("add");
  });
});
