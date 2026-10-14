import { LibrarySchema, type Library } from "../../shared/library";
import { readStorage, writeStorage } from "./format";

export const LIBRARY_CACHE_KEY = "kino.cache.library";
/** Keep the cached library for 45 minutes before considering it stale for initial load. */
export const LIBRARY_CACHE_TTL_MS = 45 * 60 * 1000;

interface CacheRecord {
  time: number;
  data: unknown;
}

/**
 * Reads the cached library from browser localStorage if present and not expired.
 * This ensures returning visitors and page refreshes render instantly with 0 network bytes.
 */
export function getCachedLibrary(): Library | null {
  const raw = readStorage(LIBRARY_CACHE_KEY);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as CacheRecord;
    if (typeof record.time === "number" && Date.now() - record.time < LIBRARY_CACHE_TTL_MS) {
      const parsed = LibrarySchema.safeParse(record.data);
      if (parsed.success) return parsed.data;
    }
  } catch {
    /* corrupt cache entry is ignored */
  }
  return null;
}

/**
 * Saves fresh library data to localStorage.
 */
export function setCachedLibrary(library: Library): void {
  try {
    writeStorage(LIBRARY_CACHE_KEY, JSON.stringify({ time: Date.now(), data: library }));
  } catch {
    /* storage quota exceeded or unavailable */
  }
}
