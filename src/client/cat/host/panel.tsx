import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useT, type Key } from "../../i18n";
import { useHandHeldBack } from "../../shared/backButton";
import { CloseIcon } from "../../shared/icons";
import { moveFocus, navItems } from "../../tv/dpad";
import { actionForKey } from "../../tv/keys";
import type { Rng } from "../rng";
import type { CatEvent } from "../types";
import { fits, MOODS, pick, poolOfPage, tileOf, type Candidate, type Mood } from "./assistant";
import { bringIntoView, clearPointed, markPointed } from "./effects";

/**
 * The cat's panel: what the viewer can ask of the cat (come here, be petted, sit, sleep, play, go away) and "find me something". It is a small card
 * in the library's corner that the remote walks like any menu: the arrows move between its buttons, OK presses one, Back steps out (and, from the
 * first screen, closes it and puts the remote back where it was). It does not cover the library like a page: it is not a dialog, the cat stays
 * where it is on the page, and it is the cat that points at what it found. "Open it" opens the title's page, like pressing OK on its poster;
 * nothing here ever plays anything.
 */

export interface PanelProps {
  send: (event: CatEvent) => void;
  /** Asks the cat to go to a poster and point at it. */
  point: (targetId: string) => void;
  rng: Rng;
  close: () => void;
}

type Screen = { name: "menu" } | { name: "mood" } | { name: "pick"; mood: Mood; found: Candidate | null };

function CatPanel({ send, point, rng, close }: PanelProps) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Screen>({ name: "menu" });
  const shown = useRef(new Set<string>());

  const find = useCallback(
    (mood: Mood) => {
      const found = pick(poolOfPage(), mood, shown.current, rng);
      if (found) shown.current.add(found.id);
      setScreen({ name: "pick", mood, found });
    },
    [rng],
  );

  const back = useCallback(() => {
    if (screen.name === "pick") setScreen({ name: "mood" });
    else if (screen.name === "mood") setScreen({ name: "menu" });
    else close();
  }, [screen.name, close]);
  useHandHeldBack(back); // (a phone's or a tablet's own Back steps out of the panel, not out of the page behind it; a TV's is the key below)

  /** The remote's Back and arrows, and everything else it presses, are for the panel while the focus is in it. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation(); // (nothing pressed here is for the library behind)
    if (event.altKey || event.ctrlKey || event.metaKey || !root.current) return;
    const action = actionForKey(event);
    if (action === "back") {
      event.preventDefault();
      back();
    } else if (action === "up" || action === "down" || action === "left" || action === "right") {
      event.preventDefault();
      // (a button over two columns is as near to one as to the other: Down from it goes to the first, which a reader reaches first)
      const here = document.activeElement;
      if (action === "down" && here instanceof HTMLElement && here.classList.contains("cat-wide")) {
        const items = navItems(root.current);
        const next = items[items.indexOf(here) + 1];
        if (next) {
          next.focus({ preventScroll: true });
          return;
        }
      }
      moveFocus(root.current, action);
    }
  };

  // A key pressed while the focus is somewhere else (a click took it) is for the panel too, not for what is behind it.
  useEffect(() => {
    const catchStray = (event: KeyboardEvent) => {
      const inside = root.current;
      if (!inside || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof Node && inside.contains(event.target)) || actionForKey(event) === null) return;
      event.stopPropagation();
      event.preventDefault();
      if (event.type === "keydown") (navItems(inside)[0] ?? inside).focus({ preventScroll: true });
    };
    window.addEventListener("keydown", catchStray, true);
    window.addEventListener("keyup", catchStray, true);
    return () => {
      window.removeEventListener("keydown", catchStray, true);
      window.removeEventListener("keyup", catchStray, true);
    };
  }, []);

  // Each screen starts with the remote on its first button (the one that asks for the most common thing).
  const where = screen.name === "pick" ? `pick:${screen.found?.id ?? "none"}` : screen.name;
  useEffect(() => {
    const inside = root.current;
    if (!inside) return;
    (inside.querySelector<HTMLElement>("[data-autofocus]") ?? navItems(inside)[0] ?? inside).focus({ preventScroll: true });
  }, [where]);

  // What the cat found is brought into view, glows, and is pointed at; it is all put back when the screen goes.
  const found = screen.name === "pick" ? screen.found : null;
  useEffect(() => {
    if (!found) return;
    const tile = tileOf(found.id);
    if (!tile) return;
    bringIntoView(tile);
    markPointed(tile);
    const timer = window.setTimeout(() => point(found.id), 650); // (when the page has stopped moving to show it)
    return () => {
      window.clearTimeout(timer);
      clearPointed();
    };
  }, [found, point]);

  const say = (command: "come" | "sit" | "sleep" | "play" | "away") => {
    send({ type: "cat.command", command });
    close();
  };

  const title = screen.name === "mood" ? t("cat.findAsk") : screen.name === "pick" ? t("cat.find") : t("cat.panel");

  return (
    <div ref={root} className="cat-panel" role="region" aria-label={t("cat.panel")} data-testid="cat-panel" data-screen={screen.name} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="cat-panel-head">
        <h2 className="cat-panel-title">{title}</h2>
        <button type="button" className="cat-x" data-nav onClick={close} aria-label={t("cat.close")} title={t("cat.close")} data-testid="cat-close">
          <CloseIcon />
        </button>
      </div>

      {screen.name === "menu" && (
        <div className="cat-grid" data-cols={2}>
          <button type="button" className="cat-btn cat-btn-primary cat-wide" data-nav data-autofocus onClick={() => setScreen({ name: "mood" })} data-testid="cat-find">
            {t("cat.find")}
          </button>
          <button type="button" className="cat-btn" data-nav onClick={() => say("come")} data-testid="cat-come">
            {t("cat.come")}
          </button>
          <button
            type="button"
            className="cat-btn"
            data-nav
            onClick={() => {
              send({ type: "cat.pet" });
              close();
            }}
            data-testid="cat-pet"
          >
            {t("cat.pet")}
          </button>
          <button type="button" className="cat-btn" data-nav onClick={() => say("sit")} data-testid="cat-sit">
            {t("cat.sit")}
          </button>
          <button type="button" className="cat-btn" data-nav onClick={() => say("sleep")} data-testid="cat-sleep">
            {t("cat.sleep")}
          </button>
          <button type="button" className="cat-btn" data-nav onClick={() => say("play")} data-testid="cat-play">
            {t("cat.play")}
          </button>
          <button type="button" className="cat-btn" data-nav onClick={() => say("away")} data-testid="cat-away">
            {t("cat.away")}
          </button>
        </div>
      )}

      {screen.name === "mood" && (
        <>
          <div className="cat-grid" data-cols={3}>
            {MOODS.map((mood, index) => (
              <button key={mood} type="button" className="cat-btn" data-nav {...(index === 0 ? { "data-autofocus": true } : {})} data-mood={mood} onClick={() => find(mood)} data-testid={`cat-mood-${mood}`}>
                {t(`cat.mood.${mood}` as Key)}
              </button>
            ))}
          </div>
          <div className="cat-foot">
            <button type="button" className="cat-btn cat-quiet" data-nav onClick={back} data-testid="cat-back">
              {t("cat.back")}
            </button>
          </div>
        </>
      )}

      {screen.name === "pick" && (
        <>
          {found ? (
            <div className="cat-card" data-testid="cat-card" data-id={found.id}>
              {found.image && <img className="cat-card-art" src={found.image} alt="" loading="eager" draggable={false} />}
              <p className="cat-card-line">
                {found.year ? t("cat.pickYear", { title: found.title, year: found.year }) : t("cat.pick", { title: found.title })}
                {found.rows[0] && <small className="cat-card-where">{t("cat.pickWhere", { shelf: found.rows.find((row) => fits(screen.mood, row)) ?? found.rows[0] })}</small>}
              </p>
            </div>
          ) : (
            <p className="cat-nothing" data-testid="cat-nothing">
              {t("cat.nothing")}
            </p>
          )}
          <div className="cat-foot" data-cols={found ? 3 : 1}>
            {found && (
              <button
                type="button"
                className="cat-btn cat-btn-primary"
                data-nav
                data-autofocus
                data-testid="cat-open"
                onClick={() => {
                  const tile = tileOf(found.id);
                  close();
                  tile?.click();
                }}
              >
                {t("cat.open")}
              </button>
            )}
            {found && (
              <button type="button" className="cat-btn" data-nav onClick={() => find(screen.mood)} data-testid="cat-another">
                {t("cat.another")}
              </button>
            )}
            <button type="button" className="cat-btn cat-quiet" data-nav {...(found ? {} : { "data-autofocus": true })} onClick={back} data-testid="cat-back">
              {t("cat.back")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export interface PanelHandle {
  unmount: () => void;
  /** The panel's own box, for the page to keep the cat out of it. */
  element: () => HTMLElement | null;
}

/** Puts the panel in `container` (a node the host made on the TV's screen). */
export function mountPanel(container: HTMLElement, props: PanelProps): PanelHandle {
  const react: Root = createRoot(container);
  react.render(<CatPanel {...props} />);
  return {
    unmount: () => react.unmount(),
    element: () => container.querySelector<HTMLElement>(".cat-panel"),
  };
}
