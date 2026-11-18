import "./loadEnv";
import path from "node:path";
import { googleFromEnv } from "./accounts/google";
import { persistenceFromEnv } from "./accounts/persistence";
import { keepLimitsIn, LimitKeeper } from "./accounts/rateLimit";
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
import { originOf } from "./stats/owner";
import { VisitCounter, visitsPersistenceFor } from "./stats/visits";
import { subsyncStoreFor } from "./subsync/store";
import { officialStoreFor } from "./subtitles/official";
import { keepRunning } from "./survive";

const port = Number(process.env.PORT ?? 8787);
if (process.env.LIBRARY !== "off" && !process.env.TMDB_API_KEY)
  console.warn("TMDB_API_KEY is not set: the movie database answers nothing without a key, so the library has no titles (the box: /etc/kino-web.env; a PC: .env.local).");
const host = process.env.HOST ?? "0.0.0.0";

const limits = process.env.DATA_DIR === "memory" ? undefined : LimitKeeper.open(path.resolve(process.env.DATA_DIR ?? "data", "limits.json"), (message) => console.warn(message));
keepLimitsIn(limits);

function trustProxy(env: NodeJS.ProcessEnv): boolean | number {
  const value = env.TRUST_PROXY;
  if (value === undefined) return env.RENDER ? 1 : false;
  return /^\d+$/.test(value) ? Number(value) : value === "true";
}

const { persistence, describe, kind } = await persistenceFromEnv();
const accounts = await AccountStore.open({
  persistence,
  log: console,
  askSetup: process.env.PROFILE_SETUP !== "off",
  stickers: { files: stickerFilesFor(persistence, kind), on: personalStickersOn(), moving: movingStickersOn(), ...(personalStickersMaxBytes() ? { maxBytes: personalStickersMaxBytes()! } : {}) },
  ...(Number(process.env.SYNC_SITE_MB) > 0 ? { syncSiteBytes: Number(process.env.SYNC_SITE_MB) * 1024 * 1024 } : {}),
});
const registry = new Registry();
const pairings = await PairingStore.open({ registry, persistence, log: console });

const feedback = await FeedbackStore.open({ backend: feedbackBackendFor(persistence, kind), ...(feedbackMaxBytes() ? { maxBytes: feedbackMaxBytes()! } : {}), log: console }).catch((error: Error) => {
  console.warn(`Feedback could not be opened (${error.message}); reports are kept in memory only until the server restarts.`);
  return FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
});
const feedbackAdminToken = process.env.FEEDBACK_ADMIN_TOKEN?.trim() || undefined;
if (feedbackAdminToken && feedbackAdminToken.length < FEEDBACK_TOKEN_MIN) {
  console.warn(`FEEDBACK_ADMIN_TOKEN is shorter than ${FEEDBACK_TOKEN_MIN} characters, so it is not used: the team's side of the feedback is off.`);
}

const ownerStatsToken = process.env.OWNER_STATS_TOKEN?.trim() || undefined;
if (ownerStatsToken && ownerStatsToken.length < FEEDBACK_TOKEN_MIN) {
  console.warn(`OWNER_STATS_TOKEN is shorter than ${FEEDBACK_TOKEN_MIN} characters, so it is not used: the owner's page has nothing to read.`);
}
const ownerStatsOrigin = originOf(process.env.OWNER_STATS_ORIGIN);
if (process.env.OWNER_STATS_ORIGIN?.trim() && !ownerStatsOrigin) {
  console.warn("OWNER_STATS_ORIGIN is not an origin (https://name.example, nothing after it), so it is not used: no page of another site can read the owner's stats in a browser.");
}

const visits = /^(0|off|false|no)$/i.test(process.env.VISITOR_COUNT ?? "")
  ? undefined
  : await VisitCounter.open({ persistence: visitsPersistenceFor(persistence, kind), log: console }).catch((error: Error) => {
      console.warn(`The visitor count could not be opened (${error.message}); nobody is counted until the next start.`);
      return undefined;
    });

const unavailable = await UnavailableStore.open({ persistence: unavailablePersistenceFor(persistence, kind), log: console }).catch((error: Error) => {
  console.warn(`The list of what nobody could play could not be opened (${error.message}); it is kept in memory only until the server restarts.`);
  return undefined;
});

const titleNotices =
  process.env.LIBRARY === "off" || /^(0|off|false|no)$/i.test(process.env.TITLE_NOTICES ?? "")
    ? undefined
    : await TitleNoticeBook.open({ persistence: titleNoticePersistenceFor(persistence, kind), source: tmdbTitleSource(), followers: () => followersOf(accounts), log: console }).catch((error: Error) => {
        console.warn(`The notices of new episodes could not be opened (${error.message}); there are none until the next start.`);
        return undefined;
      });

const google = googleFromEnv(process.env, (message) => console.warn(message));

const fcm = fcmFromEnv(process.env, (message) => console.warn(message));
const androidAppDir = process.env.ANDROID_APP_DIR?.trim() || undefined;

if (process.env.DIRECT_STREAMING === undefined) {
  process.env.DIRECT_STREAMING = "on";
}

const app = await buildApp({
  clientDir: defaultClientDir(),
  ...(isDeployed() ? {} : { fixturesDir: defaultFixturesDir() }),
  librarySources: process.env.LIBRARY === "off" ? [] : [filmpireSource(), animeHeavenSource()],
  ...(process.env.LIBRARY === "off" ? {} : { names: createNameBook() }),
  accounts,
  registry,
  pairings,
  storage: kind,
  subsync: subsyncStoreFor(persistence, kind),
  official: officialStoreFor(persistence, kind),
  feedback,
  ...(visits ? { visits } : {}),
  ...(unavailable ? { unavailable } : {}),
  ...(titleNotices ? { titleNotices } : {}),
  ...(feedbackAdminToken ? { feedbackAdminToken } : {}),
  ...(ownerStatsToken ? { ownerStatsToken } : {}),
  ...(ownerStatsOrigin ? { ownerStatsOrigin } : {}),
  ...(Number(process.env.FEEDBACK_SENDS_PER_10_MIN) > 0 ? { feedbackSendsPer10Min: Number(process.env.FEEDBACK_SENDS_PER_10_MIN) } : {}),
  registration: process.env.REGISTRATION === "closed" ? "closed" : "open",
  ...(Number(process.env.MAX_ACCOUNTS) > 0 ? { maxAccounts: Number(process.env.MAX_ACCOUNTS) } : {}),
  ...(Number(process.env.SIGNUPS_PER_HOUR) > 0 ? { signUpsPerHour: Number(process.env.SIGNUPS_PER_HOUR) } : {}),
  ...(Number(process.env.SIGNUPS_PER_DAY) > 0 ? { signUpsPerDay: Number(process.env.SIGNUPS_PER_DAY) } : {}),
  ...(Number(process.env.SLOW_CHECKS_PER_15_MIN) > 0 ? { slowChecksPer15Min: Number(process.env.SLOW_CHECKS_PER_15_MIN) } : {}),
  ...(Number(process.env.PAIRINGS_PER_HOUR) > 0 || Number(process.env.SOCKETS_PER_NETWORK) > 0
    ? {
        hub: {
          ...(Number(process.env.PAIRINGS_PER_HOUR) > 0 ? { maxNewPairs: Number(process.env.PAIRINGS_PER_HOUR) } : {}),
          ...(Number(process.env.SOCKETS_PER_NETWORK) > 0 ? { maxSocketsPerNetwork: Number(process.env.SOCKETS_PER_NETWORK) } : {}),
        },
      }
    : {}),
  ...(google ? { google } : {}),
  ...(fcm ? { push: new FcmSender(fcm, Date.now, console) } : {}),
  ...(androidAppDir ? { androidAppDir } : {}),
  trustProxy: trustProxy(process.env),
  proxyVideo: process.env.PROXY_VIDEO === "on" || process.env.PROXY_VIDEO === "true" || process.env.PROXY_VIDEO === "1",
  logger: true,
});
keepRunning(app.log);
app.log.info(`Accounts and pairings are kept in ${describe}.`);
app.log.info(visits ? "Visitors are counted, a number for each day (docs/stats.md)." : "Visitors are not counted.");
app.log.info(ownerStatsToken && ownerStatsToken.length >= FEEDBACK_TOKEN_MIN ? `The owner's page can read its counts${ownerStatsOrigin ? ` from ${new URL(ownerStatsOrigin).host}` : " (from no other site's page: OWNER_STATS_ORIGIN is not set)"}.` : "The owner's page is off.");
app.log.info(google ? `Google sign-in is on at ${google.redirectUris.map((address) => new URL(address).host).join(", ")}.` : "Google sign-in is off.");
app.log.info(fcm ? `The app's notifications are on (Firebase project ${fcm.projectId}).` : "The app's notifications are off.");

app.log.info(limits ? `Limits are kept over a restart (${limits.names.length} of them).` : "Limits are kept in memory only.");
limits?.every(60_000);

await app.listen({ port, host });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info(`${signal}: saving and stopping.`);
    limits?.stop();
    limits?.save();
    setTimeout(() => process.exit(1), 8000).unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
