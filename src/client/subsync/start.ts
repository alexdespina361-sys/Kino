import type { SyncStarter } from "../tv/engine";
import { assetUrl } from "./assets";
import { WorkerBackend } from "./backend";
import { canDecode, decodeToMono16k } from "./decode";
import { CrashGuard, type Kept } from "./guard";
import { SyncSession, type HlsLike, type VideoLike } from "./session";
import { httpShared } from "./share";
import { startWhistle, Unsupported, type Recogniser } from "./whistle";

/** The page's own storage, if it lets itself be used (a private window may not). */
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
      // (Nothing can be kept; the guard does not get in the way.)
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // (As above.)
    }
  },
};

/**
 * The subtitle aligner for a film that plays through hls.js, with the real worker, decoder and recogniser. This module is fetched
 * by the TV page when a film starts (the page does not carry it before), and everything it needs from the browser is checked here:
 * a device that cannot do it gets no aligner, and the picture is not affected.
 */
export const startSync: SyncStarter = (film) => {
  if (!canDecode() || typeof Worker === "undefined") return undefined;
  const guard = new CrashGuard(kept);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  const session = new SyncSession({
    // (The cues of a subtitle track are VTTCues, which carry the text the library's cue type asks for.)
    video: film.video as unknown as VideoLike,
    hls: film.hls as unknown as HlsLike,
    events: film.events,
    tap: film.tap,
    show: film.show,
    report: film.report,
    ...(film.delay ? { delay: film.delay } : {}),
    backend: () => WorkerBackend.start(assetUrl("silero-vad-16k.bin")),
    decode: decodeToMono16k,
    // (What other screens left of this film's subtitles, and a way to leave what this one finds: see share.ts.)
    shared: httpShared(),
    cores: navigator.hardwareConcurrency || 4,
    log: (message) => console.debug("[Kino subtitle sync]", message),
    recogniser: async (): Promise<Recogniser> => {
      // The model is 17 MB and needs a good deal of memory: a device that is short of it, or has fallen over on it before, does without.
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
    session.flush(); // (what was found and not yet left goes to the server while the page can still send it)
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
