const RELOADED_KEY = "kino.reloadedForScript";
const RELOAD_GAP_MS = 60_000;

export function scriptIsMissing(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /dynamically imported module|importing a module script failed|ChunkLoadError|loading chunk .* failed/i.test(text);
}

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
