import { describe, expect, it } from "vitest";
import { MAX_PHONE_TVS } from "../../shared";
import { KEEP_RESUME_DAYS, MAX_PHONES_PER_TV, Registry, cleanLabel, generatePairingCode } from "./registry";

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

  it("looks a phone up by its id, and has none for an id it never gave", () => {
    const { registry } = setup();
    const controller = registry.controllerHello();
    expect(registry.getController(controller.id)).toBe(controller);
    expect(registry.getController("ctl_gone")).toBeUndefined();
    expect(registry.getController("ctl_gone")).toBeUndefined(); // (asking makes none)
  });
});

describe("Registry: a second phone", () => {
  /** A TV with one phone connected. */
  function paired() {
    const { registry, advance } = setup({ generateCode: counter(["111111", "222222", "333333"]) });
    const device = registry.tvHello();
    const first = registry.controllerHello();
    registry.ensureCode(device);
    registry.pair(first, "111111");
    return { registry, advance, device, first };
  }

  it("joins with the control code of the TV, and both phones are controllers of it", () => {
    const { registry, device, first } = paired();
    const code = registry.ensureControlCode(device).code;
    const second = registry.controllerHello();
    expect(registry.joinController(second, code)).toBe(device);
    expect(registry.deviceForController(second)).toBe(device);
    expect(registry.controllersOf(device)).toEqual([first, second]);
  });

  it("keeps the control code good for as long as a phone keeps asking for it, and not a minute after that", () => {
    const { registry, advance, device } = paired();
    const code = registry.ensureControlCode(device).code;
    for (let i = 0; i < 3; i++) {
      advance(9 * 60 * 1000);
      expect(registry.ensureControlCode(device)).toEqual({ code, expiresInMs: 10 * 60 * 1000 });
    }
    advance(10 * 60 * 1000 + 1);
    expect(registry.joinController(registry.controllerHello(), code)).toBeNull();
    expect(registry.ensureControlCode(device).code).not.toBe(code);
  });

  it("lets either phone bring another TV into the party, not only the first", () => {
    const { registry, device, first } = paired();
    const second = registry.controllerHello();
    registry.joinController(second, registry.ensureControlCode(device).code);
    const guest = registry.tvHello();
    const result = registry.addFollower(second, registry.ensureCode(guest)!.code);
    expect(result).toEqual({ ok: true, leader: device, follower: guest });
    expect(registry.removeFollower(first, guest.publicId)).toEqual({ leader: device, follower: guest });
  });

  describe("when the TV has all the phones it can keep", () => {
    /** A TV with `MAX_PHONES_PER_TV` phones, the first one included, and the control code they joined with. */
    function crowded() {
      const { registry, advance, device, first } = paired();
      const code = registry.ensureControlCode(device).code;
      const joined = Array.from({ length: MAX_PHONES_PER_TV - 1 }, () => {
        const phone = registry.controllerHello();
        expect(registry.joinController(phone, code)).toBe(device);
        return phone;
      });
      return { registry, advance, device, code, phones: [first, ...joined] };
    }

    const DAY = 24 * 3600 * 1000;

    it("turns away one more when every one of them is connected, and changes nothing", () => {
      const { registry, device, code, phones } = crowded();
      expect(device.controllerIds).toHaveLength(MAX_PHONES_PER_TV);
      const late = registry.controllerHello();
      expect(registry.isFullControlCode(late, code)).toBe(true);
      expect(registry.joinController(late, code, () => true)).toBeNull();
      expect(registry.joinController(late, code)).toBeNull(); // (no word of who is connected: nobody is let go)
      expect(device.controllerIds).toEqual(phones.map((phone) => phone.id));
      expect(device.controllerIds).not.toContain(late.id);
      expect(late.deviceId).toBeNull();
      expect(late.deviceIds).toEqual([]);
    });

    it("lets one more in by letting go of the phone seen least recently, and of no other", () => {
      const { registry, advance, device, phones } = crowded();
      advance(3 * DAY);
      phones.forEach((phone, n) => n !== 6 && registry.markSeen(phone.id)); // (all but the seventh came by since)
      const late = registry.controllerHello();
      const code = registry.ensureControlCode(device).code; // (the code they joined with ran out)
      expect(registry.joinController(late, code, () => false)).toBe(device);
      expect(device.controllerIds).toEqual([...phones.filter((_, n) => n !== 6).map((phone) => phone.id), late.id]);
      expect(device.controllerId).toBe(phones[0]!.id);
      expect(late.deviceId).toBe(device.id);
      // The one let go is no longer a remote of this TV and pairs again with a code, as a phone that was never here.
      expect(phones[6]!.deviceId).toBeNull();
      expect(phones[6]!.deviceIds).toEqual([]);
      expect(registry.deviceForController(phones[6]!)).toBeUndefined();
    });

    it("lets go of a phone only as a remote of this TV: the other TVs of its list stay", () => {
      const { registry, advance, device, phones } = crowded();
      const other = registry.tvHello();
      registry.pair(phones[6]!, registry.ensureCode(other)!.code); // (the seventh moved on to another TV, and is not seen again)
      advance(DAY);
      phones.forEach((phone, n) => n !== 6 && registry.markSeen(phone.id));
      expect(registry.joinController(registry.controllerHello(), registry.ensureControlCode(device).code, () => false)).toBe(device);
      expect(device.controllerIds).not.toContain(phones[6]!.id);
      expect(phones[6]!.deviceIds).toEqual([other.id]);
      expect(phones[6]!.deviceId).toBe(other.id);
      expect(other.controllerIds).toEqual([phones[6]!.id]);
    });

    it("lets go of the one that joined first when they were all last seen on the same day, and the TV stays paired", () => {
      const { registry, device, code, phones } = crowded();
      const late = registry.controllerHello();
      expect(registry.joinController(late, code, () => false)).toBe(device);
      expect(device.controllerIds).toEqual([...phones.slice(1).map((phone) => phone.id), late.id]);
      expect(device.controllerId).toBe(phones[1]!.id); // (the first phone was the one the TV went with: the next takes its place)
      expect(registry.ensureCode(device)).toBeNull(); // (still paired: it shows no pairing code)
    });

    it("never lets go of a phone that is connected, however long ago it was seen", () => {
      const { registry, advance, device, phones } = crowded();
      advance(2 * DAY);
      registry.markSeen(phones[31]!.id); // (the only one that is not connected is the one seen most recently)
      const late = registry.controllerHello();
      const connected = (id: string) => id !== phones[31]!.id;
      expect(registry.joinController(late, registry.ensureControlCode(device).code, connected)).toBe(device);
      expect(device.controllerIds).toEqual([...phones.slice(0, 31).map((phone) => phone.id), late.id]);
    });

    it("lets go of nobody for a phone that is one of them already", () => {
      const { registry, device, code, phones } = crowded();
      const [away] = phones;
      const other = registry.tvHello();
      registry.pair(away!, registry.ensureCode(other)!.code);
      expect(away!.deviceId).toBe(other.id);
      expect(registry.isFullControlCode(away!, code)).toBe(false);
      expect(registry.joinController(away!, code, () => false)).toBe(device);
      expect(away!.deviceId).toBe(device.id);
      expect(device.controllerIds).toEqual(phones.map((phone) => phone.id)); // (not listed twice, and none was let go)
    });

    it("has room again for the next phone when one lets go of the TV", () => {
      const { registry, device, code, phones } = crowded();
      const late = registry.controllerHello();
      expect(registry.joinController(late, code)).toBeNull();
      registry.unpair(phones[1]!, device.publicId);
      expect(registry.isFullControlCode(late, code)).toBe(false);
      expect(registry.joinController(late, code)).toBe(device);
      expect(device.controllerIds).toHaveLength(MAX_PHONES_PER_TV);
    });

    it("does not take a wrong code, or one that ran out, for the code of a full TV", () => {
      const { registry, advance, code } = crowded();
      const late = registry.controllerHello();
      expect(registry.isFullControlCode(late, "000000")).toBe(false);
      advance(10 * 60 * 1000 + 1);
      expect(registry.isFullControlCode(late, code)).toBe(false);
      expect(registry.joinController(late, code)).toBeNull();
    });
  });

  it("keeps a TV with a few phones open to more of them", () => {
    const { registry, device } = paired();
    const code = registry.ensureControlCode(device).code;
    const second = registry.controllerHello();
    expect(registry.isFullControlCode(second, code)).toBe(false);
    expect(registry.joinController(second, code, () => false)).toBe(device); // (room enough: nobody is let go, connected or not)
    expect(device.controllerIds).toHaveLength(2);
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

describe("Registry: a phone with several TVs", () => {
  /** A phone that has connected to `count` TVs one after the other: the last is the one it controls. */
  function withTvs(count = 2) {
    const { registry, advance } = setup();
    const phone = registry.controllerHello();
    const tvs = Array.from({ length: count }, () => {
      const tv = registry.tvHello();
      registry.pair(phone, registry.ensureCode(tv)!.code);
      return tv;
    });
    return { registry, advance, phone, tvs };
  }
  const stranger = (registry: Registry) => {
    const tv = registry.tvHello();
    registry.pair(registry.controllerHello(), registry.ensureCode(tv)!.code);
    return tv;
  };

  it("keeps the TV it moves on from: still paired, showing no code, and on the phone's list", () => {
    const {
      registry,
      phone,
      tvs: [first, second],
    } = withTvs();
    expect(phone.deviceId).toBe(second!.id);
    expect(registry.tvsOf(phone)).toEqual([first, second]);
    expect(first!.controllerId).toBe(phone.id);
    expect(registry.ensureCode(first!)).toBeNull();
    expect(registry.controllersOf(first!)).toEqual([]); // nobody is controlling it now ...
    expect(registry.phonesOf(first!)).toEqual([phone]); // ... but it is still this phone's
  });

  it("goes back to a TV of the list by the id the list gave it, and to no other", () => {
    const {
      registry,
      phone,
      tvs: [first, second],
    } = withTvs();
    expect(registry.switchTo(phone, first!.publicId)).toBe(first);
    expect(phone.deviceId).toBe(first!.id);
    expect(registry.controllersOf(first!)).toEqual([phone]);
    expect(registry.controllersOf(second!)).toEqual([]);
    expect(registry.tvsOf(phone)).toEqual([first, second]); // the order of the list is the order they were connected in, whichever is in use

    expect(registry.switchTo(phone, stranger(registry).publicId)).toBeNull(); // someone else's TV
    expect(registry.switchTo(phone, "nothing")).toBeNull();
    expect(phone.deviceId).toBe(first!.id);
  });

  it("lets go of one TV of the list, which is then free, and keeps the others", () => {
    const {
      registry,
      phone,
      tvs: [first, second],
    } = withTvs();
    first!.media = { stream: { url: "/x.mp4", type: "mp4" } };
    expect(registry.unpair(phone, first!.publicId)).toBe(first);
    expect(first!.media).toBeNull();
    expect(first!.controllerIds).toEqual([]);
    expect(registry.ensureCode(first!)).not.toBeNull(); // it asks for a pairing again
    expect(registry.tvsOf(phone)).toEqual([second]);
    expect(phone.deviceId).toBe(second!.id); // the one it controls is not the one it forgot
  });

  it("lets go of the TV it controls, and the list keeps the rest", () => {
    const {
      registry,
      phone,
      tvs: [first, second],
    } = withTvs();
    expect(registry.unpair(phone)).toBe(second);
    expect(phone.deviceId).toBeNull();
    expect(registry.tvsOf(phone)).toEqual([first]);
    expect(registry.ensureCode(first!)).toBeNull(); // (still paired: it was not forgotten)
    expect(registry.switchTo(phone, first!.publicId)).toBe(first);
  });

  it("does not free a TV that another phone still has", () => {
    const { registry, phone, tvs } = withTvs();
    const [first] = tvs;
    const other = registry.controllerHello();
    registry.joinController(other, registry.ensureControlCode(first!).code);
    expect(registry.unpair(phone, first!.publicId)).toBeNull();
    expect(first!.controllerIds).toEqual([other.id]);
    expect(first!.controllerId).toBe(other.id);
    expect(registry.ensureCode(first!)).toBeNull();
  });

  it("lets the TV take itself off every list, the phones that had moved on included", () => {
    const {
      registry,
      phone,
      tvs: [first, second],
    } = withTvs();
    registry.unpairDevice(first!);
    expect(registry.tvsOf(phone)).toEqual([second]);
    expect(phone.deviceId).toBe(second!.id); // it was not the one in use
    registry.unpairDevice(second!);
    expect(registry.tvsOf(phone)).toEqual([]);
    expect(phone.deviceId).toBeNull();
  });

  it("counts a list as full at the limit", () => {
    const { registry, phone } = withTvs(MAX_PHONE_TVS - 1);
    expect(registry.isFull(phone)).toBe(false);
    const last = registry.tvHello();
    registry.pair(phone, registry.ensureCode(last)!.code);
    expect(registry.isFull(phone)).toBe(true);
    registry.unpair(phone, last.publicId);
    expect(registry.isFull(phone)).toBe(false);
  });

  it("names a TV, cleaned up like a name on any list, and gives it its own name back for an empty one", () => {
    const { registry, tvs } = withTvs(1);
    const tv = tvs[0]!;
    const own = tv.name;
    expect(own).toMatch(/^TV [0-9A-F]{4}$/);
    registry.rename(tv, "  Living\u0000   room ");
    expect(tv.name).toBe("Living room");
    expect(registry.displayName(tv)).toBe("Living room");
    registry.rename(tv, "   ");
    expect(tv.name).toBe(own);
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

  it("leaves a TV that hosts guests of its own alone, with its code still good; one whose party is empty is taken along without it", () => {
    const { registry, controller } = party();
    const host = registry.tvHello();
    const pairingCode = registry.ensureCode(host)!.code;
    const partyCode = registry.ensurePartyCode(host)!.code;
    const guest = registry.tvHello();
    registry.joinParty(guest, partyCode);
    expect(registry.addFollower(controller, pairingCode)).toEqual({ ok: false, reason: "TV_HOSTING" });
    expect([host.leaderId, host.code?.value, guest.leaderId]).toEqual([null, pairingCode, host.id]); // nothing moved, nothing burnt
    registry.closeParty(host);
    expect(registry.addFollower(controller, pairingCode).ok).toBe(true); // the same code works once that party is over

    const lonely = registry.tvHello(); // a party was opened here but nobody came: it is left for this one
    const lonelyPairing = registry.ensureCode(lonely)!.code;
    const lonelyParty = registry.ensurePartyCode(lonely)!.code;
    expect(registry.addFollower(controller, lonelyPairing).ok).toBe(true);
    expect(registry.partyCodeOf(lonely)).toBeNull();
    expect(registry.joinParty(registry.tvHello(), lonelyParty)).toEqual({ ok: false, reason: "INVALID_CODE" }); // no party hangs off a guest
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

describe("Registry: a party started on a TV", () => {
  const codes = ["111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999"];
  /** A TV that has opened a party (no phone anywhere), and a way to bring more TVs. */
  function hosted() {
    const { registry, advance } = setup({ generateCode: counter(codes) });
    const host = registry.tvHello();
    const opened = registry.ensurePartyCode(host)!;
    return { registry, advance, host, code: opened.code, arrive: () => registry.tvHello() };
  }

  it("gives the host a code that stays the same until it runs out, and a guest no party of its own", () => {
    const { registry, advance, host, code } = hosted();
    expect(code).toBe("111111");
    expect(registry.partyCodeOf(host)).toMatchObject({ code, expiresInMs: 10 * 60 * 1000 });
    expect(registry.ensurePartyCode(host)?.code).toBe(code);
    advance(10 * 60 * 1000);
    expect(registry.partyCodeOf(host)).toBeNull();
    expect(registry.inParty(host)).toBe(false);
    expect(registry.ensurePartyCode(host)?.code).toBe("222222");
    expect(registry.inParty(host)).toBe(true);

    const guest = registry.tvHello();
    expect(registry.joinParty(guest, "222222").ok).toBe(true);
    expect(registry.ensurePartyCode(guest)).toBeNull();
  });

  it("knows a code that a party is open with, for as long as it is", () => {
    const { registry, advance, host, code } = hosted();
    expect(registry.isPartyCode(code)).toBe(true);
    expect(registry.isPartyCode("000000")).toBe(false);
    registry.closeParty(host);
    expect(registry.isPartyCode(code)).toBe(false); // it went with the party

    const reopened = registry.ensurePartyCode(host)!.code;
    expect(registry.isPartyCode(reopened)).toBe(true);
    advance(10 * 60 * 1000);
    expect(registry.isPartyCode(reopened)).toBe(false); // it ran out
  });

  it("finds the screen a code is open on, and keeps a party with guests joinable after its code ran out (until it is over), for the friends invited to it", () => {
    const { registry, advance, host, code, arrive } = hosted();
    expect(registry.hostOfPartyCode(code)).toBe(host);
    expect(registry.hostOfPartyCode("000000")).toBeUndefined();
    expect(registry.deviceByPublicId(host.publicId)).toBe(host);
    expect(registry.deviceByPublicId("nobody")).toBeUndefined();

    // Nobody came: the code is the party, and when it runs out the party is over.
    expect(registry.runningParty(host)?.code).toBe(code);
    advance(10 * 60 * 1000);
    expect(registry.hostOfPartyCode(code)).toBeUndefined();
    expect(registry.runningParty(host)).toBeNull();

    // Somebody came: the party goes on without its code, and is given a new one when a friend who was invited asks.
    const again = registry.ensurePartyCode(host)!.code;
    expect(registry.joinParty(arrive(), again).ok).toBe(true);
    advance(10 * 60 * 1000);
    expect(registry.partyCodeOf(host)).toBeNull();
    const renewed = registry.runningParty(host)!;
    expect(renewed.code).not.toBe(again);
    expect(registry.hostOfPartyCode(renewed.code)).toBe(host);
    expect(registry.runningParty(host)?.code).toBe(renewed.code); // (the same one, until it runs out)

    // A guest has no party of its own, and a party that was ended is over.
    expect(registry.runningParty(registry.followersOf(host)[0]!)).toBeNull();
    registry.closeParty(host);
    expect(registry.runningParty(host)).toBeNull();
  });

  it("makes every TV that types the code a guest: the code is not used up", () => {
    const { registry, host, code, arrive } = hosted();
    const [first, second] = [arrive(), arrive()];
    expect(registry.joinParty(first!, code)).toEqual({ ok: true, host });
    expect(registry.joinParty(second!, code)).toEqual({ ok: true, host });
    expect(host.followerIds).toEqual([first!.id, second!.id]);
    expect(first!.leaderId).toBe(host.id);
    expect(registry.ensureCode(first!)).toBeNull(); // it has a party now, so it shows no pairing code
    expect(registry.joinParty(first!, code)).toEqual({ ok: true, host }); // typing it again changes nothing
    expect(host.followerIds).toHaveLength(2);
  });

  it("turns away a wrong or expired code, the host's own, and a party with no room left", () => {
    const { registry, advance, host, code, arrive } = hosted();
    expect(registry.joinParty(arrive(), "000000")).toEqual({ ok: false, reason: "INVALID_CODE" });
    expect(registry.joinParty(host, code)).toEqual({ ok: false, reason: "INVALID_CODE" });
    for (let i = 0; i < 5; i++) expect(registry.joinParty(arrive(), code).ok).toBe(true);
    expect(registry.joinParty(arrive(), code)).toEqual({ ok: false, reason: "PARTY_FULL" });
    advance(10 * 60 * 1000);
    expect(registry.joinParty(arrive(), code)).toEqual({ ok: false, reason: "INVALID_CODE" });
    expect(host.followerIds).toHaveLength(5); // the guests already there stay
  });

  it("asks a TV that has a phone, guests or another party to let go of that first, and takes an empty party of its own along", () => {
    const { registry, host, code, arrive } = hosted();
    const withPhone = arrive();
    registry.ensureCode(withPhone);
    registry.pair(registry.controllerHello(), withPhone.code!.value);
    expect(registry.joinParty(withPhone, code)).toEqual({ ok: false, reason: "HAS_PHONE" });

    const other = registry.tvHello();
    const otherCode = registry.ensurePartyCode(other)!.code;
    const guestOfOther = arrive();
    registry.joinParty(guestOfOther, otherCode);
    expect(registry.joinParty(other, code)).toEqual({ ok: false, reason: "HOSTING" });
    expect(registry.joinParty(guestOfOther, code)).toEqual({ ok: false, reason: "ALREADY_IN_PARTY" });

    const lonely = registry.tvHello();
    const lonelyCode = registry.ensurePartyCode(lonely)!.code;
    expect(registry.joinParty(lonely, code)).toEqual({ ok: true, host });
    expect(registry.joinParty(arrive(), lonelyCode)).toEqual({ ok: false, reason: "INVALID_CODE" }); // its own code went with it
  });

  it("lets the host send a guest away by its public id, or end the party for all of them", () => {
    const { registry, host, code, arrive } = hosted();
    const [first, second] = [arrive(), arrive()];
    registry.joinParty(first!, code);
    registry.joinParty(second!, code);
    expect(registry.removeGuest(host, "nobody")).toBeNull();
    expect(registry.removeGuest(host, first!.publicId)).toBe(first);
    expect(first!.leaderId).toBeNull();
    expect(host.followerIds).toEqual([second!.id]);

    expect(registry.closeParty(host)).toEqual([second]);
    expect([second!.leaderId, host.followerIds, registry.partyCodeOf(host)]).toEqual([null, [], null]);
    expect(registry.joinParty(arrive(), code)).toEqual({ ok: false, reason: "INVALID_CODE" });
    expect(registry.inParty(host)).toBe(false);
  });

  it("gives each party an id that lasts as long as the party does - through a new code for the guests it has - and a party that begins later another", () => {
    const { registry, advance, host, code, arrive } = hosted();
    const first = registry.partyOfCode(code)!;
    expect(first).toEqual({ host: host.publicId, party: expect.stringMatching(/^party_[0-9a-f]{24}$/) });
    expect(registry.partyOfCode("000000")).toBeUndefined();
    // The same party while its code stays good, and when the code ran out with a guest in it and the party got a new one...
    expect(registry.ensurePartyCode(host)?.code).toBe(code);
    expect(registry.partyOfCode(code)).toEqual(first);
    expect(registry.joinParty(arrive(), code).ok).toBe(true);
    advance(10 * 60 * 1000);
    const renewed = registry.runningParty(host)!;
    expect(renewed.code).not.toBe(code);
    expect(registry.partyOfCode(renewed.code)).toEqual(first);
    // ...and another once it was ended, or was left with nobody in it and no code.
    registry.closeParty(host);
    const second = registry.partyOfCode(registry.ensurePartyCode(host)!.code)!;
    expect(second.host).toBe(host.publicId);
    expect(second.party).not.toBe(first.party);
    advance(10 * 60 * 1000);
    const third = registry.partyOfCode(registry.ensurePartyCode(host)!.code)!;
    expect(third.party).not.toBe(second.party);
    expect(new Set([first.party, second.party, third.party]).size).toBe(3);
  });

  it("opens an invitation to the party it was to and to no party the screen hosts after it, and to nobody's party that is not there", () => {
    const { registry, advance, host, code, arrive } = hosted();
    const { party } = registry.partyOfCode(code)!;
    expect(registry.invitedParty(host.publicId, party, "pro_bob")?.code).toBe(code);
    expect(registry.invitedParty("nobody", party, "pro_bob")).toBeNull();
    expect(registry.invitedParty(host.publicId, "party_other", "pro_bob")).toBeNull();
    // With a guest in it the party outlives its code, and the invitation is given the new one.
    registry.joinParty(arrive(), code);
    advance(10 * 60 * 1000);
    expect(registry.invitedParty(host.publicId, party, "pro_bob")?.code).not.toBe(code);
    // Ended, and begun again: the invitation was to the party that ended.
    registry.closeParty(host);
    expect(registry.invitedParty(host.publicId, party, "pro_bob")).toBeNull();
    registry.ensurePartyCode(host);
    expect(registry.invitedParty(host.publicId, party, "pro_bob")).toBeNull();

    // So it is for a party that ran out with nobody in it, and a new one is begun on the same screen.
    const next = registry.partyOfCode(registry.ensurePartyCode(host)!.code)!;
    expect(registry.invitedParty(host.publicId, next.party, "pro_bob")).not.toBeNull();
    advance(10 * 60 * 1000);
    expect(registry.invitedParty(host.publicId, next.party, "pro_bob")).toBeNull(); // (over)
    registry.ensurePartyCode(host);
    expect(registry.invitedParty(host.publicId, next.party, "pro_bob")).toBeNull(); // (and not back with the next party)
  });

  it("does not let a screen that was sent away back with any code, nor the profile signed in on it with another screen or from its bell", () => {
    const { registry, host, code, arrive } = hosted();
    const [kicked, stays] = [arrive(), arrive()];
    registry.setProfile(kicked, "pro_bob");
    registry.joinParty(kicked, code);
    registry.joinParty(stays, code);
    expect(registry.removeGuest(host, kicked.publicId)).toBe(kicked);

    // The code it knew is changed, so it is no good to anyone...
    const fresh = registry.partyCodeOf(host)!.code;
    expect(fresh).not.toBe(code);
    expect(registry.hostOfPartyCode(code)).toBeUndefined();
    expect(registry.joinParty(arrive(), code)).toEqual({ ok: false, reason: "INVALID_CODE" });
    // ...and the new one is no good to the screen that was sent away, nor to a profile that was signed in on it, on any other screen.
    expect(registry.joinParty(kicked, fresh)).toEqual({ ok: false, reason: "INVALID_CODE" });
    const elsewhere = arrive();
    registry.setProfile(elsewhere, "pro_bob");
    expect(registry.joinParty(elsewhere, fresh)).toEqual({ ok: false, reason: "INVALID_CODE" });
    expect(registry.joinParty(arrive(), fresh).ok).toBe(true);
    expect(host.followerIds).toHaveLength(2); // (the guest that stayed, and the one that came)
    // A screen that nobody is signed in on is kept out by the screen itself.
    const plain = arrive();
    expect(registry.joinParty(plain, fresh).ok).toBe(true);
    registry.removeGuest(host, plain.publicId);
    expect(registry.joinParty(plain, registry.partyCodeOf(host)!.code)).toEqual({ ok: false, reason: "INVALID_CODE" });
    // The bell of that profile is not given the code of the party it was sent away from.
    const latest = registry.partyCodeOf(host)!.code; // (changed again when the plain one was sent away)
    const { party } = registry.partyOfCode(latest)!;
    expect(registry.invitedParty(host.publicId, party, "pro_bob")).toBeNull();
    expect(registry.invitedParty(host.publicId, party, "pro_sam")?.code).toBe(latest);
  });

  it("sends a guest away for good from the phone of the host's TV too", () => {
    const { registry, host, code, arrive } = hosted();
    registry.ensureCode(host);
    const phone = registry.controllerHello();
    registry.pair(phone, host.code!.value);
    const kicked = arrive();
    registry.joinParty(kicked, code);
    expect(registry.removeFollower(phone, "nobody")).toBeNull();
    expect(registry.removeFollower(phone, kicked.publicId)).toEqual({ leader: host, follower: kicked });
    const fresh = registry.partyCodeOf(host)!.code;
    expect(fresh).not.toBe(code);
    expect(registry.joinParty(kicked, fresh)).toEqual({ ok: false, reason: "INVALID_CODE" });
    expect(registry.joinParty(arrive(), fresh).ok).toBe(true);
  });

  it("changes the code only if one is open when a guest is sent away, and forgets who was sent away when the party ends; a guest that left on its own was not sent away", () => {
    const { registry, advance, host, code, arrive } = hosted();
    const [kicked, leaver, other] = [arrive(), arrive(), arrive()];
    for (const guest of [kicked, leaver, other]) registry.joinParty(guest, code);
    registry.detachFollower(leaver);
    expect(registry.partyCodeOf(host)?.code).toBe(code); // (a guest that leaves changes nothing for the others)
    expect(registry.joinParty(leaver, code).ok).toBe(true); // (and comes back with the code, as it did)

    advance(10 * 60 * 1000); // the code ran out; the party did not
    registry.removeGuest(host, other.publicId);
    expect(registry.partyCodeOf(host)).toBeNull(); // (none is made: none was being shown)
    const renewed = registry.runningParty(host)!.code;
    expect(registry.joinParty(other, renewed)).toEqual({ ok: false, reason: "INVALID_CODE" });

    registry.closeParty(host);
    const next = registry.ensurePartyCode(host)!.code;
    expect(registry.joinParty(other, next).ok).toBe(true); // a new party: nobody was sent away from it
    expect(registry.joinParty(kicked, next).ok).toBe(true);
  });

  it("goes on for the guests a restart remembers, as a party with an id that nothing from before the restart is to: the invitations of before are void, the new ones are good", () => {
    const { registry, host, code, arrive } = hosted();
    const guest = arrive();
    registry.joinParty(guest, code);
    const before = registry.partyOfCode(code)!;

    const restarted = new Registry({ now: () => 1_000_000, generateCode: counter(codes) }); // (the clock `setup` starts with: a restart is a moment later)
    restarted.restore(registry.records());
    const hostAgain = restarted.tvHello(host.id);
    expect(hostAgain.followerIds).toEqual([guest.id]); // (the party is there, with no code and no id)
    expect(restarted.invitedParty(host.publicId, before.party, "pro_bob")).toBeNull();
    const renewed = restarted.runningParty(hostAgain)!;
    const now = restarted.partyOfCode(renewed.code)!;
    expect(now.host).toBe(host.publicId);
    expect(now.party).not.toBe(before.party);
    expect(restarted.invitedParty(host.publicId, now.party, "pro_bob")?.code).toBe(renewed.code);
    expect(restarted.invitedParty(host.publicId, before.party, "pro_bob")).toBeNull();
  });

  it("does not keep who was sent away, nor the id of the party, past its end: the host ending it, the host letting go, or its running out with nobody in it", () => {
    for (const end of ["closed", "let go", "ran out"] as const) {
      const { registry, advance, host, code, arrive } = hosted();
      const [kicked, stays] = [arrive(), arrive()];
      registry.joinParty(kicked, code);
      registry.joinParty(stays, code);
      registry.removeGuest(host, kicked.publicId);
      expect([host.partyId, [...host.barred]], end).toEqual([expect.stringMatching(/^party_/), [kicked.id]]);
      if (end === "closed") registry.closeParty(host);
      else if (end === "let go") registry.unpairDevice(host);
      if (end !== "ran out") expect([host.partyId, host.barred.size], end).toEqual([null, 0]);
      else {
        registry.detachFollower(stays);
        advance(10 * 60 * 1000); // (the code ran out, and nobody is in the party: it is over, and the next one is a new party)
        expect(registry.runningParty(host)).toBeNull();
      }
      // A party that begins now is a new one: nobody was sent away from it.
      const next = registry.ensurePartyCode(host)!.code;
      expect(host.barred.size, end).toBe(0);
      expect(registry.joinParty(kicked, next).ok, end).toBe(true);
    }
  });

  it("lets the host make a guest an admin by its public id, and take that back: nobody else is one, and it lasts only as long as the guest's place in the party", () => {
    const { registry, host, code, arrive } = hosted();
    const [first, second] = [arrive(), arrive()];
    registry.joinParty(first!, code);
    registry.joinParty(second!, code);
    expect([first!.admin, second!.admin, host.admin]).toEqual([false, false, false]);

    expect(registry.setAdmin(host, "nobody", true)).toBeNull(); // no such guest
    expect(registry.setAdmin(host, host.publicId, true)).toBeNull(); // the host is not its own guest
    expect(registry.setAdmin(arrive(), first!.publicId, true)).toBeNull(); // a screen with no guests has none to make one
    expect(registry.setAdmin(host, first!.publicId, true)).toBe(first);
    expect([first!.admin, second!.admin]).toEqual([true, false]);
    expect(registry.setAdmin(host, first!.publicId, true)).toBeNull(); // already one: nothing changed
    expect(registry.setAdmin(host, first!.publicId, false)).toBe(first);
    expect(first!.admin).toBe(false);

    // Leaving, being sent away, or the end of the party: a guest is no admin any more, and one that comes back (one that left) comes back as an ordinary one.
    registry.setAdmin(host, first!.publicId, true);
    registry.setAdmin(host, second!.publicId, true);
    registry.detachFollower(first!);
    expect(first!.admin).toBe(false);
    registry.joinParty(first!, code);
    expect(first!.admin).toBe(false);
    registry.removeGuest(host, second!.publicId);
    expect(second!.admin).toBe(false);
    registry.setAdmin(host, first!.publicId, true);
    registry.closeParty(host);
    expect(first!.admin).toBe(false);
  });

  it("takes the guests down with a host that lets go, and never hands a party code to someone else's code", () => {
    const { registry, host, code, arrive } = hosted();
    const guest = arrive();
    registry.joinParty(guest, code);
    registry.unpairDevice(host);
    expect([guest.leaderId, registry.partyCodeOf(host)]).toEqual([null, null]);

    // codes of every kind share one space: a new party code is never one that is live as a pairing code
    const clash = setup({ generateCode: counter(["123456", "123456", "654321"]) });
    const a = clash.registry.tvHello();
    const b = clash.registry.tvHello();
    expect(clash.registry.ensureCode(a)?.code).toBe("123456");
    expect(clash.registry.ensurePartyCode(b)?.code).toBe("654321");
  });

  it("names a screen by the name it chose, cleaned up, or by its own", () => {
    const { registry, host } = hosted();
    expect(registry.displayName(host)).toMatch(/^TV [0-9A-F]{4}$/);
    registry.setLabel(host, "  Alex \n\t the  Great ");
    expect(registry.displayName(host)).toBe("Alex the Great");
    registry.setLabel(host, "x".repeat(100));
    expect(registry.displayName(host)).toHaveLength(40);
    registry.setLabel(host, "   ");
    expect(registry.displayName(host)).toMatch(/^TV /);
    expect(cleanLabel("\u0000‮")).toBeNull(); // nothing but control and direction marks
  });
});

describe("Registry: what a TV was playing", () => {
  const film = { title: "Film", stream: { url: "https://cdn.example/f.mp4", type: "mp4" as const }, page: "https://site.example/watch/1", poster: "/p.jpg", year: 2001 };
  const at = (currentTime: number, state: "playing" | "paused" = "playing") => ({ state, currentTime, duration: 7200 });
  const DAY = 24 * 3600 * 1000;

  /** A TV with a phone, and the video on (the way the hub puts one on). */
  function playing(registry: Registry, media: typeof film | Omit<typeof film, "page"> = film, startAt = 0) {
    const tv = registry.tvHello();
    registry.pair(registry.controllerHello(), registry.ensureCode(tv)!.code);
    tv.media = media;
    registry.startedPlaying(tv, media, startAt);
    return tv;
  }

  it("remembers the video and the place it has reached, with the picture its card had", () => {
    const { registry } = setup();
    const tv = playing(registry);
    expect(registry.resumeOf(tv)).toEqual({ url: film.page, hint: { poster: "/p.jpg", year: 2001 }, time: 0 });
    registry.noteProgress(tv, at(600.9));
    expect(registry.resumeOf(tv)).toEqual({ url: film.page, hint: { poster: "/p.jpg", year: 2001 }, time: 600 });
  });

  it("has nothing to put back for a TV on its own, one that watches along, or a video with no link that plays it again", () => {
    const { registry } = setup();
    const alone = registry.tvHello();
    alone.media = film;
    registry.startedPlaying(alone, film, 300);
    expect(registry.resumeOf(alone)).toBeUndefined(); // it has its own Continue watching

    const host = playing(registry);
    const guest = registry.tvHello();
    registry.joinParty(guest, registry.ensurePartyCode(host)!.code);
    guest.resume = host.resume;
    expect(registry.resumeOf(guest)).toBeUndefined();

    const { page: _page, ...pasted } = film;
    const other = playing(registry, pasted);
    expect(other.resume).toBeNull();
    expect(registry.resumeOf(other)).toBeUndefined();
  });

  it("is replaced by the next video, and cleared by a stop, the end of the video, or the phone letting go", () => {
    const { registry } = setup();
    const tv = playing(registry);
    registry.noteProgress(tv, at(100));
    const next = { ...film, page: "https://site.example/watch/2" };
    tv.media = next;
    registry.startedPlaying(tv, next, 0);
    expect(registry.resumeOf(tv)).toMatchObject({ url: next.page, time: 0 });

    registry.forgetResume(tv);
    expect(registry.resumeOf(tv)).toBeUndefined();

    registry.startedPlaying(tv, next, 0);
    registry.noteProgress(tv, at(7190)); // the last minute: as good as seen
    expect(registry.resumeOf(tv)).toBeUndefined();
    registry.startedPlaying(tv, next, 0);
    registry.noteProgress(tv, { ...at(100), state: "paused", ended: true });
    expect(registry.resumeOf(tv)).toBeUndefined();

    registry.startedPlaying(tv, next, 0);
    registry.unpair(registry.controllersOf(tv)[0]!);
    expect(tv.resume).toBeNull();
  });

  it("takes only a playing or paused picture for a place, and starts over from a report when the server did not know what was on", () => {
    const { registry } = setup();
    const tv = playing(registry);
    registry.noteProgress(tv, at(500));
    for (const state of ["loading", "idle", "error"] as const) registry.noteProgress(tv, { ...at(0), state });
    expect(registry.resumeOf(tv)?.time).toBe(500);

    // A server that was restarted while this played: the TV tells it what is on, and the next report is the first it hears of the place.
    const { registry: fresh } = setup();
    const tv2 = fresh.tvHello();
    fresh.pair(fresh.controllerHello(), fresh.ensureCode(tv2)!.code);
    tv2.media = film;
    expect(fresh.resumeOf(tv2)).toBeUndefined();
    fresh.noteProgress(tv2, at(900));
    expect(fresh.resumeOf(tv2)).toMatchObject({ url: film.page, time: 900 });
  });

  it("hands a restart the place only when it has moved a while, and exactly when the TV goes away", () => {
    const { registry } = setup();
    let changes = 0;
    registry.onChange = () => changes++;
    const tv = playing(registry);
    const saved = () => registry.records().devices.find((record) => record.id === tv.id)?.resume?.time;
    const base = changes;
    registry.noteProgress(tv, at(10));
    registry.noteProgress(tv, at(25));
    expect(changes).toBe(base);
    expect(saved()).toBe(0);

    registry.noteProgress(tv, at(31));
    expect(changes).toBe(base + 1);
    expect(saved()).toBe(31);
    registry.noteProgress(tv, at(45));
    expect(changes).toBe(base + 1);
    expect(saved()).toBe(31);
    expect(registry.resumeOf(tv)?.time).toBe(45); // memory is always as far as the TV said

    registry.checkpoint(tv);
    expect(changes).toBe(base + 2);
    expect(saved()).toBe(45);
    registry.checkpoint(tv);
    expect(changes).toBe(base + 2); // nothing new to write
  });

  it("does not take what a picture reports on its way to the place it was put back at for the place", () => {
    const { registry, advance } = setup();
    const tv = playing(registry);
    registry.startedPlaying(tv, film, 600, true);
    registry.noteProgress(tv, at(0, "paused")); // the picture starts at the beginning before it has found its place
    registry.noteProgress(tv, at(2, "paused"));
    expect(registry.resumeOf(tv)?.time).toBe(600);

    registry.noteProgress(tv, at(601, "paused")); // got there: from now on a seek back is a real place
    registry.noteProgress(tv, at(10, "paused"));
    expect(registry.resumeOf(tv)?.time).toBe(10);

    registry.startedPlaying(tv, film, 600, true);
    advance(46_000); // a picture that never gets there is believed after a while
    registry.noteProgress(tv, at(3, "paused"));
    expect(registry.resumeOf(tv)?.time).toBe(3);
  });

  it("is not put back when it was more than a month ago, however long the server has been up", () => {
    const { registry, advance } = setup();
    const tv = playing(registry);
    registry.noteProgress(tv, at(800));
    advance((KEEP_RESUME_DAYS - 1) * DAY);
    expect(registry.resumeOf(tv)?.time).toBe(800);
    advance(2 * DAY);
    expect(registry.resumeOf(tv)).toBeUndefined();
  });

  it("goes through a restart, and is let go of when it is more than a month old", () => {
    const clock = { now: Date.parse("2026-10-11T12:00:00Z") };
    const before = new Registry({ now: () => clock.now });
    const tv = playing(before);
    before.noteProgress(tv, at(800));
    before.checkpoint(tv);
    const records = before.records();

    const soon = new Registry({ now: () => clock.now + 3 * DAY });
    soon.restore(records);
    expect(soon.resumeOf(soon.tvHello(tv.id))).toEqual({ url: film.page, hint: { poster: "/p.jpg", year: 2001 }, time: 800 });

    const later = new Registry({ now: () => clock.now + (KEEP_RESUME_DAYS + 2) * DAY });
    later.restore(records);
    const tvAgain = later.tvHello(tv.id);
    expect(tvAgain.controllerId).not.toBeNull(); // the pair is still there
    expect(later.resumeOf(tvAgain)).toBeUndefined();
  });
});

function counter(values: string[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}
