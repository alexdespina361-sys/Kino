/** Kept for the length of one visit: when this page last started itself again because a script of it could not be fetched. */
const RELOADED_KEY = "kino.reloadedForScript";
/** A page that did so less than this ago does not do it again: the script is not coming, and going round and round would be worse than saying so. */
const RELOAD_GAP_MS = 60_000;

/**
 * Whether `error` is the browser saying that a script of this page could not be fetched (the connection blinked as the page opened, or the page was left open
 * across a new version and the file it asks for is no longer there). Chrome, Firefox and Safari word it differently.
 */
export function scriptIsMissing(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /dynamically imported module|importing a module script failed|ChunkLoadError|loading chunk .* failed/i.test(text);
}

/**
 * Starts the page again, once in a minute, because a script of it could not be fetched: a page left open across a new version has the new one's files after that,
 * and one that opened as the connection blinked tries again. True when it did; false when it did so a minute ago already (or the browser keeps nothing to tell
 * by), and then it is the page's to say that it could not be loaded.
 */
export function reloadForScript(reload: () => void = () => location.reload(), now: number = Date.now(), storage?: Pick<Storage, "getItem" | "setItem">): boolean {
  try {
    const kept = storage ?? sessionStorage;
    const last = Number(kept.getItem(RELOADED_KEY));
    if (last > 0 && now - last < RELOAD_GAP_MS) return false;
    kept.setItem(RELOADED_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}
