import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const fcmSendUrl = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

const TIMEOUT_MS = 10_000;
const EARLY_MS = 5 * 60_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUrl: string;
  sendUrl: string;
  timeoutMs?: number;
}

export type PushResult = "sent" | "gone" | "failed";

export interface PushMessage {
  token?: string;
  topic?: string;
  data: Record<string, string>;
  collapseKey?: string;
  ttlSeconds?: number;
}

export interface PushSender {
  send(message: PushMessage): Promise<PushResult>;
}

export function fcmError(text: string): { status?: string; code?: string; message?: string } {
  try {
    const error = (JSON.parse(text) as { error?: { status?: unknown; message?: unknown; details?: unknown } }).error;
    if (!error || typeof error !== "object") return {};
    const details = Array.isArray(error.details) ? (error.details as { "@type"?: unknown; errorCode?: unknown }[]) : [];
    const fcm = details.find((detail) => typeof detail?.["@type"] === "string" && detail["@type"].endsWith("google.firebase.fcm.v1.FcmError"));
    return {
      ...(typeof error.status === "string" ? { status: error.status } : {}),
      ...(typeof fcm?.errorCode === "string" ? { code: fcm.errorCode } : {}),
      ...(typeof error.message === "string" ? { message: error.message.slice(0, 200) } : {}),
    };
  } catch {
    return {};
  }
}

export function tokenRefused(text: string): boolean {
  const { code, status, message } = fcmError(text);
  return code === "UNREGISTERED" || ((code === "INVALID_ARGUMENT" || status === "INVALID_ARGUMENT") && /registration token/i.test(message ?? ""));
}

const isLoopback = (address: string) => {
  try {
    const url = new URL(address);
    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK.has(url.hostname);
  } catch {
    return false;
  }
};

export function fcmFromEnv(env: NodeJS.ProcessEnv, warn: (message: string) => void = () => {}): FcmConfig | undefined {
  const file = env.FCM_SERVICE_ACCOUNT_FILE?.trim();
  if (!file) return undefined;
  let key: Record<string, unknown>;
  try {
    key = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    warn("FCM_SERVICE_ACCOUNT_FILE could not be read as a JSON key: the app's notifications are off.");
    return undefined;
  }
  const projectId = typeof key.project_id === "string" ? key.project_id : "";
  const clientEmail = typeof key.client_email === "string" ? key.client_email : "";
  const privateKey = typeof key.private_key === "string" ? key.private_key : "";
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) || !clientEmail.includes("@") || !privateKey.includes("PRIVATE KEY")) {
    warn("FCM_SERVICE_ACCOUNT_FILE is not a service account's key (project_id, client_email and private_key): the app's notifications are off.");
    return undefined;
  }
  const fake = (name: "FCM_TOKEN_URL" | "FCM_SEND_URL"): string | undefined => {
    const value = env[name]?.trim();
    if (!value) return undefined;
    if (env.ALLOW_PRIVATE_NETWORK === "1" && isLoopback(value)) return value;
    warn(`${name} is only for tests (ALLOW_PRIVATE_NETWORK=1 and an address on this machine): Google's own is used.`);
    return undefined;
  };
  return { projectId, clientEmail, privateKey, tokenUrl: fake("FCM_TOKEN_URL") ?? GOOGLE_OAUTH_TOKEN_URL, sendUrl: fake("FCM_SEND_URL") ?? fcmSendUrl(projectId) };
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function serviceJwt(config: Pick<FcmConfig, "clientEmail" | "privateKey" | "tokenUrl">, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({ iss: config.clientEmail, scope: FCM_SCOPE, aud: config.tokenUrl, iat, exp: iat + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(config.privateKey);
  return `${head}.${body}.${base64url(signature)}`;
}

export class FcmSender implements PushSender {
  private access: { token: string; until: number } | undefined;
  private asking: Promise<string | undefined> | undefined;

  constructor(
    private readonly config: FcmConfig,
    private readonly now: () => number = Date.now,
    private readonly log: { warn(message: string): void } = { warn: () => {} },
  ) {}

  private get timeout() {
    return AbortSignal.timeout(this.config.timeoutMs ?? TIMEOUT_MS);
  }

  private accessToken(): Promise<string | undefined> {
    if (this.access && this.access.until > this.now()) return Promise.resolve(this.access.token);
    this.asking ??= (async () => {
      try {
        const answer = await fetch(this.config.tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceJwt(this.config, this.now()) }).toString(),
          redirect: "error",
          signal: this.timeout,
        });
        if (!answer.ok) {
          this.log.warn(`Firebase: the token endpoint said ${answer.status}.`);
          return undefined;
        }
        const body = (await answer.json()) as { access_token?: unknown; expires_in?: unknown };
        if (typeof body.access_token !== "string") return undefined;
        const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
        this.access = { token: body.access_token, until: this.now() + seconds * 1000 - EARLY_MS };
        return body.access_token;
      } catch (error) {
        this.log.warn(`Firebase: no access token (${(error as Error).name}).`);
        return undefined;
      } finally {
        this.asking = undefined;
      }
    })();
    return this.asking;
  }

  async send(message: PushMessage): Promise<PushResult> {
    if (!message.token === !message.topic) return "failed";
    const access = await this.accessToken();
    if (!access) return "failed";
    const android = { priority: "high", ttl: `${message.ttlSeconds ?? 86_400}s`, ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}) };
    const target = message.token ? { token: message.token } : { topic: message.topic };
    try {
      const answer = await fetch(this.config.sendUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
        body: JSON.stringify({ message: { ...target, data: message.data, android } }),
        redirect: "error",
        signal: this.timeout,
      });
      if (answer.ok) return "sent";
      if (answer.status === 401) this.access = undefined;
      const text = await answer.text().catch(() => "");
      if (message.token && tokenRefused(text)) return "gone";
      this.log.warn(`Firebase: a message was refused (${answer.status}${fcmError(text).code ? ` ${fcmError(text).code}` : ""}).`);
      return "failed";
    } catch (error) {
      this.log.warn(`Firebase: a message was not sent (${(error as Error).name}).`);
      return "failed";
    }
  }
}
