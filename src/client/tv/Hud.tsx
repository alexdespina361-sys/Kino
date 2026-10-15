import { useEffect, useRef, useState, type RefObject } from "react";
import { LibraryItemsSchema, type LibraryItem, type PlayerState } from "../../shared";
import { hintOf } from "../account/cards";
import { useProfileData } from "../account/store";
import { t, useT } from "../i18n";
import { formatEndsAt, formatRemaining, formatTime } from "../shared/format";
import { useFullscreen } from "../shared/fullscreen";
import {
  Back10Icon,
  CloseIcon,
  DownloadIcon,
  ExitFullscreenIcon,
  FastForwardIcon,
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
import { friendlyError, qualityName } from "../shared/words";
import type { PlayOptions } from "./Browse";
import { useBack, useDpad } from "./dpad";
import { PlayerError } from "./engine";
import { useOneLine } from "./fit";
import { HOLD_SPEED } from "./gestures";
import type { MenuKind } from "./Menu";
import { SKIP_SECONDS } from "./keys";
import { freshSimilar } from "./pages";

/** How long the Up Next card counts down for, in seconds (the bar under it shows how much of it is left). */
export const UP_NEXT_SECONDS = 15;

/** What a screen that watches along with another is told on top of what any screen shows: whose film it is, how it keeps up with it, and its way out. */
export interface FollowProps {
  /** The name of the screen being followed. */
  host: string;
  /** The picture is catching up with the host's (it is being moved, or sped up or slowed down, to meet it). */
  catchingUp: boolean;
  /** The host made this screen an admin: the playback (play, the skips, the bar, the next episode, stop) is its to steer too, and each asks the host's screen. */
  admin: boolean;
  /** The way out, which Back on a remote points at. */
  leaveRef: RefObject<HTMLButtonElement | null>;
  onLeave: () => void;
}

export interface HudProps {
  visible: boolean;
  player: PlayerState;
  title: string;
  /** "Season 1, Episode 3" */
  subTitle: string;
  /** "S1:E3" */
  badge: string;
  /** What this episode is called, when it is known and is more than its number. */
  episodeName?: string | undefined;
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
  /** The controls row, so the remote's arrows can move focus along it (and the row can be kept on one line). */
  controlsRef: RefObject<HTMLDivElement | null>;
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
  /** Null in a browser that has no full screen to give the page, or is never asked for it (see fullscreen.ts): then there is no button. */
  onFullscreen: (() => void) | null;
  onStop: () => void;
  /** The wait for the picture has gone on too long: a way out is offered. */
  stuck: boolean;
  onCancel: () => void;
  /** A finger is what is using the screen: the big button in the middle is there to pause with while the picture plays too (paused, it is there whoever is using the screen). */
  touch: boolean;
  /** A finger is held on the picture and it plays faster for as long as it stays. */
  boosting: boolean;
  /** Who held the film and why, in words ("Paused by Anna", "Waiting for Anna"), when it is held and that is known: said on the pause card. */
  heldLine?: string | null | undefined;
  /**
   * Set on a screen that watches along. It has the same bars as any screen, so that it is told what it watches and how far it is, but
   * only its own things are pressed on them (its sound, the subtitles, the party, full screen, the way out): the playback is the host's, and an
   * admin's too, whose play, skips, bar, next episode and stop (`onToggle`, `onSkip`, `onSeekTo`, `onNext`, `onStop`) ask the host's screen.
   */
  follow?: FollowProps | undefined;
}

/** The picture is not there yet: a link is being looked up, the video is loading, or it stopped to fill up. */
export const isBusy = (player: PlayerState, resolving: boolean) => resolving || player.state === "loading" || (player.state !== "error" && Boolean(player.buffering));

/** How long a picture has to wait to fill before it says so (milliseconds). */
export const SPINNER_AFTER_MS = 400;

/**
 * Whether the screen says the picture is waiting. A lookup or a load says so at once; a picture that has stopped to fill (a jump to a
 * place that is not downloaded yet, or running dry) says so once it has gone on for a moment. One that finds its place again in a few
 * frames (a jump inside what is downloaded, a guest brought back in step with its host) is no wait, and a spinner that flashed for each
 * of them was all a guest could see of the sync.
 */
export function useBusy(player: PlayerState, resolving: boolean): boolean {
  const filling = !resolving && player.state !== "loading" && player.state !== "error" && Boolean(player.buffering);
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!filling) return;
    const timer = setTimeout(() => setLate(true), SPINNER_AFTER_MS);
    return () => clearTimeout(timer);
  }, [filling]);
  return isBusy(player, resolving) && (!filling || late);
}

/** The video has subtitles to choose from, or more than one audio track. */
export const hasTracks = (player: PlayerState) => Boolean(player.subtitles?.tracks.length) || (player.audio?.tracks.length ?? 0) > 1;

/** The browser would not start the video: it wants a press first (see PlayerEngine.play), and whatever asks again after one gets it going. */
export const isBlocked = (player: PlayerState) => player.state === "error" && player.error === PlayerError.Blocked;

/** One button for the whole screen: the press the browser wants before it plays video with sound. OK on a remote presses it too (Tv.tsx). */
function TapToPlay({ onPlay }: { onPlay: () => void }) {
  const t = useT();
  return (
    <button className="tv-tap" data-testid="tv-tap-play" onClick={onPlay}>
      <span className="hud-paused" aria-hidden="true">
        <PlayIcon />
      </span>
      <b>{t("tv.tapToPlay")}</b>
    </button>
  );
}

/**
 * What a screen that watches along shows over its picture while the picture is not there: it is filling up, the browser wants a
 * press before it plays, or it can't play at all. Such a screen has no controls of its own, so without this it would only be black.
 */
export function FollowStatus({ player, onPlay }: { player: PlayerState; onPlay: () => void }) {
  useT();
  const busy = useBusy(player, false);
  if (isBlocked(player)) return <TapToPlay onPlay={onPlay} />;
  if (player.state === "error") {
    return (
      <div className="hud-center">
        <div className="hud-error" data-testid="tv-error" role="alert">
          <h2>{friendlyError(player.error)}</h2>
        </div>
      </div>
    );
  }
  if (busy) {
    return (
      <div className="hud-busy" data-testid="tv-busy">
        <div className="spinner hud-spinner" data-testid="tv-buffering" />
      </div>
    );
  }
  return null;
}

/** 0..1: how far along the bar a mouse event is. */
const fractionAt = (event: { clientX: number; currentTarget: HTMLElement }) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
};

/* The buttons that are the same on every screen, a screen that watches along included: what it reads and hears is its own choice. */

function TracksButton({ p, player }: { p: HudProps; player: PlayerState }) {
  if (!hasTracks(player)) return null;
  return (
    <button
      className={`tv-btn ${player.subtitles && player.subtitles.current !== -1 ? "tv-btn-on" : ""}`}
      data-testid="tv-audio-sub-btn"
      data-fold="tracks"
      onClick={() => p.onOpenMenu("tracks")}
      title={t("hud.tracksTip")}
      aria-label={t("player.audioSubtitles")}
    >
      <SubtitlesIcon />
      <span className="tv-btn-label">{t("player.audioSubtitles")}</span>
    </button>
  );
}

/** The quality, when the video comes in more than one: a guest picks its own too (it is its own picture that is downloaded, whatever the host's). */
function QualityButton({ p, player, label }: { p: HudProps; player: PlayerState; label: string }) {
  if (!player.quality || player.quality.levels.length <= 1) return null;
  return (
    <button className="tv-btn" data-testid="tv-quality-btn" onClick={() => p.onOpenMenu("quality")} title={t("player.quality")}>
      {label}
    </button>
  );
}

function PartyButton({ p, partyLabel }: { p: HudProps; partyLabel: string }) {
  return (
    <button
      className={`tv-btn ${p.partySize > 1 ? "tv-btn-on" : ""}`}
      data-testid="tv-party-btn"
      data-fold="party"
      onClick={p.onParty}
      title={t("party.rail")}
      aria-label={partyLabel}
    >
      <UsersIcon />
      <span className="tv-btn-label">{partyLabel}</span>
    </button>
  );
}

function MuteButton({ p }: { p: HudProps }) {
  return (
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
  );
}

function FullscreenButton({ p }: { p: HudProps }) {
  const on = useFullscreen();
  if (!p.onFullscreen) return null;
  const label = t(on ? "remote.exitFullscreen" : "hud.fullscreen");
  return (
    <button className="tv-btn tv-btn-icon" data-testid="tv-fullscreen-btn" onClick={p.onFullscreen} title={on ? label : t("hud.fullscreenTip")} aria-label={label}>
      {on ? <ExitFullscreenIcon /> : <FullscreenIcon />}
    </button>
  );
}

interface ButtonsProps {
  p: HudProps;
  player: PlayerState;
  playing: boolean;
  partyLabel: string;
  qualityLabel: string;
}

/** The buttons of a screen with a picture of its own: playback, what is on it, the party, sound, full screen and the way out of the film. */
function PlayerButtons({ p, player, playing, partyLabel, qualityLabel }: ButtonsProps) {
  return (
    <>
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
          <button
            className="tv-btn"
            data-testid="tv-prev-btn"
            data-fold="skips"
            onClick={p.onPrevious}
            title={t("hud.previousTip")}
            aria-label={`${t("hud.previous")}: ${p.prevLabel}`}
          >
            <PreviousIcon />
            <span className="tv-btn-text tv-btn-label">
              {t("hud.previous")}
              <small className="tv-btn-sub">{p.prevLabel}</small>
            </span>
          </button>
        )}
        {p.nextLabel && (
          <button
            className="tv-btn"
            data-testid="tv-next-btn"
            data-fold="skips"
            onClick={p.onNext}
            title={t("hud.nextTip")}
            aria-label={`${t("hud.nextEpisode")}: ${p.nextLabel}`}
          >
            <NextIcon />
            <span className="tv-btn-text tv-btn-label">
              {t("hud.nextEpisode")}
              <small className="tv-btn-sub">{p.nextLabel}</small>
            </span>
          </button>
        )}
      </div>

      <div className="hud-group">
        {p.episodeCount > 1 && (
          <button
            className="tv-btn"
            data-testid="tv-episodes-btn"
            data-fold="episodes"
            onClick={() => p.onOpenMenu("episodes")}
            title={t("player.episodes")}
            aria-label={t("player.episodes")}
          >
            <ListIcon />
            <span className="tv-btn-label">{t("player.episodes")}</span>
          </button>
        )}
        <TracksButton p={p} player={player} />
        {p.sourceLabel && (
          <button className="tv-btn" data-testid="tv-source-btn" onClick={() => p.onOpenMenu("sources")} title={t("player.source")}>
            <span className="tv-btn-cut">{p.sourceLabel}</span>
          </button>
        )}
        <button className="tv-btn" data-testid="tv-speed-btn" onClick={() => p.onOpenMenu("speed")} title={t("player.speed")}>
          {player.playbackRate ?? 1}×
        </button>
        <QualityButton p={p} player={player} label={qualityLabel} />
        <PartyButton p={p} partyLabel={partyLabel} />
        <MuteButton p={p} />
        <FullscreenButton p={p} />
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
    </>
  );
}

/**
 * The buttons of a screen that watches along. Its picture is the host's, so the playback is not its to move, unless the host made it an admin:
 * then the play button, the skips, the next episode and stop lead the row, and each asks the host's screen, which does it for everyone.
 */
function FollowButtons({ p, follow, player, playing, partyLabel, qualityLabel }: ButtonsProps & { follow: FollowProps }) {
  return (
    <>
      {follow.admin && (
        <div className="hud-group" data-testid="tv-admin-bar" role="group" aria-label={t("party.admin")}>
          <button
            className="tv-btn tv-btn-play"
            data-testid="tv-admin-play"
            data-autofocus
            onClick={p.onToggle}
            title={t("hud.playTip")}
            aria-label={playing ? t("hud.pause") : t("hud.play")}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            className="tv-btn tv-btn-icon"
            data-testid="tv-admin-back"
            onClick={() => p.onSkip(-SKIP_SECONDS)}
            title={t("hud.backTip", { n: SKIP_SECONDS })}
            aria-label={t("hud.back", { n: SKIP_SECONDS })}
          >
            <Back10Icon />
          </button>
          <button
            className="tv-btn tv-btn-icon"
            data-testid="tv-admin-forward"
            onClick={() => p.onSkip(SKIP_SECONDS)}
            title={t("hud.forwardTip", { n: SKIP_SECONDS })}
            aria-label={t("hud.forward", { n: SKIP_SECONDS })}
          >
            <Forward10Icon />
          </button>
          {p.nextLabel && (
            <button
              className="tv-btn"
              data-testid="tv-admin-next"
              data-fold="skips"
              onClick={p.onNext}
              title={t("hud.nextTip")}
              aria-label={`${t("hud.nextEpisode")}: ${p.nextLabel}`}
            >
              <NextIcon />
              <span className="tv-btn-text tv-btn-label">
                {t("hud.nextEpisode")}
                <small className="tv-btn-sub">{p.nextLabel}</small>
              </span>
            </button>
          )}
          <button className="tv-btn tv-btn-icon tv-btn-stop" data-testid="tv-admin-stop" onClick={p.onStop} title={t("hud.stopTip")} aria-label={t("hud.stop")}>
            <StopIcon />
          </button>
        </div>
      )}

      <div className="hud-group">
        <TracksButton p={p} player={player} />
        <QualityButton p={p} player={player} label={qualityLabel} />
        <PartyButton p={p} partyLabel={partyLabel} />
        <MuteButton p={p} />
        <FullscreenButton p={p} />
        {/* Folds with the Episodes label, which a screen that watches along has none of. */}
        <button ref={follow.leaveRef} className="tv-btn" data-testid="tv-leave" data-fold="episodes" onClick={follow.onLeave} title={t("tv.leave")}>
          <CloseIcon />
          <span className="tv-btn-label">{t("tv.leave")}</span>
        </button>
      </div>
    </>
  );
}

/** The Netflix-style player overlay: title on top, progress and buttons at the bottom, fading away while you watch. */
export function Hud(p: HudProps) {
  useT();
  const { player } = p;
  const duration = player.duration || 0;
  const percent = (time: number) => (duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0);
  const playing = player.state === "playing";
  const busy = useBusy(player, p.resolving);
  const paused = !busy && player.state === "paused";
  const follow = p.follow;
  /** Whether the playback is this screen's to move: any screen's own picture, or an admin's, but not that of a guest who only watches. */
  const steers = !follow || follow.admin;
  /** The big button in the middle: to play when paused, and for a finger to pause with while the picture plays (the Up Next card, or the wait for the picture, take its place). */
  const centre = steers && !p.upNext && !busy && (paused || (p.touch && playing));
  const qualityLabel = qualityName(player.quality);
  const endsAt = formatEndsAt(player.currentTime, duration, player.playbackRate ?? 1, new Date());
  const partyLabel = p.partySize > 1 ? t("party.size", { count: p.partySize }) : t("party.rail");
  /** What a screen that watches along is told about the held film: who held it when that is known, else only that it is held (the host's own pause card says nothing: it knows). */
  const held = p.heldLine ?? (follow ? t("hud.paused") : null);
  // Mouse only: where on the bar the pointer is, and what time that is.
  const [hover, setHover] = useState<number | null>(null);
  useOneLine(p.controlsRef);

  return (
    <>
      {/* Outside the overlay: a hold shows whether or not the controls are up. */}
      {p.boosting && (
        <div className="hud-boost" data-testid="tv-boost" role="status" aria-label={t("hud.boost")}>
          <FastForwardIcon />
          <b>{HOLD_SPEED}×</b>
        </div>
      )}

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

      {/* Outside the overlay too: waiting is shown, and given up on, whether or not the controls are up. OK or Back does it from the remote (Tv.tsx). (A screen that watches along shows its wait as FollowStatus does.) */}
      {busy && !follow && (
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

      {/* Outside the overlay as well: it is what the picture is waiting for, so it stays up whether or not the controls are. */}
      {isBlocked(player) && !follow && <TapToPlay onPlay={p.onToggle} />}

      {/* The overlay sits on top of the video, so its empty part is the picture as far as a hand can tell (data-picture: see gestures.ts); the bars' own is the picture to a finger only. */}
      <div className={`tv-overlay ${p.visible ? "visible" : "hidden"}`} data-picture data-paused={(paused && !p.upNext) || undefined} data-boosting={p.boosting || undefined}>
        <header className="hud-top" data-picture="bar">
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
            {p.episodeName && (
              <div className="hud-ep-name" data-testid="tv-episode-name">
                {p.episodeName}
              </div>
            )}
            {follow && (
              <div className="hud-follow" data-testid="tv-follow-line">
                <UsersIcon />
                <span>{t("tv.following", { name: follow.host })}</span>
                {follow.catchingUp && <em data-testid="tv-catching-up">{t("party.catchingUp")}</em>}
              </div>
            )}
          </div>
          <div className="hud-time-of-day">
            <div className="hud-clock">{p.clock}</div>
            {endsAt && <div className="hud-ends">{t("hud.endsAt", { time: endsAt })}</div>}
          </div>
        </header>

        <div className="hud-center">
          {paused && !p.upNext && (
            /* Where the title in the top corner goes while the picture is held: what you are watching, said once, big. */
            <div className="hud-pause-card" data-testid="tv-pause-card">
              <small>{follow ? t("tv.following", { name: follow.host }) : t("hud.watching")}</small>
              <b>{p.title}</b>
              {p.subTitle && <span>{p.subTitle}</span>}
              {p.episodeName && <em>{p.episodeName}</em>}
              {held && (
                <strong className="hud-held" data-testid="tv-held">
                  {held}
                </strong>
              )}
            </div>
          )}
          {centre && (
            /* Mouse and touch only: the remote's OK already pauses and resumes, so this stays out of the D-pad's way (tabIndex -1). */
            <button
              className="hud-paused"
              data-testid="tv-center-btn"
              data-for-touch
              data-playing={playing || undefined}
              tabIndex={-1}
              aria-label={playing ? t("hud.pause") : t("hud.play")}
              onClick={p.onToggle}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
        </div>

        <footer className="hud-bottom" data-picture="bar" data-testid={follow ? "tv-follow-bar" : undefined}>
          <div className="hud-progress">
            <span className="hud-time" data-testid="tv-elapsed">
              {formatTime(player.currentTime)}
            </span>
            {/* Where the film is, for any screen; moved by a click only on one whose to steer (a guest that only watches is shown where it is). */}
            <div
              className="hud-bar"
              role={steers ? "slider" : "progressbar"}
              data-readonly={steers ? undefined : true}
              aria-label={steers ? t("hud.seek") : p.title}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(player.currentTime)}
              onClick={steers ? (event) => p.onSeekTo(fractionAt(event) * duration) : undefined}
              onMouseMove={steers ? (event) => duration > 0 && setHover(fractionAt(event)) : undefined}
              onMouseLeave={steers ? () => setHover(null) : undefined}
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
            {follow ? (
              <FollowButtons p={p} follow={follow} player={player} playing={playing} partyLabel={partyLabel} qualityLabel={qualityLabel} />
            ) : (
              <PlayerButtons p={p} player={player} playing={playing} partyLabel={partyLabel} qualityLabel={qualityLabel} />
            )}
          </div>
        </footer>
      </div>
    </>
  );
}

interface ErrorCardProps {
  title: string;
  /** What went wrong, in words. */
  message: string;
  onRetry: () => void;
  onLibrary: () => void;
  onEmbed?: () => void;
}

/**
 * What the TV shows when a video would not play from any of its sources: what it was, what went wrong, and two ways on (OK is the
 * first, trying again; Back is the second, leaving). The player's controls are of no use then, so this takes their place.
 */
export function ErrorCard(p: ErrorCardProps) {
  useT();
  const rootRef = useRef<HTMLDivElement>(null);
  useDpad(rootRef);
  useBack(p.onLibrary);

  // The first button has the focus as the card appears, so OK does what the card leads with.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, []);

  return (
    <div className="tv-fail" ref={rootRef}>
      <div className="hud-error" data-testid="tv-error" role="alert">
        <small>{p.title}</small>
        <h2>{p.message}</h2>
        <div className="tv-actions">
          {p.onEmbed && (
            <button className="tv-action tv-action-primary" onClick={p.onEmbed} data-testid="error-embed" data-nav>
              <PlayIcon /> {t("tv.playWebPlayer")}
            </button>
          )}
          <button className={`tv-action ${p.onEmbed ? "" : "tv-action-primary"}`} onClick={p.onRetry} data-testid="error-retry" data-nav>
            <RefreshIcon /> {t("common.retry")}
          </button>
          <button className="tv-action" onClick={p.onLibrary} data-testid="error-library" data-nav>
            <HomeIcon /> {t("tv.backToLibrary")}
          </button>
        </div>
      </div>
    </div>
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
