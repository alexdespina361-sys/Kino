import { z } from "zod";
import type { LibraryItem, LibraryRow } from "../../shared";
import type { LibrarySource } from "./library";

/**
 * The Internet Archive's own film collections. Its pages name their video (`og:video`), so a title here plays like any
 * pasted link, with no code made for the site. What is in a collection, and under what terms, is the Archive's call.
 */
export interface ArchiveRow {
  /** The collection's identifier on archive.org. */
  collection: string;
  title: string;
}

export const ARCHIVE_ROWS: ArchiveRow[] = [
  { collection: "feature_films", title: "Feature films" },
  { collection: "classic_tv", title: "Classic TV" },
  { collection: "animationandcartoons", title: "Cartoons & animation" },
  { collection: "silent_films", title: "Silent films" },
  { collection: "SciFi_Horror", title: "Sci-fi & horror" },
];

export interface ArchiveOptions {
  rows?: ArchiveRow[];
  /** Titles per row. */
  perRow?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DocSchema = z.object({
  identifier: z.string().min(1).max(200),
  title: z.union([z.string(), z.array(z.string())]).optional(),
  year: z.union([z.number(), z.string()]).optional(),
});
const SearchSchema = z.object({ response: z.object({ docs: z.array(z.unknown()) }) });

const SEARCH = "https://archive.org/advancedsearch.php";
/**
 * Collections are open to anyone, so the rows leave out what is tagged adult and what is titled like it. Crude, and meant to be:
 * it keeps the worst off a shared TV, not everything unsuitable.
 */
const AVOID_SUBJECTS = ["erotica", "adult", "porn", "xxx"];
const AVOID_TITLE_WORDS = ["sex", "sexy", "nude", "naked", "erotic", "porn", "molester", "stripper", "hooker"];
const query = (collection: string) =>
  `collection:${collection} AND mediatype:movies AND NOT subject:(${AVOID_SUBJECTS.join(" OR ")}) AND NOT title:(${AVOID_TITLE_WORDS.join(" OR ")})`;

export function internetArchive(options: ArchiveOptions = {}): LibrarySource {
  const rows = options.rows ?? ARCHIVE_ROWS;
  const perRow = options.perRow ?? 24;
  const get = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const parseDocs = (docs: unknown[]): LibraryItem[] =>
    docs.flatMap((doc): LibraryItem[] => {
      const parsed = DocSchema.safeParse(doc);
      if (!parsed.success) return [];
      const { identifier, title, year } = parsed.data;
      const name = (Array.isArray(title) ? title[0] : title)?.trim() || identifier;
      const released = Number.parseInt(String(year ?? ""), 10);
      const id = encodeURIComponent(identifier);
      return [
        {
          id: identifier,
          title: name.slice(0, 300),
          ...(Number.isInteger(released) && released > 1800 ? { year: released } : {}),
          image: `https://archive.org/services/img/${id}`,
          url: `https://archive.org/details/${id}`,
        },
      ];
    });

  const loadRow = async (row: ArchiveRow): Promise<LibraryRow> => {
    const url = new URL(SEARCH);
    url.searchParams.set("q", query(row.collection));
    for (const field of ["identifier", "title", "year"]) url.searchParams.append("fl[]", field);
    url.searchParams.append("sort[]", "downloads desc");
    url.searchParams.set("rows", String(perRow));
    url.searchParams.set("output", "json");

    const response = await get(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${row.collection}: HTTP ${response.status}`);
    const body = SearchSchema.parse(await response.json());
    const items = parseDocs(body.response.docs);
    return { id: `archive-${row.collection}`, title: row.title, source: "Internet Archive", items };
  };

  return {
    id: "internet-archive",
    name: "Internet Archive",
    async load() {
      const settled = await Promise.allSettled(rows.map(loadRow));
      const loaded = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (loaded.length === 0 && failed) throw failed.reason; // nothing came: the cache keeps what it had
      return loaded;
    },
    async search(queryText: string): Promise<LibraryItem[]> {
      const q = queryText.trim();
      if (!q) return [];
      try {
        const url = new URL(SEARCH);
        url.searchParams.set(
          "q",
          `(${q}) AND mediatype:movies AND NOT subject:(${AVOID_SUBJECTS.join(" OR ")}) AND NOT title:(${AVOID_TITLE_WORDS.join(" OR ")})`
        );
        for (const field of ["identifier", "title", "year"]) url.searchParams.append("fl[]", field);
        url.searchParams.append("sort[]", "downloads desc");
        url.searchParams.set("rows", String(perRow));
        url.searchParams.set("output", "json");

        const response = await get(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
        if (!response.ok) return [];
        const body = SearchSchema.parse(await response.json());
        return parseDocs(body.response.docs);
      } catch {
        return [];
      }
    },
  };
}
