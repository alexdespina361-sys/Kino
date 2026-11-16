/**
 * The ✦ choices on the TV page (see offers.ts and enhancer.ts): which this film gets, the one this device keeps on from film to film, and the
 * enhancer that draws it, started for each film (and loaded only then). What it says on screen goes through `say`.
 */

import { useEffect, useRef, useState } from "react";
import type { EnhanceMode, EnhanceProblem, EnhanceTier, PlayerState } from "../../shared";
import { t } from "../i18n";
import { enhanceName } from "../shared/words";
import type { Enhancer, EnhanceStatus } from "./enhancer";
import { biggest, CHOICE_KEY, enhanceOffers, readChoice, type EnhanceOffer, type Size } from "./offers";

/** Whether this page could redraw a picture at all (WebGL 2, and a video that says when each frame comes): checked once, without making anything. */
const canRedraw = (): boolean =>
  typeof WebGL2RenderingContext !== "undefined" && typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

function readKept(): EnhanceOffer | "off" {
  try {
    return readChoice(localStorage.getItem(CHOICE_KEY));
  } catch {
    return "off";
  }
}

function keep(choice: EnhanceOffer | "off"): void {
  try {
    if (choice === "off") localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // (a browser that keeps nothing asks again for each film)
  }
}

export interface EnhanceInput {
  video: HTMLVideoElement | null;
  /** Where the enhancer puts its canvas: a layer over the video that takes no taps. */
  host: HTMLElement | null;
  /** The film (its stream): a new one starts afresh. */
  film: string | undefined;
  player: PlayerState;
  /** The page may read the film's frames (the engine's `pictureReadable`). */
  readable: boolean;
  say: (text: string) => void;
}

interface Running {
  mode: EnhanceMode;
  tier?: EnhanceTier | undefined;
  problem?: EnhanceProblem | undefined;
}

const tierName = (tier: EnhanceTier | undefined): string => (tier === "anime" ? "Anime4K" : "FSR 1");

export function useEnhance({ video, host, film, player, readable, say }: EnhanceInput): { state: NonNullable<PlayerState["enhance"]> | undefined; choose: (mode: EnhanceMode) => void } {
  const [choice, setChoice] = useState<EnhanceOffer | "off">(readKept);
  /** Each pick is a new attempt, the same choice again too (after it ended by itself on this film). */
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState<Running>({ mode: "off" });
  /** The next start is someone's pick, not a choice kept from the film before (enhancer.ts `start`). */
  const pickedRef = useRef(false);
  const sayRef = useRef(say);
  sayRef.current = say;

  const showing = player.state !== "idle" && player.state !== "error";
  const best: Size | undefined = biggest(player.quality?.levels ?? []) ?? (video && video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : undefined);
  const offers = showing && film ? enhanceOffers(best, { upscale: readable && canRedraw() }) : [];
  const wanted: EnhanceMode = choice !== "off" && offers.includes(choice) ? choice : "off";

  useEffect(() => {
    if (wanted === "off" || !video || !host) return;
    let enhancer: Enhancer | undefined;
    /** No more from this enhancer: it ended by itself (`ended`, and what it said stays shown), or the effect is left. */
    let over = false;
    let ended = false;
    const mode = wanted;
    const picked = pickedRef.current;
    pickedRef.current = false;
    setRunning({ mode });
    const onStatus = (status: EnhanceStatus) => {
      if (over) return;
      const name = enhanceName(mode);
      if (status.tier && status.drawing) {
        setRunning({ mode, tier: status.tier });
        sayRef.current(t("notice.enhanceOn", { mode: name, by: tierName(status.tier) }));
      } else if (status.tier) {
        setRunning({ mode, tier: status.tier, problem: status.problem });
        sayRef.current(t("notice.enhanceStepDown", { mode: name }));
      } else {
        // It ended by itself. The choice stays for the films after this one (a film that may not be read; a size of picture too big for this device,
        // which is remembered and left off for that size: enhancer.ts), except when the graphics failed.
        over = true;
        ended = true;
        setRunning({ mode: "off", problem: status.problem });
        if (status.problem === "failed") {
          setChoice("off");
          keep("off");
        }
        if (status.quiet) return;
        sayRef.current(t(status.problem === "unreadable" ? "notice.enhanceUnreadable" : status.problem === "slow" ? "notice.enhanceSlow" : "notice.enhanceFailed", { mode: name }));
      }
    };
    void import("./enhancer")
      .then(({ Enhancer }) => {
        if (over) return;
        enhancer = new Enhancer(video, host, onStatus);
        return enhancer.start(picked);
      })
      .catch(() => onStatus({ drawing: false, problem: "failed" }));
    return () => {
      over = true;
      enhancer?.stop();
      if (!ended) setRunning({ mode: "off" });
    };
  }, [wanted, film, video, host, attempt]);

  const choose = (mode: EnhanceMode) => {
    const next = mode === "off" ? "off" : mode;
    if (next !== "off" && next === choice && running.mode === next && !running.problem) return; // (on already: nothing to start again)
    if (next === "off" && running.mode !== "off") say(t("notice.enhanceOff", { mode: enhanceName(running.mode) }));
    pickedRef.current = next !== "off";
    setChoice(next);
    keep(next);
    setAttempt((count) => count + 1);
  };

  const state = offers.length > 0 || running.problem ? { offers, current: running.mode, ...(running.tier ? { tier: running.tier } : {}), ...(running.problem ? { problem: running.problem } : {}) } : undefined;
  return { state, choose };
}
