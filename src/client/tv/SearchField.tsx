import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import { selectionOf, type BoxEdit, type SearchBox } from "./librarySearch";

/**
 * The search box of a screen that has no field of its own to type in (the keys under it are the keyboard): the text with its caret in it.
 * A click puts the caret where it landed along the text (before a character when it was left of its middle, at the end when it was past
 * them all, whatever was under it: the box's padding, the line above), so a slip in the middle is mended without typing all of it
 * again. Dragging over the text selects it, as do a double click (a word), a triple click (all of it), and a click with Shift (from the caret);
 * what is selected is lit, and typing, Delete, Ctrl+X and the keys of the page act on it (Browse.tsx). The text scrolls with the caret when it is
 * longer than the box.
 */
export function SearchField({ box, hint, onEdit }: { box: SearchBox; hint: string; onEdit: (change: BoxEdit) => void }) {
  const field = useRef<HTMLParagraphElement>(null);
  const { text } = box;
  const caret = Math.max(0, Math.min(box.caret, text.length));
  const part = selectionOf(box);
  /** Where a drag with the mouse began, while the button is held. */
  const dragFrom = useRef<number | null>(null);
  const latest = useRef(onEdit);
  latest.current = onEdit;

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

  /** The place in the text under a point: by its distance along the line alone, the first character whose middle is right of it is the one the place is before. */
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
    event.preventDefault(); // (the page is not one to select: the box draws its own selection)
    const at = placeAt(event.clientX);
    if (event.detail >= 3) return onEdit({ kind: "selectAll" });
    if (event.detail === 2) return onEdit({ kind: "selectWord", at });
    if (event.shiftKey) return onEdit({ kind: "move", to: at, extend: true });
    onEdit({ kind: "move", to: at });
    dragFrom.current = at;
  };

  // While the button is held after a press in the box, the selection follows the pointer, even outside the box; letting go ends it.
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
    // (placeAt reads the drawn letters as they are at the time: nothing of it is kept from one drawing to the next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // (a character is a code point, and `at` is where it starts in the text, which is what the caret counts in: an emoji is one span, two places wide)
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
  // (a new one at every move: the blink starts over, as it does in a field; while something is selected it is the selection's end that is shown, lit, not a blinking line)
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
