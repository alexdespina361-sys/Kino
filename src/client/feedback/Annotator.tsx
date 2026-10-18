import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT, type Key } from "../i18n";
import { ArrowIcon, BoxIcon, CheckIcon, CloseIcon, CoverIcon, OvalIcon, PencilIcon, RedoIcon, TextIcon, TrashIcon, UndoIcon } from "../shared/icons";
import type { Piece } from "./images";
import { COLORS, COLOR_NAMES, isMark, LETTERS, paintShapes, toUnit, TOOLS, WIDTHS, type Color, type Point, type Shape, type Tool } from "./shapes";

const TOOL_ICONS: Record<Tool, typeof OvalIcon> = { circle: OvalIcon, arrow: ArrowIcon, box: BoxIcon, draw: PencilIcon, text: TextIcon, hide: CoverIcon };

interface Props {
  piece: Piece;
  /** Done: the marks as they are now. */
  onDone: (shapes: Shape[]) => void;
  /** Leave the picture as it was. */
  onCancel: () => void;
}

interface Box {
  width: number;
  height: number;
}

interface Word {
  at: Point;
  value: string;
}

/** The largest box of this shape that fits in a space. */
export function fitBox(space: Box, picture: Box): Box {
  if (space.width <= 0 || space.height <= 0 || picture.width <= 0 || picture.height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(space.width / picture.width, space.height / picture.height);
  return { width: Math.floor(picture.width * scale), height: Math.floor(picture.height * scale) };
}

/** Sets the size of a canvas only when it changes (setting it empties it, and takes time on a big one), and gives it back empty. */
function emptied(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, width, height);
  return context;
}

/**
 * The marks that point at the trouble: a circle round it, an arrow to it, a box, a line by hand, a word, and a block over what is private. A mark is
 * kept as numbers across the picture (shapes.ts), so it is the same on this screen and on the picture that is sent.
 */
export function Annotator({ piece, onDone, onCancel }: Props) {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<Box>({ width: 0, height: 0 });
  const [shapes, setShapes] = useState<Shape[]>(piece.shapes);
  const [undone, setUndone] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [tool, setTool] = useState<Tool>("circle");
  const [color, setColor] = useState<Color>(COLORS[0]);
  const [size, setSize] = useState(1);
  // The word being typed: kept in a ref as well, since the one place that ends it (a press elsewhere) and the other (the field losing focus) come in one breath.
  const [word, setWordState] = useState<Word | null>(null);
  const wordRef = useRef<Word | null>(null);
  const setWord = useCallback((next: Word | null) => {
    wordRef.current = next;
    setWordState(next);
  }, []);
  const field = useRef<HTMLInputElement>(null);
  const latest = useRef({ color, size });
  latest.current = { color, size };
  const placing = useRef<Point | null>(null);

  useEffect(() => {
    let alive = true;
    const loaded = new Image();
    loaded.onload = () => alive && setImage(loaded);
    loaded.src = piece.url;
    return () => {
      alive = false;
      loaded.onload = null;
    };
  }, [piece.url]);

  // The room there is, and the picture in it as large as it will go.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !image) return;
    const measure = () => setBox(fitBox({ width: element.clientWidth, height: element.clientHeight }, { width: image.naturalWidth, height: image.naturalHeight }));
    measure();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [image]);

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelsWide = Math.round(box.width * ratio);
  const pixelsHigh = Math.round(box.height * ratio);
  // The picture itself: drawn again only when its size changes.
  useLayoutEffect(() => {
    const canvas = base.current;
    if (!canvas || !image || box.width === 0) return;
    emptied(canvas, pixelsWide, pixelsHigh)?.drawImage(image, 0, 0, pixelsWide, pixelsHigh);
  }, [image, box.width, pixelsWide, pixelsHigh]);
  // What is drawn on it: every time a mark is added, changed, or taken off.
  useLayoutEffect(() => {
    const canvas = top.current;
    if (!canvas || box.width === 0) return;
    const context = emptied(canvas, pixelsWide, pixelsHigh);
    if (context) paintShapes(context, draft ? [...shapes, draft] : shapes, pixelsWide, pixelsHigh);
  }, [shapes, draft, box.width, pixelsWide, pixelsHigh]);

  /** The word being typed becomes part of the picture (an empty one is nothing). */
  const commitWord = useCallback(() => {
    const now = wordRef.current;
    if (!now) return;
    setWord(null);
    const value = now.value.trim();
    if (!value) return;
    setShapes((all) => [...all, { kind: "text", at: now.at, text: value, color: latest.current.color, size: latest.current.size }]);
    setUndone([]);
  }, [setWord]);

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): Point => toUnit(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const at = pointAt(event);
    commitWord();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "text") {
      placing.current = at; // (the word is put down when the finger is lifted: a keyboard that opens needs the press to be over)
      return;
    }
    setDraft(tool === "draw" ? { kind: "draw", points: [at], color, size } : { kind: tool, from: at, to: at, color, size });
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    const at = pointAt(event);
    setDraft((now) => {
      if (!now || now.kind === "text") return now;
      if (now.kind === "draw") return { ...now, points: [...now.points, at] };
      return { ...now, to: at };
    });
  };
  const onPointerEnd = () => {
    if (placing.current) {
      setWord({ at: placing.current, value: "" });
      placing.current = null;
      field.current?.focus({ preventScroll: true });
      return;
    }
    if (draft && isMark(draft, box.width, box.height)) {
      setShapes((all) => [...all, draft]);
      setUndone([]);
    }
    setDraft(null);
  };

  const undo = () => {
    commitWord();
    setShapes((all) => {
      const last = all[all.length - 1];
      if (last) setUndone((more) => [...more, last]);
      return all.slice(0, -1);
    });
  };
  const redo = () =>
    setUndone((more) => {
      const last = more[more.length - 1];
      if (last) setShapes((all) => [...all, last]);
      return more.slice(0, -1);
    });
  const clear = () => {
    setWord(null);
    setUndone([]);
    setShapes([]);
  };

  const finish = () => {
    // (A word that is still being typed is part of the picture.)
    const now = wordRef.current;
    const value = now?.value.trim();
    onDone(now && value ? [...shapes, { kind: "text", at: now.at, text: value, color, size }] : shapes);
  };

  const letters = Math.max(10, (LETTERS[size] ?? LETTERS[1]) * Math.min(box.width, box.height));

  return (
    <div className="fb-annotate" data-testid="fb-annotate">
      <div className="fb-annotate-top">
        <button type="button" className="fb-mini fb-mini-quiet" data-nav data-testid="fb-annotate-cancel" onClick={onCancel}>
          <CloseIcon />
          <span>{t("common.cancel")}</span>
        </button>
        <h2 className="fb-annotate-title" id="fb-title">
          {t("feedback.mark.title")}
        </h2>
        <button type="button" className="fb-done" data-nav data-testid="fb-annotate-done" onClick={finish}>
          <CheckIcon />
          <span>{t("common.done")}</span>
        </button>
      </div>
      <div className="fb-annotate-stage" ref={stage}>
        {image ? (
          <div className="fb-annotate-box" style={{ width: box.width, height: box.height }}>
            <canvas ref={base} className="fb-annotate-base" style={{ width: box.width, height: box.height }} aria-hidden="true" />
            <canvas
              ref={top}
              className="fb-annotate-ink"
              style={{ width: box.width, height: box.height }}
              role="img"
              aria-label={t("feedback.mark.canvas")}
              data-testid="fb-annotate-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
            />
            {tool === "text" ? (
              <input
                ref={field}
                className={`fb-annotate-word${word ? "" : " is-idle"}`}
                style={word ? { left: `${word.at[0] * 100}%`, top: `${word.at[1] * 100}%`, color, fontSize: `${letters}px`, maxWidth: `${(1 - word.at[0]) * 100}%` } : undefined}
                value={word?.value ?? ""}
                maxLength={120}
                aria-label={t("feedback.mark.word")}
                tabIndex={word ? 0 : -1}
                data-testid="fb-annotate-word"
                onChange={(event) => word && setWord({ ...word, value: event.target.value })}
                onBlur={commitWord}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    commitWord();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation(); // (it ends the word, not the whole marking)
                    setWord(null);
                  }
                }}
              />
            ) : null}
          </div>
        ) : (
          <span className="spinner" />
        )}
        {/* What the tool needs, said over the picture for a few seconds (not in the bar: the picture would change size each time it came and went). */}
        {tool === "hide" || tool === "text" ? (
          <p key={tool} className="fb-hint fb-annotate-hint" role="note">
            {t(tool === "hide" ? "feedback.mark.hideHint" : "feedback.mark.textHint")}
          </p>
        ) : null}
      </div>
      <div className="fb-annotate-bar">
        <div className="fb-tools" role="radiogroup" aria-label={t("feedback.mark.tools")}>
          {TOOLS.map((each) => {
            const Icon = TOOL_ICONS[each];
            return (
              <button
                key={each}
                type="button"
                role="radio"
                aria-checked={tool === each}
                className={`fb-tool${tool === each ? " is-on" : ""}`}
                data-nav
                data-testid={`fb-tool-${each}`}
                onClick={() => {
                  commitWord();
                  setTool(each);
                }}
              >
                <Icon />
                <span>{t(`feedback.mark.${each}` as Key)}</span>
              </button>
            );
          })}
        </div>
        <div className="fb-annotate-row">
          <div className="fb-colors" role="radiogroup" aria-label={t("feedback.mark.colors")}>
            {COLORS.map((each) => (
              <button
                key={each}
                type="button"
                role="radio"
                aria-checked={color === each}
                aria-label={t(`feedback.mark.color.${COLOR_NAMES[each]}` as Key)}
                className={`fb-color${color === each ? " is-on" : ""}`}
                style={{ background: each }}
                data-nav
                data-testid={`fb-color-${COLOR_NAMES[each]}`}
                onClick={() => setColor(each)}
              />
            ))}
          </div>
          <div className="fb-sizes" role="radiogroup" aria-label={t("feedback.mark.sizes")}>
            {WIDTHS.map((width, index) => (
              <button
                key={width}
                type="button"
                role="radio"
                aria-checked={size === index}
                aria-label={t(`feedback.mark.size.${index}` as Key)}
                className={`fb-size${size === index ? " is-on" : ""}`}
                data-nav
                data-testid={`fb-size-${index}`}
                onClick={() => setSize(index)}
              >
                <span style={{ width: 6 + index * 5, height: 6 + index * 5 }} />
              </button>
            ))}
          </div>
          <div className="fb-history">
            <button type="button" className="fb-icon-button" data-nav data-testid="fb-undo" aria-label={t("feedback.mark.undo")} disabled={shapes.length === 0} onClick={undo}>
              <UndoIcon />
            </button>
            <button type="button" className="fb-icon-button" data-nav data-testid="fb-redo" aria-label={t("feedback.mark.redo")} disabled={undone.length === 0} onClick={redo}>
              <RedoIcon />
            </button>
            <button type="button" className="fb-icon-button" data-nav data-testid="fb-clear" aria-label={t("feedback.mark.clear")} disabled={shapes.length === 0} onClick={clear}>
              <TrashIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
