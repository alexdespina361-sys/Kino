import { buildApp, defaultClientDir, defaultFixturesDir } from "./app";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApp({
  clientDir: defaultClientDir(),
  fixturesDir: defaultFixturesDir(),
  logger: true,
});

await app.listen({ port, host });
