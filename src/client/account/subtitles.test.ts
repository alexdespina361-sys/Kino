import { describe, expect, it } from "vitest";
import type { TrackGroup } from "../../shared";
import { foldLanguages } from "./subtitles";

const group = (key: string): TrackGroup => ({ key, name: key.toUpperCase(), tracks: [{ id: key.charCodeAt(0), label: key, lang: key }] });
const keys = (groups: readonly TrackGroup[]) => groups.map((one) => one.key);

describe("foldLanguages", () => {
  const [en, ro, it_, fr, de, es] = ["en", "ro", "it", "fr", "de", "es"].map(group) as [TrackGroup, TrackGroup, TrackGroup, TrackGroup, TrackGroup, TrackGroup];

  it("shows the profile's own languages, three at most, and folds every other one under More languages", () => {
    const folded = foldLanguages([en, ro], [fr, de, es], []);
    expect(keys(folded.lead)).toEqual(["en", "ro"]);
    expect(keys(folded.rest)).toEqual(["fr", "de", "es"]);
    expect(keys(foldLanguages([en, ro, it_, fr], [de, es], []).lead)).toEqual(["en", "ro", "it"]);
  });

  it("shows the first three when none of the profile's languages is there", () => {
    const folded = foldLanguages([], [fr, de, es, it_, ro], []);
    expect(keys(folded.lead)).toEqual(["fr", "de", "es"]);
    expect(keys(folded.rest)).toEqual(["it", "ro"]);
  });

  it("keeps the language that is playing in sight even when it is one of the others", () => {
    const folded = foldLanguages([en], [fr, de, es], ["de"]);
    expect(keys(folded.lead)).toEqual(["en", "de"]);
    expect(keys(folded.rest)).toEqual(["fr", "es"]);
  });

  it("does not fold a single language: a More button in its place would save nothing", () => {
    const folded = foldLanguages([en, ro], [fr], []);
    expect(keys(folded.lead)).toEqual(["en", "ro", "fr"]);
    expect(folded.rest).toEqual([]);
    expect(keys(foldLanguages([], [en, ro], []).lead)).toEqual(["en", "ro"]);
  });
});
