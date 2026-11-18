import { useEffect, useRef, useState } from "react";
import type { EnhanceMode, EnhanceProblem, EnhanceTier, PlayerState } from "../../shared";
import { t } from "../i18n";
import { enhanceName } from "../shared/words";
import type { Enhancer, EnhanceStatus } from "./enhancer";
import { biggest, CHOICE_KEY, enhanceOffers, readChoice, type EnhanceOffer, type Size } from "./offers";

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
  }
}

export interface EnhanceInput {
  video: HTMLVideoElement | null;
  host: HTMLElement | null;
  film: string | undefined;
  player: PlayerState;
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
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState<Running>({ mode: "off" });
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
    if (next !== "off" && next === choice && running.mode === next && !running.problem) return;
    if (next === "off" && running.mode !== "off") say(t("notice.enhanceOff", { mode: enhanceName(running.mode) }));
    pickedRef.current = next !== "off";
    setChoice(next);
    keep(next);
    setAttempt((count) => count + 1);
  };

  const state = offers.length > 0 || running.problem ? { offers, current: running.mode, ...(running.tier ? { tier: running.tier } : {}), ...(running.problem ? { problem: running.problem } : {}) } : undefined;
  return { state, choose };
}
