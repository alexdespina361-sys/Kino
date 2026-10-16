import { useLayoutEffect, useRef, type MouseEvent } from "react";
import type { SearchBox } from "./librarySearch";

/**
 * The search box of a screen that has no field of its own to type in (the keys under it are the keyboard): the text with its caret in it.
 * A click puts the caret where it landed (before a character when its left half was hit, after it when its right half was, at the end
 * when it landed past the text), so a slip in the middle is mended without typing all of it again. The text scrolls with the caret
 * when it is longer than the box.
 */
export function SearchField({ box, hint, onPlace }: { box: SearchBox; hint: string; onPlace: (caret: number) => void }) {
  const field = useRef<HTMLParagraphElement>(null);
  const { text } = box;
  const caret = Math.max(0, Math.min(box.caret, text.length));

  // The caret stays in view: a text longer than the box is moved under it, with a little of what lies beyond showing.
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

  const place = (event: MouseEvent<HTMLElement>) => {
    const hit = (event.target as HTMLElement).closest<HTMLElement>("[data-at]");
    if (hit) {
      const spot = hit.getBoundingClientRect();
      return onPlace(Number(hit.dataset.at) + (event.clientX > spot.left + spot.width / 2 ? 1 : 0));
    }
    // (not on a character: left of the first one is the start, anywhere else is the end)
    const first = field.current?.querySelector<HTMLElement>("[data-at]");
    onPlace(first && event.clientX < first.getBoundingClientRect().left ? 0 : text.length);
  };

  const characters = text.split("").map((char, at) => (
    <span key={at} data-at={at}>
      {char}
    </span>
  ));
  const mark = <i className="tv-caret" key={`caret-${caret}-${text.length}`} />; // (a new one at every move: the blink starts over, as it does in a field)

  return (
    <p className="tv-query" data-testid="tv-query" data-caret={caret} aria-live="polite" ref={field} onClick={place}>
      {text ? (
        <span className="tv-query-text">
          {characters.slice(0, caret)}
          {mark}
          {characters.slice(caret)}
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
