import { persistenceFromEnv } from "./accounts/persistence";
import { AccountStore } from "./accounts/store";
import { buildApp, defaultClientDir, defaultFixturesDir } from "./app";
import { filmpireSource } from "./library/filmpire";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

/** How many proxies sit in front of this server. A host like Render has one; on a PC there is none. `TRUST_PROXY` overrides: a number, `true` or `false`. */
function trustProxy(env: NodeJS.ProcessEnv): boolean | number {
  const value = env.TRUST_PROXY;
  if (value === undefined) return env.RENDER ? 1 : false;
  return /^\d+$/.test(value) ? Number(value) : value === "true";
}

const { persistence, describe } = await persistenceFromEnv();
const accounts = await AccountStore.open({ persistence, log: console });

const app = await buildApp({
  clientDir: defaultClientDir(),
  fixturesDir: defaultFixturesDir(),
  // LIBRARY=off: no browsing library (the e2e server, or anyone who would rather not fetch external library).
  librarySources: process.env.LIBRARY === "off" ? [] : [filmpireSource()],
  accounts,
  // REGISTRATION=closed: nobody new can make an account (once the people it is for have one).
  registration: process.env.REGISTRATION === "closed" ? "closed" : "open",
  ...(Number(process.env.MAX_ACCOUNTS) > 0 ? { maxAccounts: Number(process.env.MAX_ACCOUNTS) } : {}),
  trustProxy: trustProxy(process.env),
  logger: true,
});
app.log.info(`Accounts are kept in ${describe}.`);

await app.listen({ port, host });

// A host stops a server with SIGTERM (a free Render instance does when it has been idle, and at every deploy): write what
// has not been written yet, then go.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info(`${signal}: saving and stopping.`);
    setTimeout(() => process.exit(1), 8000).unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
