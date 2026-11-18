import { existsSync } from "node:fs";

/**
 * Settings that are nobody's to read in a public repository (the movie database's key, first of all) are not written in the code: a host gives them
 * to the server its own way (the box: `/etc/kino-web.env`), and a PC keeps them in `.env.local` (or `.env`) next to `package.json`, which git never
 * takes. This reads those files when they are there, before anything else of the server is loaded (it is the first import of `index.ts`, and a
 * module's imports run in order). What the host already set is left as it is.
 */
for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  try {
    process.loadEnvFile(file);
  } catch (error) {
    console.warn(`${file} could not be read (${error instanceof Error ? error.message : String(error)}); its settings are not used.`);
  }
}
