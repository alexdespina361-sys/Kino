import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { t, useT } from "../i18n";
import { formatRemaining, formatTime } from "../shared/format";

interface SeekBarProps {
  currentTime: number;
  duration: number;
  /** Where the buffered part ends, in seconds. */
  buffered?: number;
  /** Called once when the finger lets go (or an arrow key is pressed), never while dragging. */
  onSeek: (time: number) => void;
}

/**
 * Progress bar you can drag. While dragging it shows where you'd land and keeps ignoring the TV's own
 * time updates, so the thumb doesn't fight the finger; the seek is sent once, on release.
 */
export function SeekBar({ currentTime, duration, buffered = 0, onSeek }: SeekBarProps) {
  useT();
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? currentTime;
  const percent = (time: number) => (duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0);

  const timeAt = (event: PointerEvent) => {
    const rect = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
    if (!step) return;
    event.preventDefault();
    onSeek(Math.max(0, Math.min(duration, currentTime + step)));
  };

  return (
    <div className="seek" data-testid="time" data-current={Math.floor(shown)} data-duration={Math.floor(duration)}>
      <div
        ref={barRef}
        className={`seek-bar ${drag !== null ? "dragging" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label={t("hud.seek")}
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(shown)}
        aria-valuetext={formatTime(shown)}
        data-testid="seek"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (duration <= 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag(timeAt(event));
        }}
        onPointerMove={(event) => drag !== null && setDrag(timeAt(event))}
        onPointerUp={(event) => {
          if (drag === null) return;
          onSeek(timeAt(event));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="seek-track">
          <div className="seek-buffered" style={{ width: `${percent(buffered)}%` }} />
          <div className="seek-fill" style={{ width: `${percent(shown)}%` }} />
          <div className="seek-thumb" style={{ left: `${percent(shown)}%` }} />
        </div>
        {drag !== null && (
          <div className="seek-bubble" style={{ left: `${percent(drag)}%` }}>
            {formatTime(drag)}
          </div>
        )}
      </div>
      <div className="seek-times">
        <span>{formatTime(shown)}</span>
        <span>{formatRemaining(shown, duration)}</span>
      </div>
    </div>
  );
}
