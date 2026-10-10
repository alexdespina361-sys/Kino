import { useEffect, useRef, useState, type Ref } from "react";
import { LibraryItemsSchema, type LibraryItem, type PlayerState } from "../../shared";
import { hintOf } from "../account/cards";
import { useProfileData } from "../account/store";
import { t, useT } from "../i18n";
import { formatEndsAt, formatRemaining, formatTime } from "../shared/format";
import {
  Back10Icon,
  Forward10Icon,
  FullscreenIcon,
  HomeIcon,
  ListIcon,
  MutedIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RefreshIcon,
  StopIcon,
  SubtitlesIcon,
  UsersIcon,
  VolumeIcon,
} from "../shared/icons";
import { Poster } from "../shared/Poster";
import { friendlyError } from "../shared/words";
import type { PlayOptions } from "./Browse";
import { useBack, useDpad } from "./dpad";
import type { MenuKind } from "./Menu";
import { SKIP_SECONDS } from "./keys";
import { freshSimilar } from "./pages";

/** How long the Up Next card counts down for, in seconds (the bar under it shows how much of it is left). */
export const UP_NEXT_SECONDS = 15;

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
  /**
   * Brief "+10s" / "-10s" flash after a skip (`side` puts it on the half of the picture the skip went towards), or a line
   * of news ("Speed 1.5×"). `id` changes every time so the animation replays.
   */
  toast: { id: number; text: string; notice?: boolean; side?: "back" | "forward" } | null;
  /** The next episode is coming: `seconds` counts down to it, or is null when this profile plays the next one only on request. */
  upNext: { seconds: number | null; label: string } | null;
  /** The controls row, so the remote's arrows can move focus along it. */
  controlsRef: Ref<HTMLDivElement>;
  onToggle: () => void;
  onSkip: (seconds: number) => void;
  onSeekTo: (time: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onDismissUpNext: () => void;
  onOpenMenu: (kind: MenuKind) => void;
  /** How many screens are in the watch party this TV hosts (itself included), 0 when there is none; and the button that opens it. */
  partySize: number;
  onParty: () => void;
  /** This screen's own sound is off (the volume stays the device's; this is only the switch). */
  muted: boolean;
  onMute: () => void;
  onFullscreen: () => void;
  onStop: () => void;
  /** The wait for the picture has gone on too long: a way out is offered. */
  stuck: boolean;
  onCancel: () => void;
}

/** The picture is not there yet: a link is being looked up, the video is loading, or it stopped to fill up. */
export const isBusy = (player: PlayerState, resolving: boolean) => resolving || player.state === "loading" || (player.state !== "error" && Boolean(player.buffering));

/** The video has subtitles to choose from, or more than one audio track. */
export const hasTracks = (player: PlayerState) => Boolean(player.subtitles?.tracks.length) || (player.audio?.tracks.length ?? 0) > 1;

/** 0..1: how far along the bar a mouse event is. */
const fractionAt = (event: { clientX: number; currentTarget: HTMLElement }) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
};

/** The Netflix-style player overlay: title on top, progress and buttons at the bottom, fading away while you watch. */
export function Hud(p: HudProps) {
  useT();
  const { player } = p;
  const duration = player.duration || 0;
  const percent = (time: number) => (duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0);
  const playing = player.state === "playing";
  const busy = isBusy(player, p.resolving);
  const paused = !busy && player.state === "paused";
  const qualityLabel =
    player.quality && player.quality.current !== -1
      ? (player.quality.levels.find((level) => level.id === player.quality?.current)?.label ?? "HD")
      : t("player.auto");
  const endsAt = formatEndsAt(player.currentTime, duration, player.playbackRate ?? 1, new Date());
  // Mouse only: where on the bar the pointer is, and what time that is.
  const [hover, setHover] = useState<number | null>(null);

  return (
    <>
      {p.toast && (
        <div
          className={`hud-toast ${p.toast.notice ? "notice" : ""} ${p.toast.side ? `side-${p.toast.side}` : ""}`}
          data-testid="tv-toast"
          key={p.toast.id}
          aria-live="polite"
        >
          {p.toast.text}
        </div>
      )}

      {/* Outside the overlay on purpose: it must stay up for the whole countdown, after the controls have faded away. */}
      {p.upNext && (
        <div className="hud-upnext" data-testid="netflix-upnext" data-counting={p.upNext.seconds !== null}>
          <div className="hud-upnext-head">
            <span>{t("hud.upNext")}</span>
            {p.upNext.seconds !== null && <b>{p.upNext.seconds}s</b>}
          </div>
          <p>{p.upNext.label}</p>
          {p.upNext.seconds !== null && (
            <div className="hud-upnext-bar">
              <div style={{ width: `${Math.max(0, Math.min(100, (p.upNext.seconds / UP_NEXT_SECONDS) * 100))}%` }} />
            </div>
          )}
          <div className="hud-upnext-actions">
            <button className="tv-btn tv-btn-red" data-testid="upnext-play-btn" onClick={p.onNext}>
              <NextIcon /> {t("hud.watchNow")}
            </button>
            <button className="tv-btn tv-btn-ghost" onClick={p.onDismissUpNext}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Outside the overlay too: waiting is shown, and given up on, whether or not the controls are up. OK or Back does it from the remote (Tv.tsx). */}
      {busy && (
        <div className="hud-busy" data-testid="tv-busy">
          <div className="spinner hud-spinner" data-testid="tv-buffering" />
          {p.stuck && (
            <div className="hud-stuck" data-testid="tv-stuck">
              <p>{t("tv.slow")}</p>
              <button className="tv-btn tv-btn-red" data-testid="tv-cancel-load" onClick={p.onCancel}>
                {t("common.cancel")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* The overlay sits on top of the video, so a click on the empty part of it has to do what a click on the video does. */}
      <div
        className={`tv-overlay ${p.visible ? "visible" : "hidden"}`}
        data-paused={paused || undefined}
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
            {endsAt && <div className="hud-ends">{t("hud.endsAt", { time: endsAt })}</div>}
          </div>
        </header>

        <div className="hud-center">
          {paused && (
            <>
              {/* Where the title in the top corner goes while the picture is held: what you are watching, said once, big. */}
              <div className="hud-pause-card" data-testid="tv-pause-card">
                <small>{t("hud.watching")}</small>
                <b>{p.title}</b>
                {p.subTitle && (
                  <span>
                    {p.badge} · {p.subTitle}
                  </span>
                )}
              </div>
              {/* Mouse and touch only: the remote's OK already resumes, so this stays out of the D-pad's way (tabIndex -1). */}
              <button className="hud-paused" data-testid="tv-paused-play" tabIndex={-1} aria-label={t("hud.play")} onClick={p.onToggle}>
                <PlayIcon />
              </button>
            </>
          )}
          {player.state === "error" && (
            <div className="hud-error" data-testid="tv-error" role="alert">
              <h2>{friendlyError(player.error)}</h2>
              <p>{t("hud.sendAnother")}</p>
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
              aria-label={t("hud.seek")}
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
                title={t("hud.playTip")}
                aria-label={playing ? t("hud.pause") : t("hud.play")}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                className="tv-btn tv-btn-icon"
                onClick={() => p.onSkip(-SKIP_SECONDS)}
                title={t("hud.backTip", { n: SKIP_SECONDS })}
                aria-label={t("hud.back", { n: SKIP_SECONDS })}
              >
                <Back10Icon />
              </button>
              <button
                className="tv-btn tv-btn-icon"
                onClick={() => p.onSkip(SKIP_SECONDS)}
                title={t("hud.forwardTip", { n: SKIP_SECONDS })}
                aria-label={t("hud.forward", { n: SKIP_SECONDS })}
              >
                <Forward10Icon />
              </button>
              {p.prevLabel && (
                <button className="tv-btn" data-testid="tv-prev-btn" onClick={p.onPrevious} title={t("hud.previousTip")}>
                  <PreviousIcon />
                  <span className="tv-btn-text">
                    {t("hud.previous")}
                    <small>{p.prevLabel}</small>
                  </span>
                </button>
              )}
              {p.nextLabel && (
                <button className="tv-btn tv-btn-red" data-testid="tv-next-btn" onClick={p.onNext} title={t("hud.nextTip")}>
                  <NextIcon />
                  <span className="tv-btn-text">
                    {t("hud.nextEpisode")}
                    <small>{p.nextLabel}</small>
                  </span>
                </button>
              )}
            </div>

            <div className="hud-group">
              {p.episodeCount > 1 && (
                <button className="tv-btn" data-testid="tv-episodes-btn" onClick={() => p.onOpenMenu("episodes")} title={t("player.episodes")}>
                  <ListIcon /> {t("player.episodes")}
                </button>
              )}
              {hasTracks(player) && (
                <button
                  className={`tv-btn ${player.subtitles && player.subtitles.current !== -1 ? "tv-btn-on" : ""}`}
                  data-testid="tv-audio-sub-btn"
                  onClick={() => p.onOpenMenu("tracks")}
                  title={t("hud.tracksTip")}
                >
                  <SubtitlesIcon /> {t("player.audioSubtitles")}
                </button>
              )}
              {p.sourceLabel && (
                <button className="tv-btn" data-testid="tv-source-btn" onClick={() => p.onOpenMenu("sources")} title={t("player.source")}>
                  {p.sourceLabel}
                </button>
              )}
              <button className="tv-btn" data-testid="tv-speed-btn" onClick={() => p.onOpenMenu("speed")} title={t("player.speed")}>
                {player.playbackRate ?? 1}×
              </button>
              {player.quality && player.quality.levels.length > 1 && (
                <button className="tv-btn" data-testid="tv-quality-btn" onClick={() => p.onOpenMenu("quality")} title={t("player.quality")}>
                  {qualityLabel}
                </button>
              )}
              <button className={`tv-btn ${p.partySize > 1 ? "tv-btn-on" : ""}`} data-testid="tv-party-btn" onClick={p.onParty} title={t("party.rail")}>
                <UsersIcon /> {p.partySize > 1 ? t("party.size", { count: p.partySize }) : t("party.rail")}
              </button>
              <button
                className={`tv-btn tv-btn-icon ${p.muted ? "tv-btn-on" : ""}`}
                data-testid="tv-mute-btn"
                onClick={p.onMute}
                title={t(p.muted ? "hud.unmuteTip" : "hud.muteTip")}
                aria-label={t(p.muted ? "hud.unmute" : "hud.mute")}
                aria-pressed={p.muted}
              >
                {p.muted ? <MutedIcon /> : <VolumeIcon />}
              </button>
              <button
                className="tv-btn tv-btn-icon"
                data-testid="tv-fullscreen-btn"
                onClick={p.onFullscreen}
                title={t("hud.fullscreenTip")}
                aria-label={t("hud.fullscreen")}
              >
                <FullscreenIcon />
              </button>
              <button
                className="tv-btn tv-btn-icon tv-btn-stop"
                data-testid="tv-stop-btn"
                onClick={p.onStop}
                title={t("hud.stopTip")}
                aria-label={t("hud.stop")}
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

/** How many titles "More like this" offers. */
const MORE_LIKE_THIS = 5;

interface EndCardProps {
  title: string;
  /** "Season 1, Episode 3", empty for a film. */
  subTitle: string;
  /** The link that plays it again: what the library knows its like by. */
  page: string | undefined;
  /** The episode after this one, when there is one (the Up Next card was turned down, or does not wait for itself). */
  hasNext: boolean;
  onNext: () => void;
  onAgain: () => void;
  onLibrary: () => void;
  onPlay: (url: string, options: PlayOptions) => void;
}

/**
 * What the TV shows when a film has played to its end and nothing follows by itself: what it was, a way out (the library comes
 * first, so OK or Back leaves), and a few titles like it. It stands in for the picture frozen on the last frame.
 */
export function EndCard(p: EndCardProps) {
  useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const { progress, list } = useProfileData();
  const [like, setLike] = useState<LibraryItem[]>([]);
  useDpad(rootRef);
  useBack(p.onLibrary);

  // The first button has the focus as the card appears, so OK does what the card leads with.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, []);

  useEffect(() => {
    if (!p.page) return;
    let live = true;
    fetch(`/api/library/similar?url=${encodeURIComponent(p.page)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        const parsed = LibraryItemsSchema.safeParse(data);
        if (live && parsed.success) setLike(parsed.data.items);
      })
      .catch(() => {}); // no suggestions is not a problem: the card is complete without them
    return () => {
      live = false;
    };
  }, [p.page]);
  const more = freshSimilar(like, progress, list).slice(0, MORE_LIKE_THIS);

  return (
    <div className="tv-end" ref={rootRef} data-testid="tv-end">
      <p className="tv-end-kicker">{t("end.finished")}</p>
      <h1 data-testid="tv-end-title">{p.title}</h1>
      {p.subTitle && <p className="tv-end-sub">{p.subTitle}</p>}
      <div className="tv-actions">
        {p.hasNext && (
          <button className="tv-action tv-action-primary" onClick={p.onNext} data-testid="end-next" data-nav>
            <NextIcon /> {t("hud.nextEpisode")}
          </button>
        )}
        <button className={`tv-action${p.hasNext ? "" : " tv-action-primary"}`} onClick={p.onLibrary} data-testid="end-library" data-nav>
          <HomeIcon /> {t("tv.backToLibrary")}
        </button>
        <button className="tv-action" onClick={p.onAgain} data-testid="end-again" data-nav>
          <RefreshIcon /> {t("end.again")}
        </button>
      </div>
      {more.length > 0 && (
        <section className="tv-end-more" aria-label={t("end.more")}>
          <h2>{t("end.more")}</h2>
          <div className="tv-end-tiles">
            {more.map((item) => (
              <button className="tv-end-tile" key={item.id} title={item.title} onClick={() => p.onPlay(item.url, { hint: hintOf(item) })} data-testid="end-similar" data-nav>
                <Poster title={item.title} image={item.image ?? item.backdrop} seed={item.id} className="tv-end-art" />
                <span className="tv-end-name">{item.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
