import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { isPublicAddress } from "./ip";

export type FetchFailure = "invalid_url" | "blocked" | "timeout" | "network" | "too_many_redirects" | "bad_status";

export class SafeFetchError extends Error {
  constructor(
    readonly code: FetchFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  /** Whole-request budget including redirects. */
  timeoutMs?: number;
  /** Body bytes kept; the rest is dropped (the page is parsed from what we have). */
  maxBytes?: number;
  maxRedirects?: number;
  /** Address policy. Default: public internet only. Tests/dev may widen it; production never should. */
  isAllowedAddress?: (address: string) => boolean;
  userAgent?: string;
  /** Headers to send besides the usual ones (a referer, a cookie the other end asks for). A cookie or an authorization header is not passed on to another origin when a redirect leads there. */
  headers?: Record<string, string>;
  /** Read the body whatever its type, and hand it over as `bytes` (default: only text is read; any other type is reported and not downloaded). */
  anyType?: boolean;
  /** Ends the request when it aborts, as the timeout does. */
  signal?: AbortSignal;
}

export interface FetchedPage {
  /** URL after redirects. */
  url: URL;
  status: number;
  /** Lower-cased media type without parameters, e.g. "text/html". */
  contentType: string;
  /** Empty for non-text responses (we never download media bodies). */
  body: string;
  truncated: boolean;
  /** What was read, for `anyType` only. */
  bytes?: Buffer;
}

export type SafeFetch = (url: string | URL, options?: SafeFetchOptions) => Promise<FetchedPage>;

const DEFAULTS = { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 5 };
const TEXT_TYPES = /^(text\/|application\/(json|ld\+json|xhtml\+xml|xml|javascript|x-javascript))/;

/** Throws unless the URL is a plain http(s) URL pointing at an allowed address literal or a hostname. */
export function assertAllowedUrl(url: URL, isAllowedAddress: (a: string) => boolean = isPublicAddress): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("invalid_url", "only http(s)");
  if (url.username || url.password) throw new SafeFetchError("invalid_url", "credentials in URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // WHATWG URL already canonicalises 2130706433 / 0x7f.1 / 017700000001 to 127.0.0.1, so literals are checked as-is.
  if (isIP(host) && !isAllowedAddress(host)) throw new SafeFetchError("blocked", "address not allowed");
  if (!host) throw new SafeFetchError("invalid_url", "no host");
}

/**
 * DNS lookup that refuses to hand out disallowed addresses. It runs at connect time for every hop,
 * so a hostname that resolves to a private IP (or flips there later, "DNS rebinding") never connects.
 */
export function guardedLookup(isAllowedAddress: (a: string) => boolean): net_lookup {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 4);
      if (addresses.length === 0 || addresses.some((a) => !isAllowedAddress(a.address))) {
        return callback(new SafeFetchError("blocked", "address not allowed") as NodeJS.ErrnoException, "", 4);
      }
      // Prefer IPv4 addresses so machines without working IPv6 routes connect reliably without timing out
      addresses.sort((a, b) => {
        if (a.family === b.family) return 0;
        return a.family === 4 ? -1 : 1;
      });
      if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}
export type net_lookup = (
  hostname: string,
  options: dns.LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => void;

function get(url: URL, headers: Record<string, string>, lookup: net_lookup, signal: AbortSignal): Promise<http.IncomingMessage> {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: "GET", headers, lookup, signal }, resolve);
    req.on("error", reject);
    req.end();
  });
}

export const safeFetch: SafeFetch = async (input, options = {}) => {
  // (An option that is given as `undefined` is no option: it must not take the bound away.)
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const isAllowedAddress = options.isAllowedAddress ?? isPublicAddress;
  const lookup = guardedLookup(isAllowedAddress);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    throw new SafeFetchError("invalid_url", "not a URL");
  }

  let headers: Record<string, string> = {
    "user-agent": options.userAgent ?? "Mozilla/5.0 (compatible; PhoneToTvResolver/0.1)",
    accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
    "accept-language": "en",
    "accept-encoding": "identity", // no decompression-bomb surface
  };
  for (const [name, value] of Object.entries(options.headers ?? {})) headers[name.toLowerCase()] = value;
  headers["accept-encoding"] = "identity";

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      assertAllowedUrl(url, isAllowedAddress);
      const res = await get(url, headers, lookup, controller.signal);

      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.destroy(); // (not read to its end: a body that never ends would hold the connection for ever, once the time above is cleared)
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new SafeFetchError("invalid_url", "bad redirect");
        }
        if (next.origin !== url.origin) headers = withoutCredentials(headers);
        url = next;
        continue;
      }
      if (status >= 400) {
        res.destroy(); // (likewise)
        throw new SafeFetchError("bad_status", `HTTP ${status}`, status);
      }

      const contentType = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      const textual = TEXT_TYPES.test(contentType);
      if (!textual && !options.anyType) {
        res.destroy(); // media / binary: report the type, never download it
        return { url, status, contentType, body: "", truncated: false };
      }
      const read = await readCapped(res, maxBytes);
      return { url, status, contentType, body: textual ? read.bytes.toString("utf8") : "", truncated: read.truncated, ...(options.anyType ? { bytes: read.bytes } : {}) };
    }
    throw new SafeFetchError("too_many_redirects", "too many redirects");
  } catch (error) {
    throw normalize(error, controller.signal);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
};

/** What was asked with a cookie or a login stays with the origin it was asked of: a redirect to another does not carry it along. */
function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  const { cookie: _cookie, authorization: _authorization, ...rest } = headers;
  return rest;
}

function readCapped(res: http.IncomingMessage, maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (truncated: boolean) => {
      if (done) return;
      done = true;
      resolve({ bytes: Buffer.concat(chunks), truncated });
    };
    res.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
        res.destroy();
        return finish(true);
      }
      chunks.push(chunk);
    });
    res.on("end", () => finish(false));
    res.on("close", () => finish(false));
    res.on("error", (error) => !done && reject(error));
  });
}

function normalize(error: unknown, signal: AbortSignal): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  if (signal.aborted) return new SafeFetchError("timeout", "timed out");
  const cause = (error as { cause?: unknown })?.cause;
  if (cause instanceof SafeFetchError) return cause; // surfaced from the guarded lookup
  if (error instanceof Error && error.message.includes("address not allowed")) return new SafeFetchError("blocked", "address not allowed");
  return new SafeFetchError("network", error instanceof Error ? error.message : "network error");
}
