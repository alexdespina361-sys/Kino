import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

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
            event.stopPropagation();
            setOpen((was) => !was);
          }}
        >
          {t(open ? "library.aboutLess" : "library.aboutMore")}
        </button>
      )}
    </>
  );
}
