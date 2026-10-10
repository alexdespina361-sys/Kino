import { describe, expect, it } from "vitest";
import { DICTIONARIES, detectLanguage, hasKey, translate } from "./index";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
const baseOf = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");

describe("translate", () => {
  it("fills in the values the sentence asks for", () => {
    expect(translate("en", "profiles.watchingAs", { name: "Alex" })).toBe("Watching as Alex");
    expect(translate("ro", "profiles.watchingAs", { name: "Alex" })).toBe("Te uiți ca Alex");
    expect(translate("it", "account.signedInAs", { email: "a@b.c" })).toBe("Connesso come a@b.c");
  });

  it("leaves a placeholder alone when it was not given a value", () => {
    expect(translate("en", "profiles.watchingAs")).toBe("Watching as {name}");
  });

  it("picks the plural form the language uses for the number", () => {
    expect(translate("en", "library.results", { count: 1 })).toBe("1 result");
    expect(translate("en", "library.results", { count: 2 })).toBe("2 results");
    // Romanian has a third form: "20 de rezultate", but "3 rezultate" and "1 rezultat"
    expect(translate("ro", "library.results", { count: 1 })).toBe("1 rezultat");
    expect(translate("ro", "library.results", { count: 3 })).toBe("3 rezultate");
    expect(translate("ro", "library.results", { count: 20 })).toBe("20 de rezultate");
    expect(translate("ro", "library.results", { count: 0 })).toBe("0 rezultate");
    expect(translate("it", "library.results", { count: 1 })).toBe("1 risultato");
    expect(translate("it", "library.results", { count: 5 })).toBe("5 risultati");
  });

  it("shows the key itself rather than nothing for a word nobody wrote", () => {
    expect(translate("en", "no.such.word" as never)).toBe("no.such.word");
  });
});

describe("the dictionaries", () => {
  const english = DICTIONARIES.en;
  const keys = Object.keys(english);

  for (const language of ["ro", "it"] as const) {
    const dictionary = DICTIONARIES[language];

    it(`${language} has every English word`, () => {
      expect(keys.filter((key) => !(key in dictionary))).toEqual([]);
    });

    it(`${language} has nothing English does not know`, () => {
      const bases = new Set(keys.map(baseOf));
      expect(Object.keys(dictionary).filter((key) => !bases.has(baseOf(key)))).toEqual([]);
    });

    it(`${language} has no empty text, and keeps the same placeholders`, () => {
      for (const [key, text] of Object.entries(dictionary)) {
        expect(text.trim(), key).not.toBe("");
        const original = english[key] ?? english[`${baseOf(key)}_other`] ?? "";
        expect(placeholders(text), key).toEqual(placeholders(original));
      }
    });
  }

  it("has every plural base in the forms its language needs", () => {
    for (const language of ["en", "ro", "it"] as const) {
      const rules = new Intl.PluralRules(language);
      const dictionary = DICTIONARIES[language];
      const bases = new Set(Object.keys(english).filter((key) => /_(one|other)$/.test(key)).map(baseOf));
      for (const base of bases) {
        for (const form of rules.resolvedOptions().pluralCategories) {
          // Italian also has "many" (millions), which falls back to "other"
          if (form === "many") continue;
          expect(`${base}_${form}` in dictionary || `${base}_other` in dictionary, `${language} ${base} ${form}`).toBe(true);
        }
        if (language === "ro") expect(`${base}_few` in dictionary, `ro ${base} few`).toBe(true);
      }
    }
  });

  it("knows which keys exist", () => {
    expect(hasKey("auth.signIn")).toBe(true);
    expect(hasKey("library.results")).toBe(true);
    expect(hasKey("error.invalid_credentials")).toBe(true);
    expect(hasKey("error.nope")).toBe(false);
  });
});

describe("detectLanguage", () => {
  it("prefers what was chosen, then the browser, then English", () => {
    expect(detectLanguage("it", ["ro-RO"])).toBe("it");
    expect(detectLanguage(undefined, ["fr-FR", "ro-RO", "en"])).toBe("ro");
    expect(detectLanguage(undefined, ["de"])).toBe("en");
    expect(detectLanguage("xx", ["it-IT"])).toBe("it");
    expect(detectLanguage(undefined, [])).toBe("en");
  });
});
