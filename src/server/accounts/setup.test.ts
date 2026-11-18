import { describe, expect, it } from "vitest";
import { isWanted, ProfilePatchSchema, ProfileSchema, resolveSettings, wantedSections } from "../../shared";
import { MemoryPersistence } from "./persistence";
import { AccountStore } from "./store";

const open = (persistence = new MemoryPersistence(), askSetup = true) => AccountStore.open({ persistence, flushMs: 0, askSetup });

describe("a profile that is still to be set up", () => {
  it("is the first profile of a new account (all of it) and one that is added (what is left), until it says it was", async () => {
    const store = await open();
    const made = store.createAccount("sam@kino.test", "hash");
    if (!made.ok) throw new Error("no account");
    const [first] = store.profilesOf(made.value.id);
    expect(first!.setup).toBe("all");
    const added = store.addProfile(made.value.id, "Ana", "owl");
    expect(added.ok && added.value.setup).toBe("more");

    // (a change of name or picture leaves it to be set up: the pages after that one are still to come)
    const renamed = store.updateProfile(made.value.id, first!.id, { name: "Sam" });
    expect(renamed.ok && renamed.value.setup).toBe("all");
    const done = store.updateProfile(made.value.id, first!.id, { setup: "done" });
    expect(done.ok && done.value).not.toHaveProperty("setup");
    expect(store.profilesOf(made.value.id).map((profile) => profile.setup)).toEqual([undefined, "more"]);
  });

  it("is kept across a restart, and is nobody else's to know", async () => {
    const persistence = new MemoryPersistence();
    const store = await open(persistence);
    const made = store.createAccount("sam@kino.test", "hash");
    if (!made.ok) throw new Error("no account");
    const [first] = store.profilesOf(made.value.id);
    await store.close();
    const again = await open(persistence);
    expect(again.profilesOf(made.value.id)[0]!.setup).toBe("all");
    // (what a friend is told of a profile has no such thing)
    const card = again.profileCard(first!.id);
    expect(card?.id).toBe(first!.id);
    expect(card).not.toHaveProperty("setup");
  });

  it("is none where the host does not ask (and for the accounts the tests make)", async () => {
    const store = await open(new MemoryPersistence(), false);
    const made = store.createAccount("sam@kino.test", "hash");
    if (!made.ok) throw new Error("no account");
    expect(store.profilesOf(made.value.id)[0]).not.toHaveProperty("setup");
    const added = store.addProfile(made.value.id, "Ana", "owl");
    expect(added.ok && added.value).not.toHaveProperty("setup");
  });

  it("is said done only that way, and a screen that does not know the word reads the profile as set up", () => {
    expect(ProfilePatchSchema.safeParse({ setup: "done" }).success).toBe(true);
    expect(ProfilePatchSchema.safeParse({ setup: "all" }).success).toBe(false);
    expect(ProfileSchema.parse({ id: "p1", name: "Sam", avatar: "fox", setup: "something-new" }).setup).toBeUndefined();
  });
});

describe("the sections a profile watches", () => {
  it("are all of them unless it chose some", () => {
    expect(wantedSections({})).toBeNull();
    expect(wantedSections({ sections: [] })).toBeNull();
    expect(wantedSections({ sections: ["movie", "series", "cartoon", "anime"] })).toBeNull();
    expect([...wantedSections({ sections: ["movie", "anime"] })!]).toEqual(["movie", "anime"]);
  });

  it("leave out a title or a row of another section, and never one that says none", () => {
    const wanted = wantedSections({ sections: ["movie"] });
    expect(isWanted(wanted, { kind: "movie" })).toBe(true);
    expect(isWanted(wanted, { kind: "series" })).toBe(false);
    expect(isWanted(wanted, { kind: "movie", section: "cartoon" })).toBe(false);
    expect(isWanted(wanted, {})).toBe(true);
    expect(isWanted(null, { kind: "series" })).toBe(true);
  });

  it("are a setting of the profile: one to four of them", () => {
    const at = 1;
    expect(resolveSettings([{ key: "sections", at, value: ["movie", "series"] }]).sections).toEqual(["movie", "series"]);
    expect(resolveSettings([{ key: "sections", at, value: [] }]).sections).toBeUndefined();
    expect(resolveSettings([{ key: "sections", at, value: ["films"] }]).sections).toBeUndefined();
  });
});
