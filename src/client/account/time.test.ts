import { describe, expect, it } from "vitest";
import { ago } from "./time";

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

describe("ago", () => {
  it("says now for the last moments, then minutes, hours and days", () => {
    expect(ago(NOW - 5_000, NOW, "en")).toBe("now");
    expect(ago(NOW - 5 * 60_000, NOW, "en")).toBe("5 minutes ago");
    expect(ago(NOW - 3 * 3_600_000, NOW, "en")).toBe("3 hours ago");
    expect(ago(NOW - 86_400_000, NOW, "en")).toBe("yesterday");
    expect(ago(NOW - 5 * 86_400_000, NOW, "en")).toBe("5 days ago");
  });

  it("speaks the language of the site", () => {
    expect(ago(NOW - 5 * 60_000, NOW, "ro")).toBe("acum 5 minute");
    expect(ago(NOW - 5 * 60_000, NOW, "it")).toBe("5 minuti fa");
  });

  it("falls back to English for a language it does not know", () => {
    expect(ago(NOW - 5 * 60_000, NOW, "not a language!")).toBe("5 minutes ago");
  });
});
