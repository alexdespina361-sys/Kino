import { googleFromEnv } from "./accounts/google";
import { persistenceFromEnv } from "./accounts/persistence";
import { AccountStore } from "./accounts/store";
import { movingStickersOn, personalStickersMaxBytes, personalStickersOn, stickerFilesFor } from "./accounts/stickerFiles";
import { buildApp, defaultClientDir, defaultFixturesDir, isDeployed } from "./app";
import { FEEDBACK_TOKEN_MIN } from "./feedback/routes";
import { FcmSender, fcmFromEnv } from "./push/fcm";
import { feedbackBackendFor, feedbackMaxBytes, FeedbackStore, MemoryFeedbackBackend } from "./feedback/store";
import { animeHeavenSource } from "./library/animeheaven";
import { filmpireSource } from "./library/filmpire";
import { createNameBook } from "./library/names";
import { UnavailableStore, unavailablePersistenceFor } from "./library/unavailable";
import { TitleNoticeBook, titleNoticePersistenceFor } from "./titleNotices/book";
import { followersOf } from "./titleNotices/followers";
import { tmdbTitleSource } from "./titleNotices/source";
import { PairingStore } from "./sessions/pairings";
import { Registry } from "./sessions/registry";
import { VisitCounter, visitsPersistenceFor } from "./stats/visits";
import { subsyncStoreFor } from "./subsync/store";
import { officialStoreFor } from "./subtitles/official";
import { keepRunning } from "./survive";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

/** How many proxies sit in front of this server. A host like Render has one; on a PC there is none. `TRUST_PROXY` overrides: a number, `true` or `false`. */
function trustProxy(env: NodeJS.ProcessEnv): boolean | number {
  const value = env.TRUST_PROXY;
  if (value === undefined) return env.RENDER ? 1 : false;
  return /^\d+$/.test(value) ? Number(value) : value === "true";
}

const { persistence, describe, kind } = await persistenceFromEnv();
// Personal stickers (shared/stickers.ts): their pictures beside the accounts (a table of their own, or a folder), and off unless PERSONAL_STICKERS=on.
const accounts = await AccountStore.open({
  persistence,
  log: console,
  // (A new profile is set up by whoever uses it the first time: its name and picture, its subtitles, what it watches. PROFILE_SETUP=off: nobody is asked.)
  askSetup: process.env.PROFILE_SETUP !== "off",
  stickers: { files: stickerFilesFor(persistence, kind), on: personalStickersOn(), moving: movingStickersOn(), ...(personalStickersMaxBytes() ? { maxBytes: personalStickersMaxBytes()! } : {}) },
});
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

// How many people open the site is counted, a number for each day and nothing about who (docs/stats.md). VISITOR_COUNT=off is the kill switch: nobody is counted.
// A home that cannot be opened must not take the site down with it: then nobody is counted until the next start.
const visits = /^(0|off|false|no)$/i.test(process.env.VISITOR_COUNT ?? "")
  ? undefined
  : await VisitCounter.open({ persistence: visitsPersistenceFor(persistence, kind), log: console }).catch((error: Error) => {
      console.warn(`The visitor count could not be opened (${error.message}); nobody is counted until the next start.`);
      return undefined;
    });

// What nobody could play is kept next to the accounts, for the screens to mark and the team to look for sources with (src/server/library/unavailable.ts).
// A home that cannot be opened must not take the site down with it: then the list is kept in memory until the next start.
const unavailable = await UnavailableStore.open({ persistence: unavailablePersistenceFor(persistence, kind), log: console }).catch((error: Error) => {
  console.warn(`The list of what nobody could play could not be opened (${error.message}); it is kept in memory only until the server restarts.`);
  return undefined;
});

// What is new of the titles a profile watches (a new episode, a new season, a new film of a series: src/server/titleNotices) is looked for where there is a library,
// and kept next to the accounts. TITLE_NOTICES=off is the kill switch. A home that cannot be opened must not take the site down with it: then there are none.
const titleNotices =
  process.env.LIBRARY === "off" || /^(0|off|false|no)$/i.test(process.env.TITLE_NOTICES ?? "")
    ? undefined
    : await TitleNoticeBook.open({ persistence: titleNoticePersistenceFor(persistence, kind), source: tmdbTitleSource(), followers: () => followersOf(accounts), log: console }).catch((error: Error) => {
        console.warn(`The notices of new episodes could not be opened (${error.message}); there are none until the next start.`);
        return undefined;
      });

// "Continue with Google" is on once GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URIS are all set (docs/google-sign-in.md); what is wrong with them is said, never the secret.
const google = googleFromEnv(process.env, (message) => console.warn(message));

// The Android app (docs/android-app.md): its notifications go through Firebase once FCM_SERVICE_ACCOUNT_FILE names the key of a service account (on the host only),
// and its builds are offered from ANDROID_APP_DIR (outside the checkout).
const fcm = fcmFromEnv(process.env, (message) => console.warn(message));
const androidAppDir = process.env.ANDROID_APP_DIR?.trim() || undefined;

// DIRECT_STREAMING is "on" by default to bypass the server middleman and stream directly to viewers.
if (process.env.DIRECT_STREAMING === undefined) {
  process.env.DIRECT_STREAMING = "on";
}

const app = await buildApp({
  clientDir: defaultClientDir(),
  // The test media (fixtures/, at /fixtures/) are for a machine that runs the app locally or for its tests: a deployed server has no use for them.
  ...(isDeployed() ? {} : { fixturesDir: defaultFixturesDir() }),
  // LIBRARY=off: no browsing library (the e2e server, or anyone who would rather not fetch external library).
  librarySources: process.env.LIBRARY === "off" ? [] : [filmpireSource(), animeHeavenSource()],
  ...(process.env.LIBRARY === "off" ? {} : { names: createNameBook() }),
  accounts,
  registry,
  pairings,
  storage: kind,
  // (The subtitle timings that screens share live next to the accounts, in the same database or folder.)
  subsync: subsyncStoreFor(persistence, kind),
  official: officialStoreFor(persistence, kind),
  feedback,
  ...(visits ? { visits } : {}),
  ...(unavailable ? { unavailable } : {}),
  ...(titleNotices ? { titleNotices } : {}),
  ...(feedbackAdminToken ? { feedbackAdminToken } : {}),
  ...(Number(process.env.FEEDBACK_SENDS_PER_10_MIN) > 0 ? { feedbackSendsPer10Min: Number(process.env.FEEDBACK_SENDS_PER_10_MIN) } : {}),
  // REGISTRATION=closed: nobody new can make an account (once the people it is for have one).
  registration: process.env.REGISTRATION === "closed" ? "closed" : "open",
  ...(Number(process.env.MAX_ACCOUNTS) > 0 ? { maxAccounts: Number(process.env.MAX_ACCOUNTS) } : {}),
  ...(Number(process.env.SIGNUPS_PER_HOUR) > 0 ? { signUpsPerHour: Number(process.env.SIGNUPS_PER_HOUR) } : {}),
  // (Phones paired with a TV from one address in an hour: 30 unless set, see MAX_NEW_PAIRS. The click-through tests pair hundreds from this machine.)
  ...(Number(process.env.PAIRINGS_PER_HOUR) > 0 ? { hub: { maxNewPairs: Number(process.env.PAIRINGS_PER_HOUR) } } : {}),
  ...(google ? { google } : {}),
  ...(fcm ? { push: new FcmSender(fcm, Date.now, console) } : {}),
  ...(androidAppDir ? { androidAppDir } : {}),
  trustProxy: trustProxy(process.env),
  // Website as middle man is toggled off by default so users cannot watch something if it uses website bandwidth.
  // Set PROXY_VIDEO=on to explicitly allow the server to proxy video.
  proxyVideo: process.env.PROXY_VIDEO === "on" || process.env.PROXY_VIDEO === "true" || process.env.PROXY_VIDEO === "1",
  logger: true,
});
// A promise that fails with nobody waiting for it is logged and the server carries on; an error that nothing catches is logged and stops it (src/server/survive.ts).
keepRunning(app.log);
app.log.info(`Accounts and pairings are kept in ${describe}.`);
app.log.info(visits ? "Visitors are counted, a number for each day (docs/stats.md)." : "Visitors are not counted.");
app.log.info(google ? `Google sign-in is on at ${google.redirectUris.map((address) => new URL(address).host).join(", ")}.` : "Google sign-in is off.");
app.log.info(fcm ? `The app's notifications are on (Firebase project ${fcm.projectId}).` : "The app's notifications are off.");

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
