import { t } from "../../i18n";
import type { Rng } from "../rng";

/**
 * "Find me something": the cat picks a title from the ones that are really on the page. Nothing is made up and nothing is played: a pick is a card
 * the library already shows (it has the catalogue's own id, and is found again on the page by it), chosen by the name of the shelf it is on (a shelf
 * called Comedy holds comedies), and it is only ever pointed at and offered, for the viewer to open.
 */

export type Mood = "funny" | "scary" | "exciting" | "romantic" | "family" | "scifi" | "classic" | "new" | "any";
export const MOODS: readonly Mood[] = ["funny", "scary", "exciting", "romantic", "family", "scifi", "classic", "new", "any"];

/**
 * The words that make a shelf's name a mood's, in the three languages of the website (the names of the library's own shelves, which it says in the
 * viewer's language: "Comedy Movies", "Filme de comedie", "Film commedia"). A shelf can fit more than one mood: a thriller is scary and exciting.
 */
const SHELF_WORDS: Record<Exclude<Mood, "any">, RegExp> = {
  funny: /comed|funny|com[eé]die|commedi|hilari|amuz|sitcom|humou?r/i,
  scary: /horror|thrill|scar[yi]|groaz|suspans|paur|terror|brivid|spavent|mister|mystery|giall|fright/i,
  exciting: /ac[tț]iun|action|advent|aventur|azione|avventur|crime|crim[aăe]|poli[tț]ist|war\b|western|r[ăa]zboi|guerra|superhero|supererou|supereroi|thrill/i,
  romantic: /romanc|romant|dragoste|\bamor|\blove\b|iubir/i,
  family: /famil|famigl|anima[tțz]|kids?\b|child|copii|bambin|cartoon|disney|pixar|desene|junior/i,
  scifi: /sci-?fi|science|fantas|fantast|futur|space|cosm|spazio|\bSF\b/i,
  classic: /classic|clasic|cult\b|decade|\b19[0-8]0|anii\b|anni\b|vintage|retro|silent/i,
  new: /\bnew\b|trending|popular|popolar|tendin|tendenz|nou[ăa]\b|nuov|novit|recent|now playing|latest|în cinema|in sala|al cinema/i,
};

/** A title on the page, with the shelves it is on and where in the first of them it stands (earlier is more liked). */
export interface Candidate {
  id: string;
  title: string;
  year?: string;
  image?: string;
  rows: string[];
  /** Where in its first shelf it stands. */
  index: number;
  /** The row about the viewer ("Because you watched Up") that holds it, when one does: the library chose it for them, which is a better reason to offer it than a kind of film. */
  because?: string;
}

/** A title the library chose for the viewer is this many times as likely to be the cat's pick as one that is only on a shelf of the right kind. */
const PERSONAL_LIKING = 2.5;

/** Whether a shelf's name fits a mood. */
export const fits = (mood: Mood, shelf: string): boolean => mood === "any" || SHELF_WORDS[mood].test(shelf);

/**
 * The cat's pick for a mood among `pool`, not one it has shown already, favouring those at the front of their shelves (the library puts what is
 * liked first) and those the library chose for the viewer (what they watched and loved). Null when nothing on the page fits.
 */
export function pick(pool: readonly Candidate[], mood: Mood, shown: ReadonlySet<string>, rng: Rng): Candidate | null {
  const fitting = pool.filter((each) => !shown.has(each.id) && (mood === "any" || each.rows.some((shelf) => fits(mood, shelf))));
  if (fitting.length === 0) return null;
  return rng.weighted(fitting, (each) => ((each.image ? 1 : 0.4) * (each.because ? PERSONAL_LIKING : 1)) / (1 + each.index * 0.12)) ?? null;
}

/** Why the cat offers a title, in the library's own words: for a mood the shelf of that kind it is on; for "anything", the row about the viewer when it is on one. */
export function reasonFor(found: Candidate, mood: Mood): string | undefined {
  if (mood === "any") return found.because ?? found.rows[0];
  return found.rows.find((row) => fits(mood, row)) ?? found.rows[0];
}

/** The start of the names of the rows that are about the viewer, not about a kind of film ("Because you watched Up": whatever "Up" is, the row is not its kind). */
const SENTINEL = "\u0001";
const personalRows = (): string[] => (["rows.because", "rows.loved"] as const).map((key) => t(key, { title: SENTINEL }).split(SENTINEL)[0] ?? "").filter((prefix) => prefix.length > 3);

/** The titles the page shows now, as the library's cards say them: each once, with every shelf it is on. */
export function poolOfPage(root: ParentNode = document): Candidate[] {
  const personal = personalRows();
  const byId = new Map<string, Candidate>();
  const add = (tile: HTMLElement, shelf: string, index: number, because?: string) => {
    const id = tile.dataset.entry;
    // (a category, a friend, a card to continue, one the viewer is part way through: not things to suggest)
    if (!id || tile.classList.contains("tv-tile-category") || tile.querySelector(".tv-tile-progress, .tv-skeleton")) return;
    const known = byId.get(id);
    if (known) {
      if (shelf && !known.rows.includes(shelf)) known.rows.push(shelf);
      if (because && !known.because) known.because = because;
      return;
    }
    const title = tile.getAttribute("title") || tile.querySelector(".tv-tile-name")?.textContent?.trim() || "";
    if (!title) return;
    const image = tile.querySelector("img")?.getAttribute("src") ?? undefined;
    const year = tile.querySelector(".tv-tile-year")?.textContent?.trim() || undefined;
    byId.set(id, { id, title, rows: shelf ? [shelf] : [], index, ...(image ? { image } : {}), ...(year ? { year } : {}), ...(because ? { because } : {}) });
  };
  for (const row of root.querySelectorAll<HTMLElement>(".tv-row")) {
    const layout = row.dataset.layout ?? "";
    if (layout === "continue" || layout === "categories" || row.getAttribute("aria-hidden") === "true") continue;
    const named = row.getAttribute("aria-label") ?? row.querySelector(".tv-row-title")?.textContent ?? "";
    const about = personal.some((prefix) => named.startsWith(prefix));
    const shelf = about ? "" : named;
    let index = 0;
    for (const tile of row.querySelectorAll<HTMLElement>(".tv-tile")) add(tile, shelf, index++, about ? named : undefined);
  }
  for (const grid of root.querySelectorAll<HTMLElement>(".tv-grid")) {
    const shelf = grid.closest(".tv-view, .tv-search")?.querySelector(".tv-view-title")?.textContent ?? "";
    let index = 0;
    for (const tile of grid.querySelectorAll<HTMLElement>(".tv-tile")) add(tile, shelf, index++);
  }
  return [...byId.values()];
}

/** The card of a title on the page, found again by the catalogue's id. */
export function tileOf(id: string, root: ParentNode = document): HTMLElement | null {
  for (const tile of root.querySelectorAll<HTMLElement>(".tv-tile[data-entry]")) if (tile.dataset.entry === id) return tile;
  return null;
}
