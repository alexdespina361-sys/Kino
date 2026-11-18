import { describe, expect, it } from "vitest";
import { FriendsStateSchema, MeSchema, NewProfileSchema, PartyProfileSchema, PersonSchema } from "./index";

/**
 * A screen whose page was loaded before a release is told of things that release added (a new picture, a new kind of item in the inbox): it shows
 * what it can of them rather than refuse the whole answer - which signed it out, or emptied its Friends page, until it was reloaded.
 */
describe("a screen older than the server", () => {
  it("shows a picture it does not know as the first one, for its own profiles, a friend and somebody in a party", () => {
    const me = MeSchema.safeParse({ account: { id: "a1", email: "sam" }, profiles: [{ id: "p1", name: "Sam", avatar: "popcorn-of-tomorrow" }] });
    expect(me.success && me.data.profiles[0]!.avatar).toBe("fox");
    expect(PersonSchema.parse({ id: "p2", name: "Ana", avatar: "something-new", tag: 1234 }).avatar).toBe("fox");
    expect(PartyProfileSchema.parse({ name: "Ana", avatar: "something-new", tag: 1234 }).avatar).toBe("fox");
    expect(PersonSchema.parse({ id: "p2", name: "Ana", avatar: "owl", tag: 1234 }).avatar).toBe("owl");
  });

  it("still asks only for a picture there is", () => {
    expect(NewProfileSchema.safeParse({ name: "Sam", avatar: "something-new" }).success).toBe(false);
    expect(NewProfileSchema.safeParse({ name: "Sam", avatar: "owl" }).success).toBe(true);
  });

  it("leaves out an item of the inbox of a kind it does not know, and keeps the others", () => {
    const state = FriendsStateSchema.safeParse({
      friends: [],
      inbox: [
        { kind: "episode-of-tomorrow", id: "i1", at: 1, read: false, title: "X" },
        { kind: "together", id: "i2", at: 2, from: "p2", read: false },
      ],
      activity: [],
      invites: [],
      requests: [],
      sent: [],
    });
    expect(state.success && state.data.inbox.map((item) => item.id)).toEqual(["i2"]);
  });
});
