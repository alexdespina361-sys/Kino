import { useLayoutEffect, useRef, type MouseEvent } from "react";
import type { SearchBox } from "./librarySearch";

/**
 * The search box of a screen that has no field of its own to type in (the keys under it are the keyboard): the text with its caret in it.
 * A click puts the caret where it landed along the text (before a character when it was left of its middle, at the end when it was past
 * them all, whatever was under it: the box's padding, the line above), so a slip in the middle is mended without typing all of it
 * again. The text scrolls with the caret when it is longer than the box.
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
    // (by the click's distance along the line alone: the first character whose middle is right of it is the one the caret goes before)
    const drawn = Array.from(field.current?.querySelectorAll<HTMLElement>("[data-at]") ?? []);
    const next = drawn.find((letter) => {
      const spot = letter.getBoundingClientRect();
      return event.clientX < spot.left + spot.width / 2;
    });
    onPlace(next ? Number(next.dataset.at) : text.length);
  };

  // (a character is a code point, and `at` is where it starts in the text, which is what the caret counts in: an emoji is one span, two places wide)
  let start = 0;
  const letters = Array.from(text, (char) => {
    const here = { char, at: start };
    start += char.length;
    return here;
  });
  const spans = (some: typeof letters) =>
    some.map(({ char, at }) => (
      <span key={at} data-at={at}>
        {char}
      </span>
    ));
  const mark = <i className="tv-caret" key={`caret-${caret}-${text.length}`} />; // (a new one at every move: the blink starts over, as it does in a field)

  return (
    <p className="tv-query" data-testid="tv-query" data-caret={caret} aria-live="polite" ref={field} onClick={place}>
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
