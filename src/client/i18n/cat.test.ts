import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catEn } from "./cat.en";
import { catIt } from "./cat.it";
import { catRo } from "./cat.ro";
import { en } from "./en";
import { hasKey, translate } from "./index";
import { it as italian } from "./it";
import { ro as romanian } from "./ro";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
const english: Record<string, string> = catEn;

describe("the words of the cat companion", () => {
  for (const [language, dictionary] of [["ro", catRo], ["it", catIt]] as const) {
    it(`${language} has every English word, and nothing English does not know`, () => {
      expect(Object.keys(english).filter((key) => !(key in dictionary))).toEqual([]);
      expect(Object.keys(dictionary).filter((key) => !(key in english))).toEqual([]);
    });

    it(`${language} has no empty text, and the same placeholders as English`, () => {
      for (const [key, text] of Object.entries(dictionary)) {
        expect(text.trim(), key).not.toBe("");
        expect(placeholders(text), key).toEqual(placeholders(english[key] ?? ""));
      }
    });
  }

  it("are the website's own words: each is in its dictionary, in each language", () => {
    const own: Record<string, string> = en;
    for (const [language, words, dictionary] of [["en", catEn, own], ["ro", catRo, romanian], ["it", catIt, italian]] as const) {
      for (const [key, text] of Object.entries(words)) expect(dictionary[key], `${language} ${key}`).toBe(text);
    }
    // (a key twice would be the last one winning: the cat's file must not be quietly overriding a word of the website)
    const source = readFileSync(join(__dirname, "en.ts"), "utf8");
    for (const key of Object.keys(english)) expect(source.includes(`"${key}":`), `en.ts has its own ${key}`).toBe(false);
  });

  it("are all the words the cat's views ask for: every `t(\"...\")` of client/cat is a word of the website", () => {
    const asked = new Set<string>();
    const walk = (folder: string): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(folder, entry.name));
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          for (const match of readFileSync(join(folder, entry.name), "utf8").matchAll(/\bt\(\s*"([\w.]+)"/g)) asked.add(match[1]!);
        }
      }
    };
    walk(join(__dirname, "..", "cat"));
    expect(asked.size).toBeGreaterThan(10);
    expect([...asked].filter((key) => !hasKey(key))).toEqual([]);
  });

  it("has a word for every mood the cat can be asked for", () => {
    for (const mood of ["funny", "scary", "exciting", "romantic", "family", "scifi", "classic", "new", "any"]) expect(hasKey(`cat.mood.${mood}`), mood).toBe(true);
  });

  it("are said in the language asked, with names filled in", () => {
    expect(translate("en", "cat.pick", { title: "Up" })).toBe("How about “Up”?");
    expect(translate("ro", "cat.pickYear", { title: "Up", year: "2009" })).toBe("Ce zici de „Up” (2009)?");
    expect(translate("it", "cat.pickWhere", { shelf: "Commedia" })).toBe("Da «Commedia»");
  });
});
