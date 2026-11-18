import { z } from "zod";

export const LibraryKindSchema = z.enum(["movie", "series"]);
export type LibraryKind = z.infer<typeof LibraryKindSchema>;

export const LibrarySectionSchema = z.enum(["movie", "series", "cartoon", "anime"]);
export type LibrarySection = z.infer<typeof LibrarySectionSchema>;
export const LIBRARY_SECTIONS: readonly LibrarySection[] = LibrarySectionSchema.options;

export function wantedSections(settings: { sections?: readonly LibrarySection[] | undefined }): ReadonlySet<LibrarySection> | null {
  const chosen = new Set((settings.sections ?? []).filter((section) => LIBRARY_SECTIONS.includes(section)));
  return chosen.size === 0 || chosen.size >= LIBRARY_SECTIONS.length ? null : chosen;
}
export const isWanted = (wanted: ReadonlySet<LibrarySection> | null | undefined, thing: { section?: LibrarySection | undefined; kind?: LibraryKind | undefined }): boolean => {
  const section = sectionOf(thing);
  return !wanted || !section || wanted.has(section);
};

export const sectionOf = (thing: { section?: LibrarySection | undefined; kind?: LibraryKind | undefined }): LibrarySection | undefined => thing.section ?? thing.kind;

export const LibraryItemSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(300),
  year: z.number().int().optional(),
  image: z.string().max(2048).optional(),
  backdrop: z.string().max(2048).optional(),
  description: z.string().max(400).optional(),
  kind: LibraryKindSchema.optional(),
  section: LibrarySectionSchema.optional(),
  url: z.string().max(2048),
  hasRoDub: z.boolean().optional(),
  kids: z.literal(true).optional(),
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

export const forChildren = (item: { section?: LibrarySection | undefined; kids?: true | undefined }, row?: { section?: LibrarySection | undefined }): boolean =>
  (item.section ?? row?.section) === "cartoon" && item.kids === true;

export const LibraryItemsSchema = z.object({ items: z.array(LibraryItemSchema), exact: z.number().int().min(0).optional() });

export const LibraryRowSchema = z.object({
  id: z.string().max(100),
  title: z.string().max(100),
  source: z.string().max(60),
  kind: LibraryKindSchema.optional(),
  section: LibrarySectionSchema.optional(),
  items: z.array(LibraryItemSchema).max(100),
});
export type LibraryRow = z.infer<typeof LibraryRowSchema>;

export const LibraryRowsSchema = z.object({ rows: z.array(LibraryRowSchema).max(20), next: z.number().int().min(0).nullable() });

export const LibraryMoreSchema = z.object({ items: z.array(LibraryItemSchema).max(100), last: z.boolean() });

export const AGE_COUNTRIES = ["RO", "IT", "US", "GB"] as const;

export const TitleAboutSchema = z.object({
  genres: z.array(z.string().max(40)).max(8),
  directors: z.array(z.string().max(100)).max(4),
  creators: z.array(z.string().max(100)).max(4),
  cast: z.array(z.string().max(100)).max(8),
  ages: z.record(z.string().max(2), z.string().max(20)),
  parts: z.array(LibraryItemSchema).max(30),
  similar: z.array(LibraryItemSchema).max(20),
  hasRoDub: z.boolean().optional(),
});
export type TitleAbout = z.infer<typeof TitleAboutSchema>;

export const TitleAboutAnswerSchema = z.object({ about: TitleAboutSchema.nullable() });

export const EpisodeDetailSchema = z.object({
  season: z.number().int().min(0).max(200),
  episode: z.number().int().min(0).max(5000),
  title: z.string().max(200).optional(),
  overview: z.string().max(400).optional(),
  still: z.string().max(2048).optional(),
  runtime: z.number().int().min(1).max(1000).optional(),
  url: z.string().max(2048).optional(),
});
export type EpisodeDetail = z.infer<typeof EpisodeDetailSchema>;

export const EpisodeDetailsSchema = z.object({ episodes: z.array(EpisodeDetailSchema).max(5000) });

export const UnavailableSchema = z.object({
  title: z.boolean(),
  episodes: z.array(z.object({ season: z.number().int().min(0).max(200), episode: z.number().int().min(0).max(5000) })).max(500),
});

export const SeasonsSchema = z.object({ seasons: z.array(z.number().int().min(1).max(200)).max(200) });

export const LibrarySchema = z.object({
  rows: z.array(LibraryRowSchema).max(50),
  updatedAt: z.number(),
});
export type Library = z.infer<typeof LibrarySchema>;
