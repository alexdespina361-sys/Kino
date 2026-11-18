import { z } from "zod";
import { NAME_ID, NAME_LANGUAGES, type LocalName, type NameLanguage } from "../../shared";
import { remember } from "../boundedMap";
import { providerFetch } from "../resolvers/providerFetch";
import { FILMPIRE_TMDB_API_KEY } from "./filmpire";

const BASE_URL = "https://api.themoviedb.org/3";
export const NAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NAMES_KEPT = 20_000;
const AT_ONCE = 8;
const ASK_TIMEOUT_MS = 6_000;
export const NAMES_QUEUE_MAX = 400;
export const NAMES_WAIT_MS = 5_000;

const DocSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  original_language: z.string().optional(),
  overview: z.string().nullish(),
});

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
  waitMs?: number;
}

export interface NameBook {
  has(lang: NameLanguage, id: string): boolean;
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
      if (next) next();
      else running -= 1;
    };
  };

  const fresh = (key: string): LocalName | undefined => {
    const entry = kept.get(key);
    return entry && now() - entry.at < NAME_TTL_MS ? entry.name : undefined;
  };

  const ask = (lang: NameLanguage, id: string): Promise<LocalName | null> => {
    const key = `${lang}|${id}`;
    const already = asking.get(key);
    if (already) return already;
    const [, type, number] = NAME_ID.exec(id)!;
    const question = (async () => {
      const done = await turn();
      try {
        const res = await get(`${BASE_URL}/${type}/${number}?api_key=${apiKey}&language=${NAME_LANGUAGES[lang]}`, { signal: AbortSignal.timeout(ASK_TIMEOUT_MS), headers: { accept: "application/json" } });
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
        if (!NAME_ID.test(id) || /-0\d/.test(id)) continue;
        const known = fresh(`${lang}|${id}`);
        if (known) names[id] = known;
        else if (asking.has(`${lang}|${id}`) || (waiting.length < NAMES_QUEUE_MAX && mayAsk(id))) {
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
      return { ...names };
    },
  };
}
