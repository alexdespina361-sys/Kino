import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** scrypt, from Node itself: slow on purpose, so a stolen list of hashes cannot be tried at speed. */
export interface PasswordCost {
  N: number;
  r: number;
  p: number;
}
const COST: PasswordCost = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

const derive = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEY_LENGTH, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key))));

/** "scrypt$N$r$p$salt$hash": everything needed to check a password later, including how it was made. (Tests pass a cheaper `cost`.) */
export async function hashPassword(password: string, cost: PasswordCost = COST): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  return ["scrypt", cost.N, cost.r, cost.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  try {
    const key = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Something to check a password against when there is no such account, so a wrong e-mail takes as long as a wrong password. */
let decoy: Promise<string> | undefined;
export const decoyHash = () => (decoy ??= hashPassword(randomBytes(12).toString("hex")));
