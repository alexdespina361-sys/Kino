import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import { selectionOf, type BoxEdit, type SearchBox } from "./librarySearch";

export function SearchField({ box, hint, onEdit }: { box: SearchBox; hint: string; onEdit: (change: BoxEdit) => void }) {
  const field = useRef<HTMLParagraphElement>(null);
  const { text } = box;
  const caret = Math.max(0, Math.min(box.caret, text.length));
  const part = selectionOf(box);
  const dragFrom = useRef<number | null>(null);
  const latest = useRef(onEdit);
  latest.current = onEdit;

  useLayoutEffect(() => {
    const outer = field.current;
    const mark = outer?.querySelector<HTMLElement>(".tv-caret");
    if (!outer || !mark) return;
    const room = parseFloat(getComputedStyle(outer).fontSize) * 1.2;
    const view = outer.getBoundingClientRect();
    const at = mark.getBoundingClientRect();
    if (at.right > view.right - room) outer.scrollLeft += at.right - (view.right - room);
    else if (at.left < view.left + room) outer.scrollLeft -= view.left + room - at.left;
  }, [text, caret]);

  const placeAt = (x: number) => {
    const drawn = Array.from(field.current?.querySelectorAll<HTMLElement>("[data-at]") ?? []);
    const next = drawn.find((letter) => {
      const spot = letter.getBoundingClientRect();
      return x < spot.left + spot.width / 2;
    });
    return next ? Number(next.dataset.at) : text.length;
  };

  const press = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const at = placeAt(event.clientX);
    if (event.detail >= 3) return onEdit({ kind: "selectAll" });
    if (event.detail === 2) return onEdit({ kind: "selectWord", at });
    if (event.shiftKey) return onEdit({ kind: "move", to: at, extend: true });
    onEdit({ kind: "move", to: at });
    dragFrom.current = at;
  };

  useEffect(() => {
    const move = (event: globalThis.MouseEvent) => {
      if (dragFrom.current === null) return;
      if ((event.buttons & 1) === 0) {
        dragFrom.current = null;
        return;
      }
      latest.current({ kind: "select", from: dragFrom.current, to: placeAt(event.clientX) });
    };
    const release = () => (dragFrom.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", release);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  let start = 0;
  const letters = Array.from(text, (char) => {
    const here = { char, at: start };
    start += char.length;
    return here;
  });
  const spans = (some: typeof letters) =>
    some.map(({ char, at }) => (
      <span key={at} data-at={at} className={part && at >= part.start && at < part.end ? "is-selected" : undefined}>
        {char}
      </span>
    ));
  const mark = <i className={`tv-caret${part ? " is-still" : ""}`} key={`caret-${caret}-${text.length}`} />;

  return (
    <p
      className="tv-query"
      data-testid="tv-query"
      data-caret={caret}
      data-selected={part ? `${part.start}-${part.end}` : undefined}
      aria-live="polite"
      ref={field}
      onMouseDown={press}
    >
      {text ? (
        <span className="tv-query-text">
          {spans(letters.filter((one) => one.at < caret))}
          {mark}
          {spans(letters.filter((one) => one.at >= caret))}
        </span>
      ) : (
        <>
          {mark}
          <span className="tv-query-hint">{hint}</span>
        </>
      )}
    </p>
  );
}
