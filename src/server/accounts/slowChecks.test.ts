import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { MemoryPersistence } from "./persistence";
import { AccountStore } from "./store";

const cheap = { N: 1024, r: 8, p: 1 } as const;
const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

async function site(slowChecksPer15Min: number) {
  const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
  const app = await buildApp({ accounts, passwordCost: cheap, signUpsPerHour: 1000, slowChecksPer15Min });
  apps.push(app);
  const post = (url: string, payload: unknown, cookie?: string, remoteAddress = "203.0.113.7") =>
    app.inject({ method: "POST", url, payload: payload as object, headers: cookie ? { cookie } : {}, remoteAddress });
  const cookieOf = (response: { headers: Record<string, unknown> }) => String([response.headers["set-cookie"]].flat()[0]).split(";")[0]!;
  return { app, post, cookieOf };
}

describe("slow checks, counted per address before they are done", () => {
  it("lets a burst of sign-ins with made-up names reach the hash only as far as the allowance, however many are sent at once", async () => {
    const { post } = await site(5);
    const answers = await Promise.all(Array.from({ length: 40 }, (_, n) => post("/api/auth/login", { email: `nobody-${n}`, password: "not the password" })));
    const codes = answers.map((each) => each.statusCode);
    expect(codes.filter((code) => code === 401)).toHaveLength(5);
    expect(codes.filter((code) => code === 429)).toHaveLength(35);
    expect(Number(answers.find((each) => each.statusCode === 429)!.headers["retry-after"])).toBeGreaterThan(0);
    expect((await post("/api/auth/login", { email: "nobody", password: "not the password" }, undefined, "203.0.113.8")).statusCode).toBe(401);
  });

  it("counts the right ones too: signing in again and again with the right password is no way round it", async () => {
    const { post } = await site(4);
    expect((await post("/api/auth/register", { email: "alma", password: "a good password" })).statusCode).toBe(201);
    const codes: number[] = [];
    for (let n = 0; n < 6; n++) codes.push((await post("/api/auth/login", { email: "alma", password: "a good password" })).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 429, 429]);
  });

  it("counts the hash of a new PIN on an account that has none, and of a new password", async () => {
    const { post, cookieOf } = await site(3);
    const cookie = cookieOf(await post("/api/auth/register", { email: "boris", password: "a good password" }));
    const pins: number[] = [];
    for (let n = 0; n < 2; n++) pins.push((await post("/api/me/child-pin", { next: null }, cookie)).statusCode);
    expect(pins).toEqual([200, 200]);
    const sets: number[] = [];
    for (let n = 0; n < 3; n++) sets.push((await post("/api/me/child-pin", { next: "1234", ...(n > 0 ? { pin: "1234" } : {}) }, cookie)).statusCode);
    expect(sets).toEqual([200, 200, 429]);
    const other = "203.0.113.9";
    expect((await post("/api/me/password", { current: "a good password", next: "another password" }, cookie, other)).statusCode).toBe(204);
    expect((await post("/api/me/password", { current: "another password", next: "a third password" }, cookie, other)).statusCode).toBe(429);
  });
});
