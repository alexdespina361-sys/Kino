import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { MemoryPersistence } from "./persistence";
import { AccountStore } from "./store";

/** The whole site's sign-ups a day (accounts/routes.ts `DEFAULT_SIGNUPS_PER_DAY`), besides an address's few an hour. */

const cheap = { N: 1024, r: 8, p: 1 } as const;
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (apps.length) await apps.pop()!.close();
});

async function site(options: { signUpsPerDay?: number; maxAccounts?: number } = {}) {
  const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
  const app = await buildApp({ accounts, passwordCost: cheap, signUpsPerHour: 1000, ...options });
  apps.push(app);
  let address = 0;
  const register = (email: string, from = `198.51.100.${++address}`) => app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "a good password" }, remoteAddress: from });
  return { app, accounts, register };
}

describe("sign-ups for the whole site", () => {
  it("are so many a day, every address together; the next waits for midnight UTC, and a name that was taken does not use one up", async () => {
    let now = Date.parse("2026-11-18T20:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { register } = await site({ signUpsPerDay: 3 });
    expect((await register("ana")).statusCode).toBe(201);
    expect((await register("ana")).statusCode).toBe(409); // (taken: the site's day keeps its place)
    expect((await register("bo")).statusCode).toBe(201);
    expect((await register("cy")).statusCode).toBe(201);
    const over = await register("dee");
    expect(over.statusCode).toBe(429);
    expect(Number(over.headers["retry-after"])).toBe(4 * 3600);
    now = Date.parse("2026-11-19T00:00:00Z");
    expect((await register("dee")).statusCode).toBe(201);
  });

  it("are a hundred a day unless the host says otherwise", async () => {
    const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const app = await buildApp({ accounts, passwordCost: cheap });
    apps.push(app);
    const codes: number[] = [];
    for (let n = 0; n < 101; n++) codes.push((await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `p${n}`, password: "" }, remoteAddress: `2001:db8:${n}::1` })).statusCode);
    expect(codes.filter((code) => code === 201)).toHaveLength(100);
    expect(codes.at(-1)).toBe(429);
  }, 30_000);

  it("never end past the most accounts there may be, even when they are sent all at once", async () => {
    const { accounts, register } = await site({ maxAccounts: 3 });
    const codes = (await Promise.all(Array.from({ length: 8 }, (_, n) => register(`p${n}`)))).map((answer) => answer.statusCode);
    expect(codes.filter((code) => code === 201)).toHaveLength(3);
    expect(accounts.countAccounts()).toBe(3);
  });
});
