import { useState, type Ref } from "react";
import type { PlayerState } from "../../shared";
import { formatEndsAt, formatRemaining, formatTime, friendlyError } from "../shared/format";
import {
  Back10Icon,
  Forward10Icon,
  FullscreenIcon,
  ListIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  StopIcon,
  SubtitlesIcon,
} from "../shared/icons";
import type { MenuKind } from "./Menu";
import { SKIP_SECONDS } from "./keys";

export interface HudProps {
  visible: boolean;
  player: PlayerState;
  title: string;
  /** "Season 1, Episode 3" */
  subTitle: string;
  /** "S1:E3" */
  badge: string;
  clock: string;
  /** Label of the next episode, when there is one. */
  nextLabel: string | null;
  /** Label of the episode before this one, when there is one. */
  prevLabel: string | null;
  /** Which source is playing, when the video has more than one. */
  sourceLabel: string | null;
  /** How many episodes the source listed (0 for movies); the Episodes button appears with two or more. */
  episodeCount: number;
  /** A link is being looked up (the next episode, or one picked from the list). */
  resolving: boolean;
  /** Brief "+10s" / "-10s" flash after a skip. `id` changes on every skip so the animation replays. */
  toast: { id: number; text: string; notice?: boolean } | null;
  upNext: { seconds: number; label: string } | null;
  /** The controls row, so the remote's arrows can move focus along it. */
  controlsRef: Ref<HTMLDivElement>;
  onToggle: () => void;
  onSkip: (seconds: number) => void;
  onSeekTo: (time: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onDismissUpNext: () => void;
  onOpenMenu: (kind: MenuKind) => void;
  onFullscreen: () => void;
  onStop: () => void;
}

/** 0..1: how far along the bar a mouse event is. */
const fractionAt = (event: { clientX: number; currentTarget: HTMLElement }) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
};

/** The Netflix-style player overlay: title on top, progress and buttons at the bottom, fading away while you watch. */
export function Hud(p: HudProps) {
  const { player } = p;
  const duration = player.duration || 0;
  const percent = (time: number) => (duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0);
  const playing = player.state === "playing";
  const busy = p.resolving || player.state === "loading" || (player.state !== "error" && Boolean(player.buffering));
  const qualityLabel =
    player.quality && player.quality.current !== -1
      ? (player.quality.levels.find((level) => level.id === player.quality?.current)?.label ?? "HD")
      : "Auto";
  const hasTracks = Boolean(player.subtitles?.tracks.length) || (player.audio?.tracks.length ?? 0) > 1;
  const endsAt = formatEndsAt(player.currentTime, duration, player.playbackRate ?? 1, new Date());
  // Mouse only: where on the bar the pointer is, and what time that is.
  const [hover, setHover] = useState<number | null>(null);

  return (
    <>
      {p.toast && (
        <div className={`hud-toast ${p.toast.notice ? "notice" : ""}`} data-testid="tv-toast" key={p.toast.id} aria-live="polite">
          {p.toast.text}
        </div>
      )}

      {/* Outside the overlay on purpose: it must stay up for the whole countdown, after the controls have faded away. */}
      {p.upNext && (
        <div className="hud-upnext" data-testid="netflix-upnext">
          <div className="hud-upnext-head">
            <span>Up next</span>
            <b>{p.upNext.seconds}s</b>
          </div>
          <p>{p.upNext.label}</p>
          <div className="hud-upnext-bar">
            <div style={{ width: `${Math.max(0, Math.min(100, (p.upNext.seconds / 15) * 100))}%` }} />
          </div>
          <div className="hud-upnext-actions">
            <button className="tv-btn tv-btn-red" data-testid="upnext-play-btn" onClick={p.onNext}>
              <NextIcon /> Watch now
            </button>
            <button className="tv-btn tv-btn-ghost" onClick={p.onDismissUpNext}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* The overlay sits on top of the video, so a click on the empty part of it has to do what a click on the video does. */}
      <div
        className={`tv-overlay ${p.visible ? "visible" : "hidden"}`}
        onClick={(event) => event.target === event.currentTarget && p.onToggle()}
        onDoubleClick={(event) => event.target === event.currentTarget && p.onFullscreen()}
      >
        <header className="hud-top">
          <div className="hud-titles">
            <h1 className="hud-title" data-testid="tv-title">
              {p.title}
            </h1>
            {p.subTitle && (
              <div className="hud-episode">
                <span className="hud-badge">{p.badge}</span>
                <span>{p.subTitle}</span>
              </div>
            )}
          </div>
          <div className="hud-time-of-day">
            <div className="hud-clock">{p.clock}</div>
            {endsAt && <div className="hud-ends">Ends at {endsAt}</div>}
          </div>
        </header>

        <div className="hud-center">
          {busy && <div className="spinner hud-spinner" data-testid="tv-buffering" />}
          {!busy && player.state === "paused" && (
            // Mouse and touch only: the remote's OK already resumes, so this stays out of the D-pad's way (tabIndex -1).
            <button className="hud-paused" data-testid="tv-paused-play" tabIndex={-1} aria-label="Play" onClick={p.onToggle}>
              <PlayIcon />
            </button>
          )}
          {player.state === "error" && (
            <div className="hud-error" data-testid="tv-error" role="alert">
              <h2>{friendlyError(player.error)}</h2>
              <p>Send a different link from your phone.</p>
              <small>{player.error}</small>
            </div>
          )}
        </div>

        <footer className="hud-bottom">
          <div className="hud-progress">
            <span className="hud-time" data-testid="tv-elapsed">
              {formatTime(player.currentTime)}
            </span>
            <div
              className="hud-bar"
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(player.currentTime)}
              onClick={(event) => p.onSeekTo(fractionAt(event) * duration)}
              onMouseMove={(event) => duration > 0 && setHover(fractionAt(event))}
              onMouseLeave={() => setHover(null)}
            >
              <div className="hud-bar-track">
                <div className="hud-bar-buffered" style={{ width: `${percent(player.bufferedEnd ?? 0)}%` }} />
                <div className="hud-bar-fill" style={{ width: `${percent(player.currentTime)}%` }} />
                <div className="hud-bar-thumb" style={{ left: `${percent(player.currentTime)}%` }} />
                {hover !== null && (
                  <div className="hud-bar-tip" style={{ left: `${hover * 100}%` }}>
                    {formatTime(hover * duration)}
                  </div>
                )}
              </div>
            </div>
            <span className="hud-time">{formatRemaining(player.currentTime, duration)}</span>
          </div>

          <div className="hud-controls" ref={p.controlsRef}>
            <div className="hud-group">
              <button
                className="tv-btn tv-btn-play"
                data-testid="tv-play-btn"
                onClick={p.onToggle}
                title="Play / Pause (OK)"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                className="tv-btn tv-btn-icon"
                onClick={() => p.onSkip(-SKIP_SECONDS)}
                title={`Back ${SKIP_SECONDS} seconds (Left)`}
                aria-label={`Back ${SKIP_SECONDS} seconds`}
              >
                <Back10Icon />
              </button>
              <button
                className="tv-btn tv-btn-icon"
                onClick={() => p.onSkip(SKIP_SECONDS)}
                title={`Forward ${SKIP_SECONDS} seconds (Right)`}
                aria-label={`Forward ${SKIP_SECONDS} seconds`}
              >
                <Forward10Icon />
              </button>
              {p.prevLabel && (
                <button className="tv-btn" data-testid="tv-prev-btn" onClick={p.onPrevious} title="Previous episode (P)">
                  <PreviousIcon />
                  <span className="tv-btn-text">
                    Previous
                    <small>{p.prevLabel}</small>
                  </span>
                </button>
              )}
              {p.nextLabel && (
                <button className="tv-btn tv-btn-red" data-testid="tv-next-btn" onClick={p.onNext} title="Next episode (N)">
                  <NextIcon />
                  <span className="tv-btn-text">
                    Next episode
                    <small>{p.nextLabel}</small>
                  </span>
                </button>
              )}
            </div>

            <div className="hud-group">
              {p.episodeCount > 1 && (
                <button className="tv-btn" data-testid="tv-episodes-btn" onClick={() => p.onOpenMenu("episodes")} title="Episodes">
                  <ListIcon /> Episodes
                </button>
              )}
              {hasTracks && (
                <button
                  className={`tv-btn ${player.subtitles && player.subtitles.current !== -1 ? "tv-btn-on" : ""}`}
                  data-testid="tv-audio-sub-btn"
                  onClick={() => p.onOpenMenu("tracks")}
                  title="Audio & subtitles (C cycles subtitles)"
                >
                  <SubtitlesIcon /> Audio &amp; subtitles
                </button>
              )}
              {p.sourceLabel && (
                <button className="tv-btn" data-testid="tv-source-btn" onClick={() => p.onOpenMenu("sources")} title="Source">
                  {p.sourceLabel}
                </button>
              )}
              <button
                className="tv-btn"
                data-testid="tv-speed-btn"
                onClick={() => p.onOpenMenu("speed")}
                title="Playback speed"
              >
                {player.playbackRate ?? 1}×
              </button>
              {player.quality && player.quality.levels.length > 1 && (
                <button className="tv-btn" data-testid="tv-quality-btn" onClick={() => p.onOpenMenu("quality")} title="Quality">
                  {qualityLabel}
                </button>
              )}
              <button
                className="tv-btn tv-btn-icon"
                data-testid="tv-fullscreen-btn"
                onClick={p.onFullscreen}
                title="Fullscreen (F)"
                aria-label="Fullscreen"
              >
                <FullscreenIcon />
              </button>
              <button
                className="tv-btn tv-btn-icon tv-btn-stop"
                data-testid="tv-stop-btn"
                onClick={p.onStop}
                title="Stop playback"
                aria-label="Stop"
              >
                <StopIcon />
              </button>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
