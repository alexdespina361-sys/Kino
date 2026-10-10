import { z } from "zod";

/**
 * The library: rows of titles from places that offer video openly, collected and remembered by the server so the phone
 * can browse them at once. A title is only a link: playing one is the same as pasting its link, so the server's resolver
 * finds the video and the TV plays it.
 */
export const LibraryItemSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(300),
  year: z.number().int().optional(),
  image: z.string().max(2048).optional(),
  /** A page or media link, as pasted on the phone. Relative links (`/fixtures/a.mp4`) are this server's own. */
  url: z.string().max(2048),
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

export const LibraryRowSchema = z.object({
  id: z.string().max(100),
  title: z.string().max(100),
  /** Where the row comes from, so the phone can say so. */
  source: z.string().max(60),
  items: z.array(LibraryItemSchema).max(100),
});
export type LibraryRow = z.infer<typeof LibraryRowSchema>;

export const LibrarySchema = z.object({
  rows: z.array(LibraryRowSchema).max(50),
  /** When the oldest part was collected (ms since epoch); 0 when nothing has been. */
  updatedAt: z.number(),
});
export type Library = z.infer<typeof LibrarySchema>;
