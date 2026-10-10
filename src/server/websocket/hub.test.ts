import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseServerMessage, type ClientMessage, type Command, type ServerMessage } from "../../shared";
import { buildApp } from "../app";
import type { ResolveFn } from "../resolvers";
import { CLOSE_REPLACED } from "./hub";

/**
 * Minimal fake TV / phone. It connects through `app.injectWS`, in memory: a client and a server that talk over real loopback
 * sockets inside one Node process crash that process now and then on Windows (exit code 0xC0000409, no message, even with
 * plain Node and no test runner). Nothing here needs a port.
 */
class Client {
  private queue: ServerMessage[] = [];
  private waiting: (() => void)[] = [];
  closeCode: number | undefined;

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (message) this.queue.push(message);
      this.waiting.splice(0).forEach((wake) => wake());
    };
    ws.onclose = (event) => {
      this.closeCode = event.code;
      this.waiting.splice(0).forEach((wake) => wake());
    };
  }

  static async open(server: FastifyInstance): Promise<Client> {
    return new Client(await server.injectWS("/ws"));
  }

  send(message: ClientMessage | { type: string }): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Next message of this type (earlier non-matching messages are skipped). */
  async next<T extends ServerMessage["type"]>(type: T, timeoutMs = 2000): Promise<Extract<ServerMessage, { type: T }>> {
    return this.nextWhere(type, () => true, timeoutMs);
  }

  /** Next message of this type that `accept`s (earlier ones, of that type or not, are skipped): for waiting until a party looks a certain way. */
  async nextWhere<T extends ServerMessage["type"]>(type: T, accept: (message: Extract<ServerMessage, { type: T }>) => boolean, timeoutMs = 2000): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.queue.findIndex((m) => m.type === type && accept(m as Extract<ServerMessage, { type: T }>));
      if (index >= 0) return this.queue.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${type}; queue: ${JSON.stringify(this.queue)}`);
      await new Promise<void>((wake) => {
        this.waiting.push(wake);
        setTimeout(wake, left);
      });
    }
  }

  /** Wait a moment, then assert no queued message matches. */
  async expectNone(predicate: (message: ServerMessage) => boolean, waitMs = 150): Promise<void> {
    await new Promise((r) => setTimeout(r, waitMs));
    expect(this.queue.filter(predicate)).toEqual([]);
  }

  async closed(timeoutMs = 2000): Promise<number | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.closeCode;
  }

  /** The socket drops, as when a page is closed or the network goes. (A polite close never completes over `injectWS`'s in-memory streams.) */
  close(): void {
    this.ws.terminate();
  }
}

let app: FastifyInstance;
const clients: Client[] = [];

/** Swapped per test; the hub only ever sees this function, never the real resolvers. */
let resolveImpl: ResolveFn;

beforeEach(async () => {
  resolveImpl = async () => ({ status: "unsupported", reason: "no resolver configured in this test" });
  app = await buildApp({ resolve: (url) => resolveImpl(url) });
  await app.ready();
});

afterEach(async () => {
  // Let every close handshake finish before the server goes.
  const open = clients.splice(0);
  open.forEach((c) => c.close());
  await Promise.all(open.map((c) => c.closed(1000)));
  await app.close();
});

async function connect(): Promise<Client> {
  const client = await Client.open(app);
  clients.push(client);
  return client;
}

async function pairedSetup() {
  const tv = await connect();
  tv.send({ type: "TV_HELLO" });
  const welcome = await tv.next("TV_WELCOME");

  const phone = await connect();
  phone.send({ type: "CTL_HELLO" });
  await phone.next("CTL_WELCOME");
  phone.send({ type: "PAIR", code: welcome.pairing!.code });
  const paired = await phone.next("CTL_WELCOME");
  await tv.next("TV_PAIRED");
  return { tv, phone, deviceId: welcome.deviceId, controllerId: paired.controllerId };
}

const media = { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" as const } };

describe("pairing over WebSocket", () => {
  it("gives a new TV a device id and a 6-digit code", async () => {
    const tv = await connect();
    tv.send({ type: "TV_HELLO" });
    const welcome = await tv.next("TV_WELCOME");
    expect(welcome.deviceId).toMatch(/^tv_/);
    expect(welcome.paired).toBe(false);
    expect(welcome.pairing?.code).toMatch(/^\d{6}$/);
  });

  it("rejects a wrong code and accepts the right one", async () => {
    const tv = await connect();
    tv.send({ type: "TV_HELLO" });
    const { pairing } = await tv.next("TV_WELCOME");

    const phone = await connect();
    phone.send({ type: "CTL_HELLO" });
    expect((await phone.next("CTL_WELCOME")).tv).toBeNull();

    const wrong = pairing!.code === "000000" ? "000001" : "000000";
    phone.send({ type: "PAIR", code: wrong });
    expect((await phone.next("ERROR")).code).toBe("INVALID_CODE");

    phone.send({ type: "PAIR", code: pairing!.code });
    const welcome = await phone.next("CTL_WELCOME");
    expect(welcome.tv).toMatchObject({ online: true });
    await tv.next("TV_PAIRED");
  });

  it("does not leak the device id to the phone", async () => {
    const { phone, deviceId } = await pairedSetup();
    phone.send({ type: "CTL_HELLO" });
    const welcome = await phone.next("CTL_WELCOME");
    expect(JSON.stringify(welcome)).not.toContain(deviceId);
  });

  it("a pairing code works only once", async () => {
    const tv = await connect();
    tv.send({ type: "TV_HELLO" });
    const { pairing } = await tv.next("TV_WELCOME");
    const first = await connect();
    first.send({ type: "CTL_HELLO" });
    await first.next("CTL_WELCOME");
    first.send({ type: "PAIR", code: pairing!.code });
    await first.next("CTL_WELCOME");

    const second = await connect();
    second.send({ type: "CTL_HELLO" });
    await second.next("CTL_WELCOME");
    second.send({ type: "PAIR", code: pairing!.code });
    expect((await second.next("ERROR")).code).toBe("INVALID_CODE");
  });
});

describe("guessing pairing codes", () => {
  /** A hub that tolerates `max` wrong codes per `windowMs`, with one TV showing a code and one phone ready to try. */
  async function guessingSetup(max: number, windowMs: number) {
    const strict = await buildApp({ hub: { maxFailedPairings: max, failedPairingWindowMs: windowMs } });
    await strict.ready();
    const tv = await Client.open(strict);
    tv.send({ type: "TV_HELLO" });
    const code = (await tv.next("TV_WELCOME")).pairing!.code;
    const phone = await Client.open(strict);
    phone.send({ type: "CTL_HELLO" });
    await phone.next("CTL_WELCOME");
    const wrong = code === "000000" ? "000001" : "000000";
    return { strict, tv, phone, code, wrong, close: () => [tv, phone].forEach((client) => client.close()) };
  }

  it("pauses pairing after too many wrong codes, and does not check the right one meanwhile", async () => {
    const { strict, phone, code, wrong, close } = await guessingSetup(3, 60_000);
    try {
      for (let i = 0; i < 3; i++) {
        phone.send({ type: "PAIR", code: wrong });
        expect((await phone.next("ERROR")).code).toBe("INVALID_CODE");
      }
      phone.send({ type: "PAIR", code });
      expect((await phone.next("ERROR")).code).toBe("RATE_LIMITED");
    } finally {
      close();
      await strict.close();
    }
  });

  it("counts wrong codes from every phone together", async () => {
    const { strict, phone, code, wrong, close } = await guessingSetup(2, 60_000);
    try {
      const other = await Client.open(strict);
      other.send({ type: "CTL_HELLO" });
      await other.next("CTL_WELCOME");
      other.send({ type: "PAIR", code: wrong });
      await other.next("ERROR");
      phone.send({ type: "PAIR", code: wrong });
      await phone.next("ERROR");
      other.send({ type: "PAIR", code });
      expect((await other.next("ERROR")).code).toBe("RATE_LIMITED");
      other.close();
    } finally {
      close();
      await strict.close();
    }
  });

  it("lets pairing through again once the window has passed", async () => {
    const { strict, tv, phone, code, wrong, close } = await guessingSetup(1, 150);
    try {
      phone.send({ type: "PAIR", code: wrong });
      expect((await phone.next("ERROR")).code).toBe("INVALID_CODE");
      phone.send({ type: "PAIR", code });
      expect((await phone.next("ERROR")).code).toBe("RATE_LIMITED");
      await new Promise((resolve) => setTimeout(resolve, 200));
      phone.send({ type: "PAIR", code });
      expect((await phone.next("CTL_WELCOME")).tv).toMatchObject({ online: true });
      await tv.next("TV_PAIRED");
    } finally {
      close();
      await strict.close();
    }
  });

  it("does not count a right code against anyone", async () => {
    const { strict, phone, code, close } = await guessingSetup(1, 60_000);
    try {
      phone.send({ type: "PAIR", code });
      await phone.next("CTL_WELCOME");
    } finally {
      close();
      await strict.close();
    }
  });
});

describe("phone -> server -> TV", () => {
  it("relays LOAD, PLAY, PAUSE, SEEK, STOP to the TV in order", async () => {
    const { tv, phone } = await pairedSetup();
    const commands: Command[] = [
      { type: "LOAD", media },
      { type: "PLAY" },
      { type: "PAUSE" },
      { type: "SEEK", time: 10 },
      { type: "STOP" },
    ];
    for (const command of commands) phone.send({ type: "CMD", command });
    for (const command of commands) expect((await tv.next("TV_CMD")).command).toEqual(command);
  });

  it("refuses commands before pairing", async () => {
    const phone = await connect();
    phone.send({ type: "CTL_HELLO" });
    await phone.next("CTL_WELCOME");
    phone.send({ type: "CMD", command: { type: "PLAY" } });
    expect((await phone.next("ERROR")).code).toBe("NOT_PAIRED");
  });

  it("refuses commands (but keeps the pairing) while the TV is offline", async () => {
    const { tv, phone } = await pairedSetup();
    tv.close();
    expect((await phone.next("TV_STATUS")).online).toBe(false);
    phone.send({ type: "CMD", command: { type: "PLAY" } });
    expect((await phone.next("ERROR")).code).toBe("TV_OFFLINE");
  });

  it("refuses protocol messages before hello", async () => {
    const stranger = await connect();
    stranger.send({ type: "CMD", command: { type: "PLAY" } });
    expect((await stranger.next("ERROR")).code).toBe("NOT_AUTHENTICATED");
  });

  it("answers garbage with an error instead of dying", async () => {
    const client = await connect();
    client.send({ type: "WHAT" });
    expect((await client.next("ERROR")).code).toBe("BAD_MESSAGE");
    client.send({ type: "TV_HELLO" });
    await client.next("TV_WELCOME");
  });
});

describe("TV -> server -> phone", () => {
  it("shows the phone what the TV actually reports", async () => {
    const { tv, phone } = await pairedSetup();
    const state = { state: "playing" as const, currentTime: 12.5, duration: 30 };
    tv.send({ type: "TV_STATE", state });
    expect((await phone.next("STATE")).state).toEqual(state);
  });

  it("puts LOAD into 'loading' immediately and resets on STOP", async () => {
    const { phone } = await pairedSetup();
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    expect((await phone.next("STATE")).state.state).toBe("loading");
    phone.send({ type: "CMD", command: { type: "STOP" } });
    expect((await phone.next("STATE")).state.state).toBe("idle");
  });
});

describe("reconnects", () => {
  it("a reconnecting TV keeps its pairing and the phone is told it came back", async () => {
    const { tv, phone, deviceId } = await pairedSetup();
    tv.close();
    expect((await phone.next("TV_STATUS")).online).toBe(false);

    const tv2 = await connect();
    tv2.send({ type: "TV_HELLO", deviceId });
    const welcome = await tv2.next("TV_WELCOME");
    expect(welcome).toMatchObject({ deviceId, paired: true, pairing: null });
    expect((await phone.next("TV_STATUS")).online).toBe(true);
  });

  it("a reconnecting phone is restored with its TV, media and last state", async () => {
    const { tv, phone, controllerId } = await pairedSetup();
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    await tv.next("TV_CMD");
    tv.send({ type: "TV_STATE", state: { state: "paused", currentTime: 7, duration: 30 } });
    await phone.next("STATE");
    await phone.next("STATE");
    phone.close();

    const phone2 = await connect();
    phone2.send({ type: "CTL_HELLO", controllerId });
    const welcome = await phone2.next("CTL_WELCOME");
    expect(welcome.controllerId).toBe(controllerId);
    expect(welcome.tv?.online).toBe(true);
    expect(welcome.media).toEqual(media);
    expect(welcome.state).toEqual({ state: "paused", currentTime: 7, duration: 30 });
  });

  it("after a server restart-style unknown id, the TV simply gets a fresh device and code", async () => {
    const tv = await connect();
    tv.send({ type: "TV_HELLO", deviceId: "tv_from_before_restart" });
    const welcome = await tv.next("TV_WELCOME");
    expect(welcome.deviceId).not.toBe("tv_from_before_restart");
    expect(welcome.pairing?.code).toMatch(/^\d{6}$/);
  });

  it("a second TV page takes over the device; the first is told to stand down", async () => {
    const { tv, deviceId } = await pairedSetup();
    const tv2 = await connect();
    tv2.send({ type: "TV_HELLO", deviceId });
    await tv2.next("TV_WELCOME");
    expect(await tv.closed()).toBe(CLOSE_REPLACED);
  });

  it("the replaced TV page going away does not mark the live one offline", async () => {
    const { tv, phone, deviceId } = await pairedSetup();
    const tv2 = await connect();
    tv2.send({ type: "TV_HELLO", deviceId });
    await tv2.next("TV_WELCOME");
    await tv.closed();
    await phone.expectNone((m) => m.type === "TV_STATUS" && !m.online);
    phone.send({ type: "CMD", command: { type: "PLAY" } });
    expect((await tv2.next("TV_CMD")).command.type).toBe("PLAY");
  });
});

describe("PLAY_URL (phone pastes a link; server resolves; TV plays)", () => {
  const resolved = { title: "Resolved Movie", stream: { url: "https://cdn.example/m.mp4", type: "mp4" as const } };

  it("reports progress, then has the TV LOAD and PLAY the resolved media", async () => {
    const seen: string[] = [];
    resolveImpl = async (url) => {
      seen.push(url);
      return { status: "success", resolver: "test", media: resolved };
    };
    const { tv, phone } = await pairedSetup();

    phone.send({ type: "PLAY_URL", url: "https://site.example/watch/1" });
    expect((await phone.next("RESOLVE_STATUS")).status).toEqual({ phase: "resolving" });
    expect((await phone.next("RESOLVE_STATUS")).status).toEqual({ phase: "found", media: resolved });
    expect((await tv.next("TV_CMD")).command).toEqual({ type: "LOAD", media: resolved });
    expect((await tv.next("TV_CMD")).command).toEqual({ type: "PLAY" });
    expect((await phone.next("STATE")).state.state).toBe("loading");
    expect(seen).toEqual(["https://site.example/watch/1"]);
  });

  it("hands the phone and the TV the whole episode list a resolver supplied", async () => {
    const episodes = [1, 2, 3].map((n) => ({ season: 1, episode: n, title: `Ep ${n}`, url: `https://site.example/watch/1?s=1&e=${n}` }));
    const series = { ...resolved, series: { season: 1, episode: 2, episodes } };
    resolveImpl = async () => ({ status: "success", resolver: "test", media: series });
    const { tv, phone } = await pairedSetup();

    phone.send({ type: "PLAY_URL", url: "https://site.example/watch/1?s=1&e=2" });
    await phone.next("RESOLVE_STATUS"); // resolving
    expect((await phone.next("RESOLVE_STATUS")).status).toMatchObject({ phase: "found", media: { series: { episodes } } });
    expect((await tv.next("TV_CMD")).command).toMatchObject({ type: "LOAD", media: { series: { episodes } } });
  });

  it.each([
    [{ status: "unsupported" as const, reason: "Couldn't find a compatible video source." }, "unsupported", "Couldn't find a compatible video source."],
    [{ status: "temporary_failure" as const, reason: "Try again." }, "temporary_failure", "Try again."],
    [{ status: "invalid_url" as const }, "invalid_url", "That doesn't look like a link I can open."],
  ])("explains a %j failure to the phone and leaves the TV alone", async (result, reason, message) => {
    resolveImpl = async () => result;
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://site.example/x" });
    await phone.next("RESOLVE_STATUS"); // resolving
    expect((await phone.next("RESOLVE_STATUS")).status).toEqual({ phase: "failed", reason, message });
    await tv.expectNone((m) => m.type === "TV_CMD");
  });

  it("a resolver that throws becomes a friendly temporary failure", async () => {
    resolveImpl = async () => {
      throw new Error("kaboom /srv/secret");
    };
    const { phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://site.example/x" });
    await phone.next("RESOLVE_STATUS");
    const failed = (await phone.next("RESOLVE_STATUS")).status;
    expect(failed).toMatchObject({ phase: "failed", reason: "temporary_failure" });
    expect(JSON.stringify(failed)).not.toContain("secret");
  });

  it("doesn't even try to resolve while the TV is offline", async () => {
    let called = false;
    resolveImpl = async () => ((called = true), { status: "unsupported", reason: "x" });
    const { tv, phone } = await pairedSetup();
    tv.close();
    await phone.next("TV_STATUS");
    phone.send({ type: "PLAY_URL", url: "https://site.example/x" });
    expect((await phone.next("RESOLVE_STATUS")).status).toMatchObject({ phase: "failed", reason: "tv_offline" });
    expect(called).toBe(false);
  });

  it("refuses PLAY_URL before pairing", async () => {
    const phone = await connect();
    phone.send({ type: "CTL_HELLO" });
    await phone.next("CTL_WELCOME");
    phone.send({ type: "PLAY_URL", url: "https://site.example/x" });
    expect((await phone.next("ERROR")).code).toBe("NOT_PAIRED");
  });

  it("the newest choice wins: a slow earlier resolve never reaches the TV", async () => {
    const gate: { release: () => void } = { release: () => {} };
    resolveImpl = async (url) => {
      if (url.endsWith("/slow")) await new Promise<void>((resolve) => (gate.release = resolve));
      return { status: "success", resolver: "test", media: { title: url, stream: { url: `${url}.mp4`, type: "mp4" } } };
    };
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://s.example/slow" });
    await phone.next("RESOLVE_STATUS");
    phone.send({ type: "PLAY_URL", url: "https://s.example/fast" });
    expect(((await tv.next("TV_CMD")).command as { media: { title: string } }).media.title).toBe("https://s.example/fast");
    gate.release();
    await tv.next("TV_CMD"); // the PLAY that follows the fast LOAD
    await tv.expectNone((m) => m.type === "TV_CMD");
  });

  it("STOP while resolving cancels the pending load", async () => {
    const gate: { release: () => void } = { release: () => {} };
    resolveImpl = async () => {
      await new Promise<void>((resolve) => (gate.release = resolve));
      return { status: "success", resolver: "test", media: resolved };
    };
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://s.example/x" });
    await phone.next("RESOLVE_STATUS");
    phone.send({ type: "CMD", command: { type: "STOP" } });
    expect((await tv.next("TV_CMD")).command.type).toBe("STOP");
    gate.release();
    await tv.expectNone((m) => m.type === "TV_CMD");
  });
});

describe("keepalive", () => {
  it("answers PING with PONG, even before hello", async () => {
    const stranger = await connect();
    stranger.send({ type: "PING" });
    await stranger.next("PONG");
    const { tv, phone } = await pairedSetup();
    tv.send({ type: "PING" });
    phone.send({ type: "PING" });
    await tv.next("PONG");
    await phone.next("PONG");
  });

  it("drops a socket that has gone silent, and keeps one that keeps pinging", async () => {
    const fast = await buildApp({ hub: { staleAfterMs: 200, sweepEveryMs: 40 } });
    await fast.ready();
    try {
      const silent = await Client.open(fast);
      const alive = await Client.open(fast);
      silent.send({ type: "TV_HELLO" });
      alive.send({ type: "TV_HELLO" });
      const deadline = Date.now() + 700;
      while (Date.now() < deadline) {
        alive.send({ type: "PING" });
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(await silent.closed()).toBeDefined();
      expect(alive.closeCode).toBeUndefined();
      alive.close();
    } finally {
      await fast.close();
    }
  });
});

describe("TV_UNPAIR (the TV lets go of its phone)", () => {
  it("stops playback, gives the TV a fresh code, and sends the phone back to the code screen", async () => {
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    await tv.next("TV_CMD");

    tv.send({ type: "TV_UNPAIR" });
    expect((await tv.next("TV_CMD")).command).toEqual({ type: "STOP" });
    expect((await tv.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);

    const welcome = await phone.next("CTL_WELCOME");
    expect(welcome.tv).toBeNull();
    expect(welcome.media).toBeNull();
    phone.send({ type: "CMD", command: { type: "PLAY" } });
    expect((await phone.next("ERROR")).code).toBe("NOT_PAIRED");
  });

  it("the same phone can pair again with the new code", async () => {
    const { tv, phone } = await pairedSetup();
    tv.send({ type: "TV_UNPAIR" });
    const { pairing } = await tv.next("TV_UNPAIRED");
    await phone.next("CTL_WELCOME");

    phone.send({ type: "PAIR", code: pairing!.code });
    expect((await phone.next("CTL_WELCOME")).tv).toMatchObject({ online: true });
    await tv.next("TV_PAIRED");
  });

  it("a TV that was never paired just gets a code back", async () => {
    const tv = await connect();
    tv.send({ type: "TV_HELLO" });
    await tv.next("TV_WELCOME");
    tv.send({ type: "TV_UNPAIR" });
    expect((await tv.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);
  });
});

describe("UNPAIR (the phone forgets its TV)", () => {
  it("stops the TV, gives it a fresh code, and sends the phone back to the code screen", async () => {
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    await tv.next("TV_CMD");

    phone.send({ type: "UNPAIR" });
    expect((await tv.next("TV_CMD")).command).toEqual({ type: "STOP" });
    const unpaired = await tv.next("TV_UNPAIRED");
    expect(unpaired.pairing?.code).toMatch(/^\d{6}$/);

    const welcome = await phone.next("CTL_WELCOME");
    expect(welcome.tv).toBeNull();
    expect(welcome.media).toBeNull();
    expect(welcome.state.state).toBe("idle");

    phone.send({ type: "CMD", command: { type: "PLAY" } });
    expect((await phone.next("ERROR")).code).toBe("NOT_PAIRED");
  });

  it("the freed TV can be paired by someone else with its new code", async () => {
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "UNPAIR" });
    const { pairing } = await tv.next("TV_UNPAIRED");

    const other = await connect();
    other.send({ type: "CTL_HELLO" });
    await other.next("CTL_WELCOME");
    other.send({ type: "PAIR", code: pairing!.code });
    expect((await other.next("CTL_WELCOME")).tv).toMatchObject({ online: true });
    await tv.next("TV_PAIRED");

    // The first phone has no say over it any more.
    phone.send({ type: "CMD", command: { type: "PLAY" } });
    expect((await phone.next("ERROR")).code).toBe("NOT_PAIRED");
    await tv.expectNone((m) => m.type === "TV_CMD" && m.command.type === "PLAY");
  });

  it("a lookup still in flight never starts playing on the unpaired TV", async () => {
    const gate: { release: () => void } = { release: () => {} };
    resolveImpl = async () => {
      await new Promise<void>((resolve) => (gate.release = resolve));
      return { status: "success", resolver: "test", media };
    };
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://s.example/x" });
    await phone.next("RESOLVE_STATUS");
    phone.send({ type: "UNPAIR" });
    await tv.next("TV_UNPAIRED");
    gate.release();
    await tv.expectNone((m) => m.type === "TV_CMD" && m.command.type === "LOAD");
  });

  it("is harmless for a phone that was never paired", async () => {
    const phone = await connect();
    phone.send({ type: "CTL_HELLO" });
    await phone.next("CTL_WELCOME");
    phone.send({ type: "UNPAIR" });
    expect((await phone.next("CTL_WELCOME")).tv).toBeNull();
  });
});

describe("TV feedback while a link is being looked up", () => {
  it("tells the TV when the lookup starts and when it ends, on success", async () => {
    resolveImpl = async () => ({ status: "success", resolver: "test", media });
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://s.example/ok" });
    expect((await tv.next("TV_RESOLVING")).active).toBe(true);
    expect((await tv.next("TV_RESOLVING")).active).toBe(false);
    expect((await tv.next("TV_CMD")).command.type).toBe("LOAD");
  });

  it("and on failure, so the TV does not spin forever", async () => {
    resolveImpl = async () => ({ status: "unsupported", reason: "nope" });
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://s.example/bad" });
    expect((await tv.next("TV_RESOLVING")).active).toBe(true);
    expect((await tv.next("TV_RESOLVING")).active).toBe(false);
    await tv.expectNone((m) => m.type === "TV_CMD");
  });
});

describe("TV_CANCEL (whoever is at the TV stops waiting for a video)", () => {
  it("drops a lookup that is still running, so its answer never starts the film, and tells the phone", async () => {
    const gate: { release: () => void } = { release: () => {} };
    resolveImpl = async () => {
      await new Promise<void>((resolve) => (gate.release = resolve));
      return { status: "success", resolver: "test", media };
    };
    const { tv, phone } = await pairedSetup();
    tv.send({ type: "TV_PLAY_URL", url: "https://s.example/slow" });
    expect((await tv.next("TV_RESOLVING")).active).toBe(true);
    expect((await phone.next("RESOLVE_STATUS")).status.phase).toBe("resolving");

    tv.send({ type: "TV_CANCEL" });
    expect((await tv.next("TV_RESOLVING")).active).toBe(false);
    expect((await tv.next("TV_CMD")).command.type).toBe("STOP");
    expect((await phone.next("RESOLVE_STATUS")).status).toEqual({ phase: "cancelled" });

    gate.release();
    await tv.expectNone((m) => m.type === "TV_CMD" || m.type === "TV_RESOLVING");
    await phone.expectNone((m) => m.type === "RESOLVE_STATUS" || m.type === "MEDIA");
  });

  it("stops a video that had begun loading, and the phone sees nothing playing", async () => {
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    expect((await tv.next("TV_CMD")).command.type).toBe("LOAD");
    tv.send({ type: "TV_STATE", state: { state: "loading", currentTime: 0, duration: 0 } });

    tv.send({ type: "TV_CANCEL" });
    expect((await tv.next("TV_CMD")).command.type).toBe("STOP");
    for (let state = (await phone.next("STATE")).state; state.state !== "idle"; state = (await phone.next("STATE")).state);
  });

  it("is harmless when there was nothing to wait for", async () => {
    const { tv } = await pairedSetup();
    tv.send({ type: "TV_CANCEL" });
    expect((await tv.next("TV_CMD")).command.type).toBe("STOP");
  });
});

describe("resume and skip", () => {
  it("passes startAt from PLAY_URL through to the LOAD, and omits it otherwise", async () => {
    resolveImpl = async () => ({ status: "success", resolver: "test", media });
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://s.example/a", startAt: 754 });
    expect((await tv.next("TV_CMD")).command).toEqual({ type: "LOAD", media, startAt: 754 });
    await tv.next("TV_CMD"); // PLAY
    phone.send({ type: "PLAY_URL", url: "https://s.example/a" });
    const load = (await tv.next("TV_CMD")).command;
    expect(load).toEqual({ type: "LOAD", media });
    expect(load).not.toHaveProperty("startAt");
  });

  it("lets the TV itself resume a title from where it was left (Continue watching), with the picture it had", async () => {
    resolveImpl = async () => ({ status: "success", resolver: "test", media });
    const { tv } = await pairedSetup();
    tv.send({ type: "TV_PLAY_URL", url: "https://s.example/a", startAt: 1200, hint: { poster: "/posters/a.jpg", year: 2019 } });
    const load = (await tv.next("TV_CMD")).command;
    expect(load).toEqual({ type: "LOAD", media: { ...media, poster: "/posters/a.jpg", year: 2019 }, startAt: 1200 });
  });

  it("keeps what the source said about a title over what the screen thought, and gives the phone the same media", async () => {
    resolveImpl = async () => ({ status: "success", resolver: "test", media: { ...media, poster: "/from-source.jpg" } });
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: "https://s.example/a", hint: { poster: "/from-library.jpg", year: 1999 } });
    const expected = { ...media, poster: "/from-source.jpg", year: 1999 };
    expect((await phone.next("RESOLVE_STATUS")).status).toEqual({ phase: "resolving" });
    expect((await phone.next("RESOLVE_STATUS")).status).toEqual({ phase: "found", media: expected });
    expect(((await tv.next("TV_CMD")).command as { media: unknown }).media).toEqual(expected);
  });

  it("gives the next episode the picture and year the show already had", async () => {
    const episode = { season: 1, episode: 1, url: "https://s.example/e1" };
    const next = { season: 1, episode: 2, url: "https://s.example/e2" };
    resolveImpl = async (url) =>
      url === next.url
        ? { status: "success", resolver: "test", media: { ...media, title: "Show · S1 E2", series: { season: 1, episode: 2 } } }
        : { status: "success", resolver: "test", media: { ...media, title: "Show · S1 E1", series: { ...episode, next } } };
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "PLAY_URL", url: episode.url, hint: { poster: "/show.jpg", year: 2008 } });
    await tv.next("TV_CMD"); // LOAD
    await tv.next("TV_CMD"); // PLAY
    tv.send({ type: "TV_NEXT_EPISODE" });
    const load = (await tv.next("TV_CMD")).command as { media: { title: string; poster?: string; year?: number } };
    expect(load.media).toMatchObject({ title: "Show · S1 E2", poster: "/show.jpg", year: 2008 });
  });

  it("relays SKIP as-is, so the TV can apply it to where it really is", async () => {
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "CMD", command: { type: "SKIP", seconds: -10 } });
    expect((await tv.next("TV_CMD")).command).toEqual({ type: "SKIP", seconds: -10 });
  });
});

describe("watching together", () => {
  /** A second TV that the phone adds to the party. */
  async function addTv(phone: Client) {
    const tv2 = await connect();
    tv2.send({ type: "TV_HELLO" });
    const welcome = await tv2.next("TV_WELCOME");
    phone.send({ type: "ADD_TV", code: welcome.pairing!.code });
    await tv2.next("TV_FOLLOWING");
    return { tv2, deviceId: welcome.deviceId };
  }

  it("tells the new TV it follows, and the phone who is in the party", async () => {
    const { tv, phone } = await pairedSetup();
    const { tv2 } = await addTv(phone);
    const { tvs } = await phone.next("PARTY");
    expect(tvs).toHaveLength(1);
    expect(tvs[0]).toMatchObject({ online: true, name: expect.stringMatching(/^TV /) });
    expect(JSON.stringify(tvs)).not.toContain("tv_"); // the TV's own id never reaches a phone
    tv2.close();
    expect((await phone.next("PARTY")).tvs[0]?.online).toBe(false);
    await tv.expectNone((m) => m.type === "TV_UNPAIRED");
  });

  it("gives a TV that comes back its place in the party, and the film at the place the others are", async () => {
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    await tv.next("TV_CMD");
    tv.send({ type: "TV_STATE", state: { state: "playing", currentTime: 42.7, duration: 600, stream: media.stream.url } });
    const { tv2, deviceId } = await addTv(phone);
    expect((await tv2.next("TV_CMD")).command).toEqual({ type: "LOAD", media, startAt: 42 });

    tv2.close();
    const back = await connect();
    back.send({ type: "TV_HELLO", deviceId });
    expect(await back.next("TV_WELCOME")).toMatchObject({ paired: true, following: expect.stringMatching(/^TV /) });
    expect((await back.next("TV_CMD")).command).toMatchObject({ type: "LOAD", startAt: 42 });
  });

  it("loads and stops the followers with the leader", async () => {
    const { phone } = await pairedSetup();
    const { tv2 } = await addTv(phone);
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    expect((await tv2.next("TV_CMD")).command).toEqual({ type: "LOAD", media });
    phone.send({ type: "CMD", command: { type: "STOP" } });
    expect((await tv2.next("TV_CMD")).command).toEqual({ type: "STOP" });
  });

  it("looks a link up once and gives every TV the video, with the spinner meanwhile", async () => {
    let lookups = 0;
    resolveImpl = async () => {
      lookups++;
      return { status: "success", resolver: "test", media };
    };
    const { tv, phone } = await pairedSetup();
    const { tv2 } = await addTv(phone);
    phone.send({ type: "PLAY_URL", url: "https://s.example/a", startAt: 30 });
    for (const screen of [tv, tv2]) {
      expect((await screen.next("TV_RESOLVING")).active).toBe(true);
      expect((await screen.next("TV_RESOLVING")).active).toBe(false);
      expect((await screen.next("TV_CMD")).command).toEqual({ type: "LOAD", media, startAt: 30 });
    }
    expect(lookups).toBe(1);
  });

  it("passes the leader's position on to the followers, and nothing while it is loading", async () => {
    const { tv, phone } = await pairedSetup();
    const { tv2 } = await addTv(phone);
    tv.send({ type: "TV_STATE", state: { state: "loading", currentTime: 0, duration: 0 } });
    tv.send({ type: "TV_STATE", state: { state: "playing", currentTime: 12.5, duration: 600, playbackRate: 1.25, stream: "/a.mp4" } });
    expect(await tv2.next("TV_SYNC")).toEqual({ type: "TV_SYNC", playing: true, time: 12.5, rate: 1.25, stream: "/a.mp4" });
    tv.send({ type: "TV_STATE", state: { state: "paused", currentTime: 13, duration: 600 } });
    expect(await tv2.next("TV_SYNC")).toEqual({ type: "TV_SYNC", playing: false, time: 13, rate: 1 });
    tv.send({ type: "TV_STATE", state: { state: "playing", currentTime: 14, duration: 600, buffering: true } });
    expect((await tv2.next("TV_SYNC")).playing).toBe(false); // the leader is waiting for data, so the others wait
  });

  it("does not let a follower's own position reach the phone or move the others", async () => {
    const { tv, phone } = await pairedSetup();
    const { tv2 } = await addTv(phone);
    const third = await addTv(phone);
    await phone.next("STATE").catch(() => undefined);
    tv2.send({ type: "TV_STATE", state: { state: "playing", currentTime: 99, duration: 600 } });
    await phone.expectNone((m) => m.type === "STATE" && m.state.currentTime === 99);
    await third.tv2.expectNone((m) => m.type === "TV_SYNC");
    await tv.expectNone((m) => m.type === "TV_SYNC");
  });

  it("ignores a follower that tries to choose what plays", async () => {
    let lookups = 0;
    resolveImpl = async () => {
      lookups++;
      return { status: "success", resolver: "test", media };
    };
    const { phone } = await pairedSetup();
    const { tv2 } = await addTv(phone);
    tv2.send({ type: "TV_PLAY_URL", url: "https://s.example/mine" });
    tv2.send({ type: "TV_NEXT_EPISODE" });
    await tv2.expectNone((m) => m.type === "TV_CMD" || m.type === "TV_RESOLVING");
    expect(lookups).toBe(0);
  });

  it("stops the followers when the leader gives up on a load, and ignores a follower that tries to", async () => {
    const { tv, phone } = await pairedSetup();
    const { tv2 } = await addTv(phone);
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    expect((await tv2.next("TV_CMD")).command.type).toBe("LOAD");

    tv2.send({ type: "TV_CANCEL" }); // it has no say in what plays
    await tv.expectNone((m) => m.type === "TV_CMD" && m.command.type === "STOP");
    await phone.expectNone((m) => m.type === "RESOLVE_STATUS");

    tv.send({ type: "TV_CANCEL" });
    expect((await tv2.next("TV_RESOLVING")).active).toBe(false);
    expect((await tv2.next("TV_CMD")).command.type).toBe("STOP");
  });

  it("lets the phone send a TV away, and a TV leave on its own", async () => {
    const { tv, phone } = await pairedSetup();
    const first = await addTv(phone);
    const second = await addTv(phone);
    let { tvs } = await phone.next("PARTY"); // after the first
    ({ tvs } = await phone.next("PARTY")); // after the second
    expect(tvs).toHaveLength(2);

    phone.send({ type: "REMOVE_TV", id: tvs[0]!.id });
    expect((await first.tv2.next("TV_CMD")).command).toEqual({ type: "STOP" });
    expect((await first.tv2.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);
    expect((await phone.next("PARTY")).tvs).toHaveLength(1);

    second.tv2.send({ type: "TV_UNPAIR" });
    expect((await second.tv2.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);
    expect((await phone.next("PARTY")).tvs).toEqual([]);
    await tv.expectNone((m) => m.type === "TV_UNPAIRED");
  });

  it("ends the party for everyone when the phone lets go of its TV, or that TV lets go of the phone", async () => {
    const one = await pairedSetup();
    const a = await addTv(one.phone);
    one.phone.send({ type: "UNPAIR" });
    expect((await a.tv2.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);

    const two = await pairedSetup();
    const b = await addTv(two.phone);
    two.tv.send({ type: "TV_UNPAIR" });
    expect((await b.tv2.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);
  });

  it("tells a phone that reconnects who is in the party", async () => {
    const { phone, controllerId } = await pairedSetup();
    await addTv(phone);
    const again = await connect();
    again.send({ type: "CTL_HELLO", controllerId });
    expect((await again.next("CTL_WELCOME")).party).toHaveLength(1);
  });

  it("checks the code like a pairing code: wrong ones are counted, and there must be a TV to add to", async () => {
    const { phone } = await pairedSetup();
    phone.send({ type: "ADD_TV", code: "000000" });
    expect((await phone.next("ERROR")).code).toBe("INVALID_CODE");

    const loner = await connect();
    loner.send({ type: "CTL_HELLO" });
    await loner.next("CTL_WELCOME");
    loner.send({ type: "ADD_TV", code: "000000" });
    expect((await loner.next("ERROR")).code).toBe("NOT_PAIRED");
  });

  it("turns away a TV that hosts a party of its own, and takes it once that party is over", async () => {
    const { phone } = await pairedSetup();
    const host = await connect();
    host.send({ type: "TV_HELLO" });
    const welcome = await host.next("TV_WELCOME");
    host.send({ type: "TV_PARTY_OPEN" });
    const partyCode = (await host.next("TV_PARTY")).party!.code!.code;
    const guest = await connect();
    guest.send({ type: "TV_HELLO" });
    await guest.next("TV_WELCOME");
    guest.send({ type: "TV_PARTY_JOIN", code: partyCode });
    await guest.next("TV_FOLLOWING");

    phone.send({ type: "ADD_TV", code: welcome.pairing!.code });
    expect((await phone.next("ERROR")).code).toBe("TV_HOSTING");

    host.send({ type: "TV_PARTY_CLOSE" });
    await host.nextWhere("TV_PARTY", (message) => message.party === null);
    phone.send({ type: "ADD_TV", code: welcome.pairing!.code });
    await host.next("TV_FOLLOWING");
  });

  it("has room for a limited party", async () => {
    const { phone, deviceId } = await pairedSetup();
    for (let i = 0; i < 5; i++) await addTv(phone);
    const extra = await connect();
    extra.send({ type: "TV_HELLO" });
    const welcome = await extra.next("TV_WELCOME");
    phone.send({ type: "ADD_TV", code: welcome.pairing!.code });
    expect((await phone.next("ERROR")).code).toBe("PARTY_FULL");
  });
});

describe("a watch party started on a TV", () => {
  /** A TV that has said hello and is on its own: no phone, no party. */
  async function newTv() {
    const tv = await connect();
    tv.send({ type: "TV_HELLO" });
    const welcome = await tv.next("TV_WELCOME");
    return { tv, welcome };
  }
  /** A TV with no phone that opened a party, and the code it was given. */
  async function openParty() {
    const host = await newTv();
    host.tv.send({ type: "TV_PARTY_OPEN" });
    const view = (await host.tv.next("TV_PARTY")).party!;
    return { ...host, code: view.code!.code };
  }
  /** A TV that typed `code` and is now in the party. */
  async function joinWith(code: string) {
    const guest = await newTv();
    guest.tv.send({ type: "TV_PARTY_JOIN", code });
    await guest.tv.next("TV_FOLLOWING");
    return guest;
  }

  it("gives a TV with no phone a code, and puts every TV that types it in the party with a view of who is there", async () => {
    const host = await newTv();
    host.tv.send({ type: "TV_PARTY_OPEN" });
    const opened = (await host.tv.next("TV_PARTY")).party!;
    expect(opened).toMatchObject({ role: "host", guests: [], host: { online: true } });
    expect(opened.code?.code).toMatch(/^\d{6}$/);
    expect(opened.you).toBe(opened.host.id);
    expect(JSON.stringify(opened)).not.toContain("tv_"); // a TV's own id never reaches another screen

    const guest = await newTv();
    guest.tv.send({ type: "TV_PARTY_JOIN", code: opened.code!.code });
    expect(await guest.tv.next("TV_FOLLOWING")).toMatchObject({ leader: expect.stringMatching(/^TV /) });
    const seen = (await guest.tv.next("TV_PARTY")).party!;
    expect(seen).toMatchObject({ role: "guest", host: opened.host });
    expect(seen.code).toBeUndefined(); // only the host is given the code to hand out
    expect(seen.guests).toHaveLength(1);
    expect(seen.you).toBe(seen.guests[0]!.id);

    const second = await joinWith(opened.code!.code); // the code serves everyone
    const twoGuests = (message: { party: { guests: unknown[] } | null }) => message.party?.guests.length === 2;
    expect((await second.tv.nextWhere("TV_PARTY", twoGuests)).party).toMatchObject({ role: "guest" });
    expect((await host.tv.nextWhere("TV_PARTY", twoGuests)).party).toMatchObject({ role: "host", code: { code: opened.code!.code } });
  });

  it("carries what the host plays to the guests: the video, its place, its speed, and its stopping", async () => {
    resolveImpl = async () => ({ status: "success", resolver: "test", media });
    const host = await openParty();
    const guest = await joinWith(host.code);

    host.tv.send({ type: "TV_PLAY_URL", url: "https://s.example/a" });
    expect((await guest.tv.next("TV_RESOLVING")).active).toBe(true);
    expect((await guest.tv.next("TV_RESOLVING")).active).toBe(false);
    expect((await guest.tv.next("TV_CMD")).command).toEqual({ type: "LOAD", media });

    host.tv.send({ type: "TV_STATE", state: { state: "playing", currentTime: 61, duration: 600, playbackRate: 1.5, stream: media.stream.url } });
    expect(await guest.tv.next("TV_SYNC")).toEqual({ type: "TV_SYNC", playing: true, time: 61, rate: 1.5, stream: media.stream.url });
    host.tv.send({ type: "TV_STATE", state: { state: "paused", currentTime: 62, duration: 600, stream: media.stream.url } });
    expect((await guest.tv.next("TV_SYNC")).playing).toBe(false);

    host.tv.send({ type: "TV_STATE", state: { state: "idle", currentTime: 0, duration: 0 } }); // the host stops
    expect((await guest.tv.next("TV_CMD")).command).toEqual({ type: "STOP" });

    // someone joining later gets nothing to play until the host starts something again
    const late = await joinWith(host.code);
    await late.tv.expectNone((m) => m.type === "TV_CMD");
  });

  it("brings a guest that joins in the middle of a film to where the host is", async () => {
    resolveImpl = async () => ({ status: "success", resolver: "test", media });
    const host = await openParty();
    host.tv.send({ type: "TV_PLAY_URL", url: "https://s.example/a" });
    await host.tv.next("TV_CMD");
    host.tv.send({ type: "TV_STATE", state: { state: "playing", currentTime: 90.9, duration: 600, stream: media.stream.url } });

    const guest = await newTv();
    guest.tv.send({ type: "TV_PARTY_JOIN", code: host.code });
    expect((await guest.tv.next("TV_CMD")).command).toEqual({ type: "LOAD", media, startAt: 90 });
  });

  it("calls a screen by the name it gave, cleaned up, and by its own name when it gave none", async () => {
    const host = await openParty();
    host.tv.send({ type: "TV_NAME", name: "  Alex \n the   host " });
    expect((await host.tv.next("TV_PARTY")).party!.host.name).toBe("Alex the host");

    const guest = await joinWith(host.code);
    const first = (await guest.tv.next("TV_PARTY")).party!;
    expect(first.host.name).toBe("Alex the host");
    expect(first.guests[0]!.name).toMatch(/^TV /);
    await host.tv.next("TV_PARTY"); // the guest arriving

    guest.tv.send({ type: "TV_NAME", name: "Maria" });
    const renamed = (await host.tv.next("TV_PARTY")).party!;
    expect(renamed.guests[0]!.name).toBe("Maria");
    guest.tv.send({ type: "TV_NAME", name: "" });
    expect((await host.tv.next("TV_PARTY")).party!.guests[0]!.name).toMatch(/^TV /);

    // someone who comes back to a party is told the host by that name as well
    const back = await connect();
    back.send({ type: "TV_HELLO", deviceId: guest.welcome.deviceId });
    expect(await back.next("TV_WELCOME")).toMatchObject({ paired: true, following: "Alex the host" });
  });

  it("tells everyone when a screen goes offline, and gives it its place back when it returns", async () => {
    const host = await openParty();
    const guest = await joinWith(host.code);
    await host.tv.next("TV_PARTY"); // the guest joining
    guest.tv.close();
    expect((await host.tv.next("TV_PARTY")).party!.guests[0]!.online).toBe(false);

    const back = await connect();
    back.send({ type: "TV_HELLO", deviceId: guest.welcome.deviceId });
    expect(await back.next("TV_WELCOME")).toMatchObject({ paired: true, following: expect.stringMatching(/^TV /) });
    expect((await back.next("TV_PARTY")).party).toMatchObject({ role: "guest", guests: [{ online: true }] });

    host.tv.close();
    expect((await back.next("TV_PARTY")).party!.host.online).toBe(false);
  });

  it("turns away what cannot join: a wrong code (counted), a TV with a phone, a TV with guests, a full party", async () => {
    const host = await openParty();

    const stranger = await newTv();
    stranger.tv.send({ type: "TV_PARTY_JOIN", code: "000000" });
    expect((await stranger.tv.next("ERROR")).code).toBe("INVALID_CODE");

    const { tv: withPhone, phone } = await pairedSetup();
    withPhone.send({ type: "TV_PARTY_JOIN", code: host.code });
    expect((await withPhone.next("ERROR")).code).toBe("HAS_PHONE");
    await phone.expectNone((m) => m.type === "ERROR");

    const other = await openParty();
    await joinWith(other.code);
    other.tv.send({ type: "TV_PARTY_JOIN", code: host.code });
    expect((await other.tv.next("ERROR")).code).toBe("HOSTING");

    for (let i = 0; i < 5; i++) await joinWith(host.code);
    const extra = await newTv();
    extra.tv.send({ type: "TV_PARTY_JOIN", code: host.code });
    expect((await extra.tv.next("ERROR")).code).toBe("PARTY_FULL");
  });

  it("pauses code guessing once too many wrong ones were tried, even for a right one", async () => {
    const host = await openParty();
    const stranger = await newTv();
    for (let i = 0; i < 20; i++) stranger.tv.send({ type: "TV_PARTY_JOIN", code: "000000" });
    for (let i = 0; i < 20; i++) expect((await stranger.tv.next("ERROR")).code).toBe("INVALID_CODE");
    stranger.tv.send({ type: "TV_PARTY_JOIN", code: host.code });
    expect((await stranger.tv.next("ERROR")).code).toBe("RATE_LIMITED");
  });

  it("lets a guest leave, the host send one away, and the host end the party; each goes back to a TV of its own", async () => {
    const host = await openParty();
    const a = await joinWith(host.code);
    const b = await joinWith(host.code);
    const c = await joinWith(host.code);
    for (let i = 0; i < 3; i++) await host.tv.next("TV_PARTY"); // the three arriving
    const gone = (message: { party: unknown }) => message.party === null;

    a.tv.send({ type: "TV_UNPAIR" }); // leaves
    expect((await a.tv.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);
    await a.tv.nextWhere("TV_PARTY", gone);
    let view = (await host.tv.next("TV_PARTY")).party!;
    expect(view.guests).toHaveLength(2);

    host.tv.send({ type: "TV_PARTY_REMOVE", id: view.guests[0]!.id }); // sent away
    expect((await b.tv.next("TV_CMD")).command).toEqual({ type: "STOP" });
    await b.tv.nextWhere("TV_PARTY", gone);
    view = (await host.tv.next("TV_PARTY")).party!;
    expect(view.guests).toHaveLength(1);

    c.tv.send({ type: "TV_PARTY_REMOVE", id: view.guests[0]!.id }); // a guest cannot send anyone away, itself included
    await c.tv.expectNone((m) => m.type === "TV_UNPAIRED");
    await host.tv.expectNone((m) => m.type === "TV_PARTY");

    host.tv.send({ type: "TV_PARTY_CLOSE" }); // ended
    expect((await c.tv.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);
    await host.tv.nextWhere("TV_PARTY", gone);

    const late = await newTv();
    late.tv.send({ type: "TV_PARTY_JOIN", code: host.code }); // the code ended with the party
    expect((await late.tv.next("ERROR")).code).toBe("INVALID_CODE");
  });

  it("is ended for the guests by a host that lets go of its pairing", async () => {
    const host = await openParty();
    const guest = await joinWith(host.code);
    host.tv.send({ type: "TV_UNPAIR" });
    expect((await guest.tv.next("TV_UNPAIRED")).pairing?.code).toMatch(/^\d{6}$/);
    await guest.tv.nextWhere("TV_PARTY", (message) => message.party === null);
  });

  it("is something a guest cannot open for itself", async () => {
    const host = await openParty();
    const guest = await joinWith(host.code);
    await guest.tv.next("TV_PARTY");
    guest.tv.send({ type: "TV_PARTY_OPEN" });
    await guest.tv.expectNone((m) => m.type === "TV_PARTY" && m.party?.role === "host");
  });

  it("is also opened from the phone of a TV: the code and the guests come to the phone, and it controls them all", async () => {
    const { tv, phone } = await pairedSetup();
    phone.send({ type: "OPEN_PARTY" });
    const opened = await phone.next("PARTY");
    expect(opened.tvs).toEqual([]);
    expect(opened.code?.code).toMatch(/^\d{6}$/);
    expect((await tv.next("TV_PARTY")).party).toMatchObject({ role: "host" });

    const guest = await joinWith(opened.code!.code);
    expect((await phone.next("PARTY")).tvs).toHaveLength(1);
    phone.send({ type: "CMD", command: { type: "LOAD", media } });
    expect((await guest.tv.next("TV_CMD")).command).toEqual({ type: "LOAD", media });

    const loner = await connect();
    loner.send({ type: "CTL_HELLO" });
    await loner.next("CTL_WELCOME");
    loner.send({ type: "OPEN_PARTY" });
    expect((await loner.next("ERROR")).code).toBe("NOT_PAIRED");
  });
});

describe("several phones controlling one TV session", () => {
  it("allows multiple phones to join via control code and synchronizes playback", async () => {
    const { tv, phone, controllerId } = await pairedSetup();
    phone.send({ type: "CTL_HELLO", controllerId });
    const phone1Welcome = await phone.next("CTL_WELCOME");
    const controlCode = phone1Welcome.tv?.controlCode;
    expect(controlCode).toMatch(/^\d{6}$/);
    expect(phone1Welcome.tv?.controllerCount).toBe(1);

    // Second phone connects using the controlCode
    const phone2 = await connect();
    phone2.send({ type: "CTL_HELLO" });
    await phone2.next("CTL_WELCOME");
    phone2.send({ type: "PAIR", code: controlCode! });

    const phone2Welcome = await phone2.next("CTL_WELCOME");
    expect(phone2Welcome.tv?.online).toBe(true);
    expect(phone2Welcome.tv?.controllerCount).toBe(2);

    // Phone 1 receives updated welcome reflecting 2 controllers
    const phone1Update = await phone.next("CTL_WELCOME");
    expect(phone1Update.tv?.controllerCount).toBe(2);

    // TV reports playback state - both phones should receive it
    tv.send({ type: "TV_STATE", state: { state: "playing", currentTime: 42, duration: 300 } });
    const p1State = await phone.next("STATE");
    const p2State = await phone2.next("STATE");
    expect(p1State.state.currentTime).toBe(42);
    expect(p2State.state.currentTime).toBe(42);

    // Phone 2 unpairs - TV remains paired to Phone 1
    phone2.send({ type: "UNPAIR" });
    const p2Unpaired = await phone2.next("CTL_WELCOME");
    expect(p2Unpaired.tv).toBeNull();

    // Phone 1 updated back to 1 controller
    const p1After = await phone.next("CTL_WELCOME");
    expect(p1After.tv?.controllerCount).toBe(1);
    expect(p1After.tv?.online).toBe(true);
  });

  it("gives a TV that has a phone the code that lets another one in, whenever it asks, and tells it when one comes", async () => {
    const { tv, phone, controllerId } = await pairedSetup();
    phone.send({ type: "CTL_HELLO", controllerId });
    const controlCode = (await phone.next("CTL_WELCOME")).tv?.controlCode;

    tv.send({ type: "TV_NEW_CODE" });
    const answer = await tv.next("TV_CODE");
    expect(answer.control).toBe(true);
    expect(answer.pairing.code).toBe(controlCode); // the one the first phone's menu shows, too
    expect(answer.pairing.expiresInMs).toBeGreaterThan(0);

    const second = await connect();
    second.send({ type: "CTL_HELLO" });
    await second.next("CTL_WELCOME");
    second.send({ type: "PAIR", code: answer.pairing.code });
    expect((await second.next("CTL_WELCOME")).tv?.controllerCount).toBe(2);
    await tv.next("TV_PAIRED"); // another phone is news to the TV, not only the first
  });

  it("gives a TV without a phone a pairing code when it asks, never a control code", async () => {
    const tv = await connect();
    tv.send({ type: "TV_HELLO" });
    const welcome = await tv.next("TV_WELCOME");
    tv.send({ type: "TV_NEW_CODE" });
    const answer = await tv.next("TV_CODE");
    expect(answer.control).toBeUndefined();
    expect(answer.pairing.code).toBe(welcome.pairing?.code);
  });

  it("stops offering a code once the phone has let the TV go", async () => {
    const { tv, phone, controllerId } = await pairedSetup();
    phone.send({ type: "CTL_HELLO", controllerId });
    await phone.next("CTL_WELCOME");
    phone.send({ type: "UNPAIR" });
    await tv.next("TV_UNPAIRED");
    tv.send({ type: "TV_NEW_CODE" });
    expect((await tv.next("TV_CODE")).control).toBeUndefined(); // free again: it is a pairing code that is offered
  });
});
