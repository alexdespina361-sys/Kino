import { useEffect, useRef, useState, type ComponentType, type ReactElement } from "react";
import { useT } from "../i18n";
import { thisTier } from "../role";
import { checkForUpdate } from "../shared/update";
import { useBack } from "./dpad";
import { BackButton, Screen } from "./Idle";

type Closable = { onClose: () => void };
export type Later<P extends Closable> = ((props: P) => ReactElement | null) & { preload: () => Promise<void> };

export function later<P extends Closable>(load: () => Promise<ComponentType<P>>): Later<P> {
  let got: ComponentType<P> | undefined;
  let asking: Promise<ComponentType<P>> | undefined;
  const ask = () =>
    (asking ??= load().then(
      (made) => (got = made),
      (error: unknown) => {
        asking = undefined;
        throw error;
      },
    ));
  function Later(props: P) {
    const [Made, setMade] = useState<ComponentType<P> | undefined>(() => got);
    const [failed, setFailed] = useState(false);
    const tries = useRef(0);
    useEffect(() => {
      if (Made || failed) return;
      let on = true;
      ask().then(
        (made) => on && setMade(() => made),
        () => {
          if (!on) return;
          tries.current += 1;
          if (tries.current > 1) return location.reload();
          setFailed(true);
          void checkForUpdate({ always: true });
        },
      );
      return () => {
        on = false;
      };
    }, [Made, failed]);
    useBack(Made || failed ? undefined : props.onClose);
    if (Made) return <Made {...props} />;
    return failed ? <LaterFailed onClose={props.onClose} onRetry={() => setFailed(false)} /> : null;
  }
  return Object.assign(Later, { preload: () => ask().then(() => undefined, () => undefined) });
}

function LaterFailed({ onClose, onRetry }: { onClose: () => void; onRetry: () => void }) {
  const t = useT();
  return (
    <Screen testId="tv-later-failed" compact focus onBack={onClose}>
      <BackButton onClick={onClose} testId="tv-later-back" />
      <h1 className="tv-headline tv-headline-small">{t("common.screenFailed")}</h1>
      <button type="button" className="tv-action" data-nav data-autofocus onClick={onRetry} data-testid="tv-later-retry">
        {t("common.retry")}
      </button>
    </Screen>
  );
}

const START_MS = { full: 1500, lite: 8000 } as const;
const GAP_MS = { full: 300, lite: 2500 } as const;
const BUSY_MS = 5000;
let warming = false;

export function warmLater(loads: readonly (() => Promise<unknown>)[]): void {
  if (warming || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  warming = true;
  const tier = thisTier();
  const queue = [...loads];
  const whenIdle = (run: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 400));
  const busy = () => document.visibilityState !== "visible" || Array.from(document.querySelectorAll("video")).some((video) => !video.paused && !video.ended);
  const next = (wait: number): void => {
    if (queue.length === 0) return;
    setTimeout(
      () =>
        whenIdle(() => {
          if (busy()) return next(BUSY_MS);
          const load = queue.shift();
          if (load) void load().then(() => next(GAP_MS[tier]), () => next(GAP_MS[tier]));
        }),
      wait,
    );
  };
  next(START_MS[tier]);
}
