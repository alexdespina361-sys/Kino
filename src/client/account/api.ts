import type { z } from "zod";
import {
  LinkOutcomeSchema,
  LinkStartedSchema,
  LinkViewSchema,
  MeSchema,
  SessionInfoSchema,
  SessionStateSchema,
  SyncResponseSchema,
  type AvatarId,
  type DeviceKind,
  type LinkOutcome,
  type Me,
  type SessionInfo,
  type SessionState,
  type SyncRequest,
  type SyncResponse,
} from "../../shared";

/** The server said no (or could not be reached: status 0). `code` is one of its short words, e.g. "invalid_credentials". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

async function request(method: string, url: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "offline");
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const error = (data as { error?: unknown; retryAfter?: unknown } | undefined) ?? {};
    throw new ApiError(response.status, typeof error.error === "string" ? error.error : `http_${response.status}`, typeof error.retryAfter === "number" ? error.retryAfter : undefined);
  }
  return data;
}

/** The answer, checked: a server that answers with something else is an older one, and is told apart from one that said no. */
async function ask<T>(schema: z.ZodType<T>, method: string, url: string, body?: unknown): Promise<T> {
  const parsed = schema.safeParse(await request(method, url, body));
  if (!parsed.success) throw new ApiError(502, "bad_response");
  return parsed.data;
}

const link = (code: string) => `/api/link/${encodeURIComponent(code)}`;

export const api = {
  /** Who is signed in. A 404 means this server has no accounts (an older one). */
  session: (): Promise<SessionState> => ask(SessionStateSchema, "GET", "/api/me"),
  register: (email: string, password: string, device: DeviceKind): Promise<Me> => ask(MeSchema, "POST", "/api/auth/register", { email, password, device }),
  login: (email: string, password: string, device: DeviceKind): Promise<Me> => ask(MeSchema, "POST", "/api/auth/login", { email, password, device }),
  logout: async (): Promise<void> => void (await request("POST", "/api/auth/logout", {})),

  addProfile: (name: string, avatar?: AvatarId): Promise<Me> => ask(MeSchema, "POST", "/api/profiles", { name, ...(avatar ? { avatar } : {}) }),
  updateProfile: (id: string, patch: { name?: string; avatar?: AvatarId }): Promise<Me> => ask(MeSchema, "PATCH", `/api/profiles/${encodeURIComponent(id)}`, patch),
  deleteProfile: (id: string): Promise<Me> => ask(MeSchema, "DELETE", `/api/profiles/${encodeURIComponent(id)}`),

  changePassword: async (current: string, next: string): Promise<void> => void (await request("POST", "/api/me/password", { current, next })),
  deleteAccount: async (password: string): Promise<void> => void (await request("POST", "/api/me/delete", { password })),

  sessions: (): Promise<SessionInfo[]> => ask(SessionInfoSchema.array(), "GET", "/api/sessions"),
  endSession: async (id: string): Promise<void> => void (await request("DELETE", `/api/sessions/${encodeURIComponent(id)}`)),
  endOtherSessions: async (): Promise<void> => void (await request("DELETE", "/api/sessions")),

  sync: (profileId: string, body: SyncRequest): Promise<SyncResponse> => ask(SyncResponseSchema, "POST", `/api/profiles/${encodeURIComponent(profileId)}/sync`, body),

  /** A TV that is not signed in asks for a code to show, then asks (with the secret it was given) whether a phone approved it. */
  linkStart: (device: DeviceKind) => ask(LinkStartedSchema, "POST", "/api/link/start", { device }),
  linkPoll: (code: string, secret: string): Promise<LinkOutcome> => ask(LinkOutcomeSchema, "POST", "/api/link/poll", { code, secret }),
  /** The signed-in phone looks at a request, then approves or refuses it. */
  linkView: (code: string) => ask(LinkViewSchema, "GET", link(code)),
  linkApprove: async (code: string): Promise<void> => void (await request("POST", `${link(code)}/approve`, {})),
  linkDeny: async (code: string): Promise<void> => void (await request("POST", `${link(code)}/deny`, {})),
};

/** The last thing the screen sends as it closes: what has not been sent yet. `sendBeacon` is the one request a closing page is allowed to finish. */
export function beaconSync(profileId: string, body: SyncRequest): boolean {
  try {
    return navigator.sendBeacon(`/api/profiles/${encodeURIComponent(profileId)}/sync`, new Blob([JSON.stringify(body)], { type: "application/json" }));
  } catch {
    return false;
  }
}
