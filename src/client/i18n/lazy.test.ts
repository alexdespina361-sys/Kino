import { describe, expect, it, vi } from "vitest";

describe("a language that is not English", () => {
  it("is downloaded when it is asked for, and the screen changes to it once its words are here", async () => {
    vi.resetModules();
    const i18n = await import("./index");
    await i18n.languageReady;
    expect(Object.keys(i18n.DICTIONARIES)).toEqual(["en"]);
    expect(i18n.getLanguage()).toBe("en");

    i18n.setLanguage("ro", false);
    expect(i18n.getLanguage()).toBe("en");
    expect(i18n.t("common.back")).toBe("Back");
    expect(await i18n.loadLanguage("ro")).toBe(true);
    await Promise.resolve();
    expect(i18n.getLanguage()).toBe("ro");
    expect(i18n.t("common.back")).toBe("Înapoi");

    i18n.setLanguage("en", false);
    expect(i18n.getLanguage()).toBe("en");
    i18n.setLanguage("ro", false);
    expect(i18n.getLanguage()).toBe("ro");
  });

  it("does not take the screen over when another language was chosen while it was on its way", async () => {
    vi.resetModules();
    const i18n = await import("./index");
    i18n.setLanguage("it", false);
    i18n.setLanguage("en", false);
    expect(await i18n.loadLanguage("it")).toBe(true);
    await Promise.resolve();
    expect(i18n.getLanguage()).toBe("en");
    i18n.setLanguage("it", false);
    expect(i18n.getLanguage()).toBe("it");
  });

  it("falls back to the English word for a language whose words are not here", async () => {
    vi.resetModules();
    const i18n = await import("./index");
    expect(i18n.translate("ro", "common.back")).toBe("Back");
    await i18n.loadLanguage("ro");
    expect(i18n.translate("ro", "common.back")).toBe("Înapoi");
  });
});
