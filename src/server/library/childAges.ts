/**
 * The age ratings that keep a cartoon from a child's profile (the owner's item 5, last part: "PG-13 movies like the Simpsons").
 *
 * A cartoon TMDB files under Family or Kids is for children (`LibraryItem.kids`), unless its age rating says otherwise. The rating that decides is the
 * first one known of the US, Britain, Italy and Romania, in that order: TMDB's US and British ratings are the ones it has most and best. (Any country over
 * its line would have hidden Cars, Fantasia and The Lion King, which TMDB had at "12" in Romania, and Gumball, "VM14" in Italy: 5 of 206 on the live site
 * on 17 Nov, The Simpsons Movie the only right one.) A rating written another way ("NR", "Unrated") passes the word to the next country, and a title no
 * country rates keeps TMDB's label: on 17 Nov 10 of the 206, all made for children (Tom and Jerry, Asterix, SilverHawks).
 *
 * A film can carry a TV rating (the US rating of a showing on TV: Monsters University's is TV-Y7), so each list holds both kinds.
 */
const LINES: ReadonlyArray<{ country: string; ok: readonly string[]; over: readonly string[] }> = [
  { country: "US", ok: ["G", "PG", "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG"], over: ["PG-13", "R", "NC-17", "TV-14", "TV-MA"] },
  { country: "GB", ok: ["U", "UC", "PG"], over: ["12", "12A", "15", "18", "R18"] },
  { country: "IT", ok: ["T", "6+"], over: ["10+", "VM14", "VM18", "14+", "18+"] },
  { country: "RO", ok: ["AG", "AP"], over: ["AP-12", "12", "N-15", "15", "IM-18", "18", "18+", "IM-18-XXX"] }, // (AP-12: under 12 only with a grown-up)
];

/** Whether a title's age ratings (country to rating, as TMDB writes them) put it over what a child's profile may see: the first country of `LINES` that rates it says. */
export function overChildAge(ages: Readonly<Record<string, string>>): boolean {
  for (const { country, ok, over } of LINES) {
    const rating = ages[country]?.trim().toUpperCase();
    if (!rating) continue;
    if (over.includes(rating)) return true;
    if (ok.includes(rating)) return false;
  }
  return false;
}
