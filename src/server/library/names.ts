import { z } from "zod";
import { NAME_ID, NAME_LANGUAGES, type LocalName, type NameLanguage } from "../../shared";
import { remember } from "../boundedMap";
import { providerFetch } from "../resolvers/providerFetch";
import { FILMPIRE_TMDB_API_KEY } from "./filmpire";

/**
 * The names of titles in a viewer's language (shared/names.ts): one question to the movie database for each title and language, kept for a week,
 * for so many titles; a title asked about by two pages at once is asked once. Only so many questions go out at a time, and a page's question waits
 * only so long: what was not answered in time is left out of the answer (the page asks again), and is still asked and kept for the next one.
 */

const BASE_URL = "https://api.themoviedb.org/3";
/** How long a name is kept, and how many (a name and a description: under a kilobyte each). */
export const NAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NAMES_KEPT = 20_000;
/** How many questions are at the movie database at once, and how long one may take. */
const AT_ONCE = 8;
const ASK_TIMEOUT_MS = 6_000;
/** How long a page's question waits for what is not kept yet. */
export const NAMES_WAIT_MS = 5_000;

const DocSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  original_language: z.string().optional(),
  overview: z.string().nullish(),
});

/**
 * What the movie database's answer in a language says of a title's name there. Asked in a language it has no name in, it gives the original one:
 * the Japanese of an anime nobody translated, where the English name is what a viewer can read. So a name that is only the original is no name,
 * unless the title was made in that language (a Romanian film's own name is its Romanian one).
 */
export function localNameOf(raw: unknown, lang: NameLanguage): LocalName {
  const parsed = DocSchema.safeParse(raw);
  if (!parsed.success) return {};
  const doc = parsed.data;
  const said = (doc.title || doc.name || "").trim();
  const original = (doc.original_title || doc.original_name || "").trim();
  const title = doc.original_language === lang ? original || said : said && said !== original ? said : "";
  const description = (doc.overview ?? "").trim();
  return { ...(title ? { title: title.slice(0, 300) } : {}), ...(description ? { description: description.slice(0, 400) } : {}) };
}

export interface NameBookOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  now?: () => number;
  /** How long a question waits for what is not kept (NAMES_WAIT_MS unless set). */
  waitMs?: number;
}

export interface NameBook {
  /** Whether a title's name in a language is kept (no question would go out for it). */
  has(lang: NameLanguage, id: string): boolean;
  /**
   * The names of `ids` (each `movie-603` or `tv-1399`) in `lang`. `mayAsk` says, for each title that is not kept, whether it may be asked about now
   * (the address's allowance): one that may not is left out, as one that was not answered in time is.
   */
  of(lang: NameLanguage, ids: readonly string[], mayAsk?: (id: string) => boolean): Promise<Record<string, LocalName>>;
}

export function createNameBook(options: NameBookOptions = {}): NameBook {
  const get = options.fetch ?? providerFetch();
  const apiKey = options.apiKey ?? FILMPIRE_TMDB_API_KEY;
  const now = options.now ?? Date.now;
  const waitMs = options.waitMs ?? NAMES_WAIT_MS;
  const kept = new Map<string, { at: number; name: LocalName }>();
  const asking = new Map<string, Promise<LocalName | null>>();
  let running = 0;
  const waiting: Array<() => void> = [];

  const turn = async (): Promise<() => void> => {
    if (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
    else running += 1;
    return () => {
      const next = waiting.shift();
      if (next) next(); // (its turn is this one's, handed on)
      else running -= 1;
    };
  };

  const fresh = (key: string): LocalName | undefined => {
    const entry = kept.get(key);
    return entry && now() - entry.at < NAME_TTL_MS ? entry.name : undefined;
  };

  /** One title's name, asked of the movie database: null when it could not be reached just now (nothing is kept, and it is asked again). */
  const ask = (lang: NameLanguage, id: string): Promise<LocalName | null> => {
    const key = `${lang}|${id}`;
    const already = asking.get(key);
    if (already) return already;
    const [, type, number] = NAME_ID.exec(id)!;
    const question = (async () => {
      const done = await turn();
      try {
        const res = await get(`${BASE_URL}/${type}/${number}?api_key=${apiKey}&language=${NAME_LANGUAGES[lang]}`, { signal: AbortSignal.timeout(ASK_TIMEOUT_MS), headers: { accept: "application/json" } });
        // (A title the movie database does not know has no name there: an answer, kept as one.)
        if (res.status !== 404 && !res.ok) return null;
        const name = res.status === 404 ? {} : localNameOf(await res.json(), lang);
        remember(kept, key, { at: now(), name }, NAMES_KEPT);
        return name;
      } catch {
        return null;
      } finally {
        done();
        asking.delete(key);
      }
    })();
    asking.set(key, question);
    return question;
  };

  return {
    has: (lang, id) => fresh(`${lang}|${id}`) !== undefined,
    async of(lang, ids, mayAsk = () => true) {
      const names: Record<string, LocalName> = {};
      const asked: Array<Promise<void>> = [];
      for (const id of new Set(ids)) {
        if (!NAME_ID.test(id)) continue;
        const known = fresh(`${lang}|${id}`);
        if (known) names[id] = known;
        else if (asking.has(`${lang}|${id}`) || mayAsk(id)) {
          asked.push(
            ask(lang, id).then((name) => {
              if (name) names[id] = name;
            }),
          );
        }
      }
      if (asked.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<void>((over) => {
          timer = setTimeout(over, waitMs);
          timer.unref?.();
        });
        await Promise.race([Promise.all(asked), late]);
        clearTimeout(timer);
      }
      return { ...names }; // (a copy: an answer that comes after the wait is kept, but not added to what was sent)
    },
  };
}
