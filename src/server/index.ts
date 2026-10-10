import { buildApp, defaultClientDir, defaultFixturesDir } from "./app";
import { filmpireSource } from "./library/filmpire";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApp({
  clientDir: defaultClientDir(),
  fixturesDir: defaultFixturesDir(),
  // LIBRARY=off: no browsing library (the e2e server, or anyone who would rather not fetch external library).
  librarySources: process.env.LIBRARY === "off" ? [] : [filmpireSource()],
  logger: true,
});

await app.listen({ port, host });
