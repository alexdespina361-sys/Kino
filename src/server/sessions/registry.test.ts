import { describe, expect, it } from "vitest";
import { Registry, generatePairingCode } from "./registry";

function setup(options: ConstructorParameters<typeof Registry>[0] = {}) {
  let time = 1_000_000;
  const registry = new Registry({ now: () => time, ...options });
  return { registry, advance: (ms: number) => (time += ms) };
}

describe("generatePairingCode", () => {
  it("is always exactly 6 digits", () => {
    for (let i = 0; i < 500; i++) expect(generatePairingCode()).toMatch(/^\d{6}$/);
  });

  it("zero-pads small numbers", () => {
    expect(generatePairingCode(() => 42)).toBe("000042");
  });

  it("is not constant", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePairingCode()));
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe("Registry: devices and codes", () => {
  it("creates a device with a pairing code on first hello", () => {
    const { registry } = setup();
    const device = registry.tvHello();
    const pairing = registry.ensureCode(device);
    expect(device.id).toMatch(/^tv_/);
    expect(pairing?.code).toMatch(/^\d{6}$/);
    expect(pairing?.expiresInMs).toBe(10 * 60 * 1000);
  });

  it("recognises a returning device id and keeps its code", () => {
    const { registry } = setup();
    const first = registry.tvHello();
    const code = registry.ensureCode(first)?.code;
    const again = registry.tvHello(first.id);
    expect(again).toBe(first);
    expect(registry.ensureCode(again)?.code).toBe(code);
  });

  it("creates a fresh device when the id is unknown (e.g. server restarted)", () => {
    const { registry } = setup();
    const device = registry.tvHello("tv_does_not_exist");
    expect(device.id).not.toBe("tv_does_not_exist");
  });

  it("keeps the same code until it expires, then issues a new one", () => {
    const { registry, advance } = setup({ generateCode: counter(["111111", "222222"]) });
    const device = registry.tvHello();
    expect(registry.ensureCode(device)?.code).toBe("111111");
    advance(9 * 60 * 1000);
    expect(registry.ensureCode(device)).toMatchObject({ code: "111111", expiresInMs: 60 * 1000 });
    advance(60 * 1000);
    expect(registry.ensureCode(device)?.code).toBe("222222");
  });

  it("never hands out the same live code to two devices", () => {
    const { registry } = setup({ generateCode: counter(["111111", "111111", "222222"]) });
    const a = registry.tvHello();
    const b = registry.tvHello();
    expect(registry.ensureCode(a)?.code).toBe("111111");
    expect(registry.ensureCode(b)?.code).toBe("222222");
  });
});

describe("Registry: pairing", () => {
  it("links controller and device, and consumes the code (single use)", () => {
    const { registry } = setup();
    const device = registry.tvHello();
    const code = registry.ensureCode(device)!.code;
    const controller = registry.controllerHello();

    expect(registry.pair(controller, code)).toBe(device);
    expect(device.controllerId).toBe(controller.id);
    expect(registry.deviceForController(controller)).toBe(device);

    expect(registry.pair(registry.controllerHello(), code)).toBeNull();
    expect(registry.ensureCode(device)).toBeNull(); // paired devices show no code
  });

  it("rejects wrong codes", () => {
    const { registry } = setup({ generateCode: () => "123456" });
    registry.ensureCode(registry.tvHello());
    expect(registry.pair(registry.controllerHello(), "654321")).toBeNull();
  });

  it("rejects an expired code", () => {
    const { registry, advance } = setup();
    const device = registry.tvHello();
    const code = registry.ensureCode(device)!.code;
    advance(10 * 60 * 1000 + 1);
    expect(registry.pair(registry.controllerHello(), code)).toBeNull();
  });

  it("remembers a controller by id so a reconnecting phone stays paired", () => {
    const { registry } = setup();
    const device = registry.tvHello();
    const controller = registry.controllerHello();
    registry.pair(controller, registry.ensureCode(device)!.code);

    const again = registry.controllerHello(controller.id);
    expect(again).toBe(controller);
    expect(registry.deviceForController(again)).toBe(device);
  });

  it("gives an unknown controller id a fresh, unpaired identity", () => {
    const { registry } = setup();
    const controller = registry.controllerHello("ctl_gone");
    expect(controller.id).not.toBe("ctl_gone");
    expect(registry.deviceForController(controller)).toBeUndefined();
  });
});

describe("Registry: unpair", () => {
  it("frees the TV: it is unpaired, idle, and can be given a fresh code", () => {
    const { registry } = setup({ generateCode: counter(["111111", "222222"]) });
    const device = registry.tvHello();
    const controller = registry.controllerHello();
    expect(registry.ensureCode(device)?.code).toBe("111111");
    registry.pair(controller, "111111");
    device.media = { stream: { url: "/x.mp4", type: "mp4" } };

    expect(registry.unpair(controller)).toBe(device);
    expect(controller.deviceId).toBeNull();
    expect(device.controllerId).toBeNull();
    expect(device.media).toBeNull();
    expect(device.state.state).toBe("idle");
    expect(registry.ensureCode(device)?.code).toBe("222222");
    expect(registry.pair(registry.controllerHello(), "111111")).toBeNull(); // the old code died with the pairing
  });

  it("does nothing for a controller that has no TV", () => {
    const { registry } = setup();
    expect(registry.unpair(registry.controllerHello())).toBeNull();
  });

  it("lets the TV end the pairing from its side: same result, and the phone is the one returned", () => {
    const { registry } = setup({ generateCode: counter(["111111", "222222"]) });
    const device = registry.tvHello();
    const controller = registry.controllerHello();
    registry.ensureCode(device);
    registry.pair(controller, "111111");
    device.media = { stream: { url: "/x.mp4", type: "mp4" } };

    expect(registry.unpairDevice(device)).toBe(controller);
    expect(controller.deviceId).toBeNull();
    expect(device.controllerId).toBeNull();
    expect(device.media).toBeNull();
    expect(registry.ensureCode(device)?.code).toBe("222222");
    expect(registry.unpairDevice(device)).toBeNull(); // nothing left to let go of
  });
});

describe("Registry: watching together", () => {
  /** A phone paired to a leader TV, and a second TV waiting with its own code. */
  function party() {
    const { registry } = setup({ generateCode: counter(["111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888"]) });
    const leader = registry.tvHello();
    const controller = registry.controllerHello();
    registry.ensureCode(leader);
    registry.pair(controller, "111111");
    const join = () => {
      const tv = registry.tvHello();
      const code = registry.ensureCode(tv)!.code;
      return { tv, code, result: registry.addFollower(controller, code) };
    };
    return { registry, leader, controller, join };
  }

  it("makes a TV watch along when its code is given to the phone that controls the leader", () => {
    const { registry, leader, join } = party();
    const { tv, result } = join();
    expect(result).toEqual({ ok: true, leader, follower: tv });
    expect(tv.leaderId).toBe(leader.id);
    expect(leader.followerIds).toEqual([tv.id]);
    expect(registry.followersOf(leader)).toEqual([tv]);
    expect(registry.leaderOf(tv)).toBe(leader);
    expect(registry.ensureCode(tv)).toBeNull(); // it has a party now, so it shows no pairing code
  });

  it("burns the code it used", () => {
    const { registry, join } = party();
    const { code } = join();
    expect(registry.pair(registry.controllerHello(), code)).toBeNull();
  });

  it("needs a phone with a TV, a right code, and room in the party", () => {
    const { registry, controller, join } = party();
    expect(registry.addFollower(registry.controllerHello(), "999999")).toEqual({ ok: false, reason: "NOT_PAIRED" });
    expect(registry.addFollower(controller, "000000")).toEqual({ ok: false, reason: "INVALID_CODE" });
    for (let i = 0; i < 5; i++) expect(join().result.ok).toBe(true);
    expect(join().result).toEqual({ ok: false, reason: "PARTY_FULL" });
  });

  it("lets the phone send a TV away by its public id, which is not the TV's secret", () => {
    const { registry, leader, controller, join } = party();
    const { tv } = join();
    expect(tv.publicId).not.toContain(tv.id);
    expect(registry.removeFollower(controller, "nobody")).toBeNull();
    expect(registry.removeFollower(controller, tv.publicId)).toEqual({ leader, follower: tv });
    expect(leader.followerIds).toEqual([]);
    expect(tv.leaderId).toBeNull();
    expect(registry.ensureCode(tv)?.code).toMatch(/^\d{6}$/); // free again, with a code of its own
  });

  it("lets a TV leave the party from its side, and leaves the others be", () => {
    const { registry, leader, join } = party();
    const first = join().tv;
    const second = join().tv;
    expect(registry.unpairDevice(first)).toBeNull();
    expect(leader.followerIds).toEqual([second.id]);
    expect(first.leaderId).toBeNull();
  });

  it("ends the party when the phone lets go of the leader, or the leader of the phone", () => {
    const one = party();
    const a = one.join().tv;
    const b = one.join().tv;
    one.registry.unpair(one.controller);
    expect([a.leaderId, b.leaderId, one.leader.followerIds]).toEqual([null, null, []]);

    const two = party();
    const c = two.join().tv;
    two.registry.unpairDevice(two.leader);
    expect(c.leaderId).toBeNull();
    expect(two.leader.followerIds).toEqual([]);
  });
});

function counter(values: string[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}
