import type { SyncStarter } from "../tv/engine";
import { assetUrl } from "./assets";
import { WorkerBackend } from "./backend";
import { livePcm } from "./capture";
import { canDecode, decodeToMono16k } from "./decode";
import { CrashGuard, type Kept } from "./guard";
import { SyncSession, type HlsLike, type VideoLike } from "./session";
import { httpShared } from "./share";
import { startWhistle, Unsupported, type Recogniser } from "./whistle";

const kept: Kept = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
    }
  },
};

const STILL: HlsLike = { on: () => undefined, off: () => undefined };

export const startSync: SyncStarter = (film) => {
  if (!canDecode() || typeof Worker === "undefined") return undefined;
  const guard = new CrashGuard(kept);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  const session = new SyncSession({
    video: film.video as unknown as VideoLike,
    hls: (film.hls ?? STILL) as unknown as HlsLike,
    events: film.events ?? { audioSwitching: "none" },
    tap: film.tap,
    ...(film.live ? { live: true } : {}),
    show: film.show,
    report: film.report,
    ...(film.delay ? { delay: film.delay } : {}),
    backend: () => WorkerBackend.start(assetUrl("silero-vad-16k.bin")),
    decode: film.live ? livePcm : decodeToMono16k,
    shared: httpShared(),
    ...(film.offer ? { offer: film.offer } : {}),
    cores: navigator.hardwareConcurrency || 4,
    ...(film.light ? { light: film.light } : {}),
    log: (message) => console.debug("[Kino subtitle sync]", message),
    recogniser: async (): Promise<Recogniser> => {
      if (memory !== undefined && memory < 2) throw new Unsupported("Not enough memory for the recogniser");
      if (!guard.begin()) throw new Unsupported("The recogniser has taken this page down before");
      let recogniser: Recogniser;
      try {
        recogniser = await startWhistle();
      } catch (error) {
        guard.interrupted();
        throw error;
      }
      let proved = false;
      return {
        async hear(pcm) {
          const words = await recogniser.hear(pcm);
          if (!proved) {
            proved = true;
            guard.proved();
          }
          return words;
        },
        close: () => recogniser.close(),
      };
    },
  });
  const leaving = () => {
    session.flush();
    guard.interrupted();
  };
  addEventListener("pagehide", leaving);
  session.start();
  return {
    close(restore) {
      removeEventListener("pagehide", leaving);
      session.close(restore);
      guard.interrupted();
    },
  };
};
