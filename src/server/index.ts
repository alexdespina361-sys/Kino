import { persistenceFromEnv } from "./accounts/persistence";
import { AccountStore } from "./accounts/store";
import { buildApp, defaultClientDir, defaultFixturesDir } from "./app";
import { FEEDBACK_TOKEN_MIN } from "./feedback/routes";
import { feedbackBackendFor, feedbackMaxBytes, FeedbackStore, MemoryFeedbackBackend } from "./feedback/store";
import { animeHeavenSource } from "./library/animeheaven";
import { filmpireSource } from "./library/filmpire";
import { PairingStore } from "./sessions/pairings";
import { Registry } from "./sessions/registry";
import { subsyncStoreFor } from "./subsync/store";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

/** How many proxies sit in front of this server. A host like Render has one; on a PC there is none. `TRUST_PROXY` overrides: a number, `true` or `false`. */
function trustProxy(env: NodeJS.ProcessEnv): boolean | number {
  const value = env.TRUST_PROXY;
  if (value === undefined) return env.RENDER ? 1 : false;
  return /^\d+$/.test(value) ? Number(value) : value === "true";
}

const { persistence, describe, kind } = await persistenceFromEnv();
const accounts = await AccountStore.open({ persistence, log: console });
// Which phone goes with which TV is kept in the same place, so a restart (a free host sleeps when nobody is using it) does not undo every pairing.
const registry = new Registry();
const pairings = await PairingStore.open({ registry, persistence, log: console });

// What people send from the profile's Feedback button lives in the same place too. A home that cannot be opened must not take the site down with it:
// reports then wait in memory (and the log says so) until the next start.
const feedback = await FeedbackStore.open({ backend: feedbackBackendFor(persistence, kind), ...(feedbackMaxBytes() ? { maxBytes: feedbackMaxBytes()! } : {}), log: console }).catch((error: Error) => {
  console.warn(`Feedback could not be opened (${error.message}); reports are kept in memory only until the server restarts.`);
  return FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
});
// FEEDBACK_ADMIN_TOKEN is what the team reads and answers reports with (docs/feedback.md); without it reports are kept and nobody can read them.
const feedbackAdminToken = process.env.FEEDBACK_ADMIN_TOKEN?.trim() || undefined;
if (feedbackAdminToken && feedbackAdminToken.length < FEEDBACK_TOKEN_MIN) {
  console.warn(`FEEDBACK_ADMIN_TOKEN is shorter than ${FEEDBACK_TOKEN_MIN} characters, so it is not used: the team's side of the feedback is off.`);
}

// DIRECT_STREAMING is "on" by default to bypass the server middleman and stream directly to viewers.
if (process.env.DIRECT_STREAMING === undefined) {
  process.env.DIRECT_STREAMING = "on";
}

const app = await buildApp({
  clientDir: defaultClientDir(),
  fixturesDir: defaultFixturesDir(),
  // LIBRARY=off: no browsing library (the e2e server, or anyone who would rather not fetch external library).
  librarySources: process.env.LIBRARY === "off" ? [] : [filmpireSource(), animeHeavenSource()],
  accounts,
  registry,
  pairings,
  storage: kind,
  // (The subtitle timings that screens share live next to the accounts, in the same database or folder.)
  subsync: subsyncStoreFor(persistence, kind),
  feedback,
  ...(feedbackAdminToken ? { feedbackAdminToken } : {}),
  // REGISTRATION=closed: nobody new can make an account (once the people it is for have one).
  registration: process.env.REGISTRATION === "closed" ? "closed" : "open",
  ...(Number(process.env.MAX_ACCOUNTS) > 0 ? { maxAccounts: Number(process.env.MAX_ACCOUNTS) } : {}),
  ...(Number(process.env.SIGNUPS_PER_HOUR) > 0 ? { signUpsPerHour: Number(process.env.SIGNUPS_PER_HOUR) } : {}),
  trustProxy: trustProxy(process.env),
  // Website as middle man is toggled off by default so users cannot watch something if it uses website bandwidth.
  // Set PROXY_VIDEO=on to explicitly allow the server to proxy video.
  proxyVideo: process.env.PROXY_VIDEO === "on" || process.env.PROXY_VIDEO === "true" || process.env.PROXY_VIDEO === "1",
  logger: true,
});
app.log.info(`Accounts and pairings are kept in ${describe}.`);

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
