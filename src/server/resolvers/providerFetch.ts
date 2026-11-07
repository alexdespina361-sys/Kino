import { noteUpstream, withLookupSignal } from "./lookup";
import { SafeFetchError, safeFetch, type FetchTiming, type SafeFetchOptions } from "./safe-fetch";

/** What one answer of a supported site may weigh. A longer one is cut off here: a cut list of titles or a cut module does not parse, a cut page has only less in it. */
export const PROVIDER_MAX_BYTES = 8 * 1024 * 1024;

export type ProviderFetchOptions = Pick<SafeFetchOptions, "isAllowedAddress" | "timeoutMs" | "connectTimeoutMs" | "idleTimeoutMs" | "maxBytes" | "maxRedirects">;

/** The statuses whose answer has no body (a `Response` with a body and one of these is an error; a 1xx never gets this far). */
const NO_BODY = new Set([204, 205, 304]);

/**
 * `fetch` for the sites this server is set up for (what the adapters ask them, and the library's sources). Their answers name the next address to ask (a
 * page of the player names its own player, a list names the module that decrypts it), so a question goes the way a link pasted by a visitor does (`safeFetch`): only to
 * public addresses, looked at again at every redirect and when the connection is made, with one time for all of it and a bound on what is read. The answer is
 * an ordinary `Response`, so whoever asks is written as for `fetch`. GET only: the sites are only ever read.
 *
 * A question asked as part of a look-up (see `lookup.ts`) is counted against it, by host and time, and ends with it: when the registry gives the look-up up,
 * every question still on its way is cut off.
 */
export function providerFetch(options: ProviderFetchOptions = {}): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? request?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const address = request?.url ?? String(input);
    const signal = withLookupSignal(init?.signal);
    const started = performance.now();
    const note = (timing?: FetchTiming) => {
      let host = "";
      try {
        host = new URL(address).hostname;
      } catch {
        /* not an address: `safeFetch` says so */
      }
      noteUpstream(host, performance.now() - started, timing);
    };
    try {
      const page = await safeFetch(address, {
        ...options,
        maxBytes: options.maxBytes ?? PROVIDER_MAX_BYTES,
        headers,
        anyType: true,
        ...(signal ? { signal } : {}),
      });
      note(page.timing);
      const body = page.bytes && !NO_BODY.has(page.status) ? new Uint8Array(page.bytes.buffer as ArrayBuffer, page.bytes.byteOffset, page.bytes.byteLength) : null;
      return new Response(body, { status: page.status, headers: { "content-type": page.contentType } });
    } catch (error) {
      note(error instanceof SafeFetchError ? error.timing : undefined);
      // (As with `fetch`, an answer that says no is an answer: whoever asks looks at `ok`. A place that cannot be reached, or may not be, throws.)
      if (error instanceof SafeFetchError && error.code === "bad_status") return new Response(null, { status: error.status ?? 502 });
      throw error;
    }
  };
}
