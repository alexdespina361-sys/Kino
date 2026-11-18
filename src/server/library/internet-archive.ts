import { z } from "zod";
import type { LibraryItem, LibraryRow, LibrarySection } from "../../shared";
import { providerFetch } from "../resolvers/providerFetch";
import type { LibrarySource } from "./library";

export interface ArchiveRow {
  collection: string;
  title: string;
  section?: LibrarySection;
}

export const ARCHIVE_ROWS: ArchiveRow[] = [
  { collection: "feature_films", title: "Feature films" },
  { collection: "classic_tv", title: "Classic TV" },
  { collection: "animationandcartoons", title: "Cartoons & animation", section: "cartoon" },
  { collection: "silent_films", title: "Silent films" },
  { collection: "SciFi_Horror", title: "Sci-fi & horror" },
];

export interface ArchiveOptions {
  rows?: ArchiveRow[];
  perRow?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DocSchema = z.object({
  identifier: z.string().min(1).max(200),
  title: z.union([z.string(), z.array(z.string())]).optional(),
  year: z.union([z.number(), z.string()]).optional(),
  description: z.union([z.string(), z.array(z.string())]).optional(),
});

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
};

export function plainDescription(raw: string | string[] | undefined, max = 300): string | undefined {
  const text = (Array.isArray(raw) ? raw.join(" ") : (raw ?? ""))
    .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith("#")) {
        const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return Number.isInteger(code) && code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 20) return undefined;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6))}…`;
}
const SearchSchema = z.object({ response: z.object({ docs: z.array(z.unknown()) }) });

const SEARCH = "https://archive.org/advancedsearch.php";
const FIELDS = ["identifier", "title", "year", "description"];
const AVOID_SUBJECTS = ["erotica", "adult", "porn", "xxx"];
const AVOID_TITLE_WORDS = ["sex", "sexy", "nude", "naked", "erotic", "porn", "molester", "stripper", "hooker"];
const query = (collection: string) =>
  `collection:${collection} AND mediatype:movies AND NOT subject:(${AVOID_SUBJECTS.join(" OR ")}) AND NOT title:(${AVOID_TITLE_WORDS.join(" OR ")})`;

export function internetArchive(options: ArchiveOptions = {}): LibrarySource {
  const rows = options.rows ?? ARCHIVE_ROWS;
  const perRow = options.perRow ?? 24;
  const get = options.fetch ?? providerFetch();
  const timeoutMs = options.timeoutMs ?? 10_000;

  const parseDocs = (docs: unknown[]): LibraryItem[] =>
    docs.flatMap((doc): LibraryItem[] => {
      const parsed = DocSchema.safeParse(doc);
      if (!parsed.success) return [];
      const { identifier, title, year, description } = parsed.data;
      const name = (Array.isArray(title) ? title[0] : title)?.trim() || identifier;
      const released = Number.parseInt(String(year ?? ""), 10);
      const id = encodeURIComponent(identifier);
      const about = plainDescription(description);
      return [
        {
          id: identifier,
          title: name.slice(0, 300),
          ...(Number.isInteger(released) && released > 1800 ? { year: released } : {}),
          ...(about ? { description: about } : {}),
          image: `https://archive.org/services/img/${id}`,
          url: `https://archive.org/details/${id}`,
        },
      ];
    });

  const loadRow = async (row: ArchiveRow): Promise<LibraryRow> => {
    const url = new URL(SEARCH);
    url.searchParams.set("q", query(row.collection));
    for (const field of FIELDS) url.searchParams.append("fl[]", field);
    url.searchParams.append("sort[]", "downloads desc");
    url.searchParams.set("rows", String(perRow));
    url.searchParams.set("output", "json");

    const response = await get(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${row.collection}: HTTP ${response.status}`);
    const body = SearchSchema.parse(await response.json());
    const items = parseDocs(body.response.docs);
    return { id: `archive-${row.collection}`, title: row.title, source: "Internet Archive", ...(row.section ? { section: row.section } : {}), items };
  };

  return {
    id: "internet-archive",
    name: "Internet Archive",
    async load() {
      const settled = await Promise.allSettled(rows.map(loadRow));
      const loaded = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (loaded.length === 0 && failed) throw failed.reason;
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
        for (const field of FIELDS) url.searchParams.append("fl[]", field);
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
