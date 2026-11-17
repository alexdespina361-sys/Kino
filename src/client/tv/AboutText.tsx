import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

/**
 * A title's description on its page: cut to a few lines by the page's style, with "Show more…" under it when it was cut, which shows the rest
 * ("Show less" puts it back). The button is only there when something is hidden (the owner, 17 Nov). It is reached by a finger, a mouse or Tab;
 * the remote's arrows keep to the page's buttons.
 */
export function AboutText({ text, className }: { text: string; className: string }) {
  const t = useT();
  const box = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useEffect(() => setOpen(false), [text]);
  useEffect(() => {
    const element = box.current;
    if (!element || open) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, [text, open]);

  return (
    <>
      <p ref={box} className={`${className}${open ? " is-open" : ""}`} data-testid="about-text">
        {text}
      </p>
      {(cut || open) && (
        <button
          type="button"
          className="about-more"
          aria-expanded={open}
          data-testid="about-more"
          onClick={(event) => {
            event.stopPropagation(); // (a press on the page beside its content closes it: this one is not beside it)
            setOpen((was) => !was);
          }}
        >
          {t(open ? "library.aboutLess" : "library.aboutMore")}
        </button>
      )}
    </>
  );
}
