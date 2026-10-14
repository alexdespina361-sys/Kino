import { describe, expect, it } from "vitest";
import type { PartyView } from "../../shared";
import { translate } from "../i18n";
import { holdLine, partyName, resumeLine, sameHold } from "./hold";

/** What a guest sees of a party of three: the host, itself (Sam, signed in as a profile), and another screen with no profile. */
const party: PartyView = {
  role: "guest",
  you: "guest-sam",
  host: { id: "host-tv", name: "TV 9E88", online: true },
  guests: [
    { id: "guest-sam", name: "TV BD6D", online: true, profile: { name: "Sam", avatar: "fox", tag: 2 } },
    { id: "guest-anna", name: "TV 1C2D", online: true, profile: { name: "Anna", avatar: "fox", tag: 1 }, admin: true },
    { id: "guest-bare", name: "TV 7F00", online: true },
  ],
};

/** The words, in English: `holdLine` and `resumeLine` take them as an argument, so that what is said can be looked at here. */
const say = ((key, params) => translate("en", key, params)) as Parameters<typeof holdLine>[3];

describe("partyName", () => {
  it("is the profile signed in on the screen, or else the screen's own name", () => {
    expect(partyName(party, "guest-anna")).toBe("Anna");
    expect(partyName(party, "guest-bare")).toBe("TV 7F00");
    expect(partyName(party, "host-tv")).toBe("TV 9E88");
  });

  it("is nobody for a screen that is not in the party (any more), or when there is no party or nobody to name", () => {
    expect(partyName(party, "gone")).toBeNull();
    expect(partyName(null, "guest-anna")).toBeNull();
    expect(partyName(party, null)).toBeNull();
    expect(partyName(party, undefined)).toBeNull();
  });
});

describe("holdLine", () => {
  it("says who paused it", () => {
    expect(holdLine({ by: "guest-anna", waiting: false }, party, null, say)).toBe("Paused by Anna");
    expect(holdLine({ by: "host-tv", waiting: false }, party, null, say)).toBe("Paused by TV 9E88");
  });

  it("says so when it was this screen's own pause (an admin's, which the host's screen did)", () => {
    expect(holdLine({ by: "guest-sam", waiting: false }, party, null, say)).toBe("Paused by you");
  });

  it("says who it waits for when the picture of the host only fills up", () => {
    expect(holdLine({ by: "host-tv", waiting: true }, party, null, say)).toBe("Waiting for TV 9E88");
  });

  it("names the screen that is followed when the wait is all there is to name (a screen added by a phone has no list of the party)", () => {
    expect(holdLine({ by: "somebody", waiting: true }, null, "Living room", say)).toBe("Waiting for Living room");
    expect(holdLine({ by: "somebody", waiting: true }, null, null, say)).toBeNull();
  });

  it("has nothing to say when nobody is to be named, or nothing is held", () => {
    expect(holdLine(null, party, "TV 9E88", say)).toBeNull();
    expect(holdLine({ by: null, waiting: false }, party, "TV 9E88", say)).toBeNull();
    expect(holdLine({ by: "gone", waiting: false }, party, "TV 9E88", say)).toBeNull(); // (a pause is nobody's but a person's: the card then says only "paused")
    expect(holdLine({ by: "host-tv", waiting: false }, null, "TV 9E88", say)).toBeNull();
  });
});

describe("resumeLine", () => {
  it("says who set it going again", () => {
    expect(resumeLine("guest-anna", party, say)).toBe("Anna resumed");
    expect(resumeLine("host-tv", party, say)).toBe("TV 9E88 resumed");
  });

  it("says nothing of this screen's own doing, nor of a screen it cannot name", () => {
    expect(resumeLine("guest-sam", party, say)).toBeNull();
    expect(resumeLine("gone", party, say)).toBeNull();
    expect(resumeLine(undefined, party, say)).toBeNull();
    expect(resumeLine("host-tv", null, say)).toBeNull();
  });
});

describe("sameHold", () => {
  it("is true for a hold that is the same, so that the report that comes every second does not draw it again", () => {
    expect(sameHold(null, null)).toBe(true);
    expect(sameHold({ by: "a", waiting: false }, { by: "a", waiting: false })).toBe(true);
  });

  it("is false when it is held by someone else, or has gone from a pause to a wait, or is not held any more", () => {
    expect(sameHold({ by: "a", waiting: false }, { by: "b", waiting: false })).toBe(false);
    expect(sameHold({ by: "a", waiting: false }, { by: "a", waiting: true })).toBe(false);
    expect(sameHold({ by: "a", waiting: false }, null)).toBe(false);
    expect(sameHold(null, { by: "a", waiting: false })).toBe(false);
  });
});
