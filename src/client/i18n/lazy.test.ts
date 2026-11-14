import { describe, expect, it, vi } from "vitest";

/*
 * English is in the page; Romanian and Italian are a file each, downloaded when one of them is the language asked for. The screen changes to a language
 * when its words are here and not before, so nobody reads half a page in English on the way.
 */
describe("a language that is not English", () => {
  it("is downloaded when it is asked for, and the screen changes to it once its words are here", async () => {
    vi.resetModules();
    const i18n = await import("./index");
    await i18n.languageReady;
    expect(Object.keys(i18n.DICTIONARIES)).toEqual(["en"]);
    expect(i18n.getLanguage()).toBe("en");

    i18n.setLanguage("ro", false);
    expect(i18n.getLanguage()).toBe("en"); // (not yet: its words are on their way)
    expect(i18n.t("common.back")).toBe("Back");
    expect(await i18n.loadLanguage("ro")).toBe(true);
    await Promise.resolve();
    expect(i18n.getLanguage()).toBe("ro");
    expect(i18n.t("common.back")).toBe("Înapoi");

    // Going back to a language that is here is at once.
    i18n.setLanguage("en", false);
    expect(i18n.getLanguage()).toBe("en");
    i18n.setLanguage("ro", false);
    expect(i18n.getLanguage()).toBe("ro");
  });

  it("does not take the screen over when another language was chosen while it was on its way", async () => {
    vi.resetModules();
    const i18n = await import("./index");
    i18n.setLanguage("it", false);
    i18n.setLanguage("en", false); // (changed their mind before Italian arrived)
    expect(await i18n.loadLanguage("it")).toBe(true);
    await Promise.resolve();
    expect(i18n.getLanguage()).toBe("en");
    i18n.setLanguage("it", false);
    expect(i18n.getLanguage()).toBe("it"); // (and it is here for the next time)
  });

  it("falls back to the English word for a language whose words are not here", async () => {
    vi.resetModules();
    const i18n = await import("./index");
    expect(i18n.translate("ro", "common.back")).toBe("Back");
    await i18n.loadLanguage("ro");
    expect(i18n.translate("ro", "common.back")).toBe("Înapoi");
  });
});
