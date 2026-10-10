import { z } from "zod";

/**
 * The library: rows of titles from places that offer video openly, collected and remembered by the server so the phone
 * can browse them at once. A title is only a link: playing one is the same as pasting its link, so the server's resolver
 * finds the video and the TV plays it.
 */

/** Whether a title is a film or a show, when the place that listed it says so: the TV keeps the two apart. */
export const LibraryKindSchema = z.enum(["movie", "series"]);
export type LibraryKind = z.infer<typeof LibraryKindSchema>;

export const LibraryItemSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(300),
  year: z.number().int().optional(),
  /** The poster, upright. */
  image: z.string().max(2048).optional(),
  /** A wide picture of it, for the TV's banner and the wide tiles. */
  backdrop: z.string().max(2048).optional(),
  /** A sentence or two about it, as plain text, for the TV's banner. */
  description: z.string().max(400).optional(),
  kind: LibraryKindSchema.optional(),
  /** A page or media link, as pasted on the phone. Relative links (`/fixtures/a.mp4`) are this server's own. */
  url: z.string().max(2048),
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

/** What the library's search and "like this" answer with. */
export const LibraryItemsSchema = z.object({ items: z.array(LibraryItemSchema) });

export const LibraryRowSchema = z.object({
  id: z.string().max(100),
  title: z.string().max(100),
  /** Where the row comes from, so the phone can say so. */
  source: z.string().max(60),
  /** What the titles in the row are, when they are all one kind. */
  kind: LibraryKindSchema.optional(),
  items: z.array(LibraryItemSchema).max(100),
});
export type LibraryRow = z.infer<typeof LibraryRowSchema>;

/** What a place knows about one episode of a show besides its number: a name, a line about it, a still from it, how long it runs. */
export const EpisodeDetailSchema = z.object({
  season: z.number().int().min(0).max(200),
  episode: z.number().int().min(0).max(5000),
  title: z.string().max(200).optional(),
  overview: z.string().max(400).optional(),
  still: z.string().max(2048).optional(),
  /** In minutes. */
  runtime: z.number().int().min(1).max(1000).optional(),
});
export type EpisodeDetail = z.infer<typeof EpisodeDetailSchema>;

export const EpisodeDetailsSchema = z.object({ episodes: z.array(EpisodeDetailSchema).max(500) });

export const LibrarySchema = z.object({
  rows: z.array(LibraryRowSchema).max(50),
  /** When the oldest part was collected (ms since epoch); 0 when nothing has been. */
  updatedAt: z.number(),
});
export type Library = z.infer<typeof LibrarySchema>;
