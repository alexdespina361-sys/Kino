import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "./persistence";
import { ScreenProofs, screenProfiles } from "./screens";
import { AccountStore } from "./store";

describe("proofs of whose a screen is", () => {
  it("name the profile they were made for, once: a second use, and a made-up one, find nobody", () => {
    const proofs = new ScreenProofs(() => 1_000);
    const proof = proofs.issue("pro_a");
    expect(proof).toMatch(/^[\w-]{20,}$/);
    expect(proofs.issue("pro_a")).not.toBe(proof);
    expect(proofs.redeem(proof)).toBe("pro_a");
    expect(proofs.redeem(proof)).toBeUndefined();
    expect(proofs.redeem("made-up")).toBeUndefined();
  });

  it("are good for two minutes and no longer", () => {
    const clock = { now: 1_000 };
    const proofs = new ScreenProofs(() => clock.now);
    const late = proofs.issue("pro_a");
    const fine = proofs.issue("pro_b");
    clock.now += 2 * 60_000 - 1;
    expect(proofs.redeem(fine)).toBe("pro_b");
    clock.now += 1;
    expect(proofs.redeem(late)).toBeUndefined();
  });

  it("are not kept without end: when a great many are out, the oldest go first", () => {
    const proofs = new ScreenProofs(() => 1_000);
    const first = proofs.issue("pro_0");
    for (let i = 1; i < 2000; i++) proofs.issue(`pro_${i}`);
    const last = proofs.issue("pro_last");
    expect(proofs.redeem(first)).toBeUndefined();
    expect(proofs.redeem(last)).toBe("pro_last");
  });
});

describe("how a watch party shows the profile of a screen", () => {
  const clock = { now: Date.parse("2026-10-13T12:00:00Z") };
  async function sam() {
    const store = await AccountStore.open({ persistence: new MemoryPersistence(), now: () => clock.now, flushMs: 0 });
    const created = store.createAccount("sam", "hash");
    if (!created.ok) throw new Error("could not create");
    const profile = store.profilesOf(created.value.id)[0]!;
    const proofs = new ScreenProofs(() => clock.now);
    const choose = (friends: boolean) => store.sync(profile.id, { since: 0, settings: [{ key: "friends", at: (clock.now += 1000), value: friends }] });
    return { store, account: created.value, profile, proofs, shown: screenProfiles(store, proofs), choose };
  }

  it("is the name, the picture and the tag of a profile that has friends turned on, and nobody when it has not, or is gone", async () => {
    const { store, account, profile, shown, choose } = await sam();
    expect(shown.card(profile.id)).toBeUndefined(); // (friends are off until they are turned on)
    choose(true);
    expect(shown.card(profile.id)).toEqual({ name: "Sam", avatar: "fox", tag: 1 });
    choose(false);
    expect(shown.card(profile.id)).toBeUndefined();
    choose(true);
    expect(shown.card("pro_nobody")).toBeUndefined();
    store.deleteAccount(account.id);
    expect(shown.card(profile.id)).toBeUndefined();
  });

  it("knows a proof by the proofs the accounts gave", async () => {
    const { profile, proofs, shown } = await sam();
    const proof = proofs.issue(profile.id);
    expect(shown.redeem(proof)).toBe(profile.id);
    expect(shown.redeem(proof)).toBeUndefined();
  });
});
