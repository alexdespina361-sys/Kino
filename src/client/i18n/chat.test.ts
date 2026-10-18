import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { hasKey, translate } from "./index";
import { it as italian } from "./it";
import { ro as romanian } from "./ro";
import { chatEn } from "./chat.en";
import { chatIt } from "./chat.it";
import { chatRo } from "./chat.ro";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
const baseOf = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");
const english: Record<string, string> = chatEn;

describe("the words of the chat", () => {
  for (const [language, dictionary] of [["ro", chatRo], ["it", chatIt]] as const) {
    it(`${language} has every English word, and nothing English does not know`, () => {
      const bases = new Set(Object.keys(english).map(baseOf));
      expect(Object.keys(english).filter((key) => !(key in dictionary))).toEqual([]);
      expect(Object.keys(dictionary).filter((key) => !bases.has(baseOf(key)))).toEqual([]);
    });

    it(`${language} has no empty text, and the same placeholders as English`, () => {
      for (const [key, text] of Object.entries(dictionary)) {
        expect(text.trim(), key).not.toBe("");
        const original = english[key] ?? english[`${baseOf(key)}_other`] ?? "";
        expect(placeholders(text), key).toEqual(placeholders(original));
      }
    });

    it(`${language} has the forms of a count that its language needs`, () => {
      const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories.filter((form) => form !== "many");
      const counted = new Set(Object.keys(english).filter((key) => /_(one|other)$/.test(key)).map(baseOf));
      for (const base of counted) for (const form of forms) expect(`${base}_${form}` in dictionary || `${base}_other` in dictionary, `${language} ${base} ${form}`).toBe(true);
      if (language === "ro") for (const base of counted) expect(`${base}_few` in chatRo, `ro ${base} few`).toBe(true);
    });
  }

  it("are the website's own words: each is in its dictionary, in each language, as the chat's file has it (and none is a key the website had)", () => {
    const own: Record<string, string> = en;
    for (const [language, words, dictionary] of [["en", chatEn, own], ["ro", chatRo, romanian], ["it", chatIt, italian]] as const) {
      for (const [key, text] of Object.entries(words)) expect(dictionary[key], `${language} ${key}`).toBe(text);
    }
    // (a key twice in the spread would be the last one winning: the chat's file must not be quietly overriding a word of the website)
    const source = readFileSync(join(__dirname, "en.ts"), "utf8");
    for (const key of Object.keys(english)) expect(source.includes(`"${key}":`), `en.ts has its own ${key}`).toBe(false);
  });

  it("are all the words the views ask for: every `t(\"...\")` of client/chat is a word of the website", () => {
    const folder = join(__dirname, "..", "chat");
    const asked = new Set<string>();
    for (const file of readdirSync(folder).filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name))) {
      for (const match of readFileSync(join(folder, file), "utf8").matchAll(/\bt\(\s*"([\w.]+)"/g)) asked.add(match[1]!);
    }
    expect(asked.size).toBeGreaterThan(20);
    const unknown = [...asked].filter((key) => !hasKey(key));
    expect(unknown).toEqual([]);
  });

  it("are said in the language asked, with counts and names filled in", () => {
    expect(translate("en", "chat.title", { name: "Sam" })).toBe("Chat with Sam");
    expect(translate("ro", "chat.title", { name: "Sam" })).toBe("Chat cu Sam");
    expect(translate("en", "chat.unread", { count: 1, name: "Sam" })).toBe("1 new message from Sam");
    expect(translate("en", "chat.unread", { count: 2, name: "Sam" })).toBe("2 new messages from Sam");
    expect(translate("ro", "chat.unread", { count: 1, name: "Sam" })).toBe("1 mesaj nou de la Sam");
    expect(translate("ro", "chat.unread", { count: 3, name: "Sam" })).toBe("3 mesaje noi de la Sam");
    expect(translate("ro", "chat.unread", { count: 20, name: "Sam" })).toBe("20 de mesaje noi de la Sam");
    expect(translate("it", "chat.unread", { count: 2, name: "Sam" })).toBe("2 nuovi messaggi da Sam");
  });

  it("sit beside the website's other words, which the chat uses too", () => {
    expect(translate("en", "common.close")).toBe("Close");
    expect(translate("ro", "common.close")).toBe("Închide");
    expect(translate("en", "error.offline")).toBe("Can't reach the server. Check your connection.");
  });

  it("say the limits from the server's own numbers", () => {
    expect(translate("en", "chat.privacy", { messages: 200, days: 30 })).toContain("200 messages");
    expect(translate("en", "chat.privacy", { messages: 200, days: 30 })).toContain("30 days");
    expect(translate("en", "chat.privacy", { messages: 200, days: 30 })).toContain("without encryption");
    expect(translate("ro", "chat.privacy", { messages: 200, days: 30 })).toContain("30 de zile");
  });
});
