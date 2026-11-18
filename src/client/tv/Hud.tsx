import { useEffect, useRef, useState, type RefObject, useLayoutEffect } from "react";
import { LibraryItemsSchema, type LibraryItem, type PlayerState } from "../../shared";
import { hintOf } from "../account/cards";
import { useProfileData } from "../account/store";
import { t, useT } from "../i18n";
import { formatClock, formatEndsAt, formatRemaining, formatTime } from "../shared/format";
import { useFullscreen } from "../shared/fullscreen";
import {
  Back10Icon,
  CloseIcon,
  ExitFullscreenIcon,
  FastForwardIcon,
  Forward10Icon,
  FullscreenIcon,
  HomeIcon,
  ListIcon,
  MessageIcon,
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
import { friendlyError, hasAudioChoice, hasPictureChoice, pictureName, tracksTitle } from "../shared/words";
import type { PlayOptions } from "./Browse";
import { useBack, useDpad } from "./dpad";
import { PlayerError } from "./engine";
import { HOLD_SPEED } from "./gestures";
import type { MenuKind } from "./Menu";
import { SKIP_SECONDS } from "./keys";
import { freshSimilar } from "./pages";
import type { SkipKind, SkipView } from "./skip";
import { isCompact } from "./compact";

const FIT_STEPS = ["tight", "party", "tracks", "names", "skips", "episodes", "small", "wrap"] as const;
interface Fitted {
  key: string;
  count: number;
}
function fits(row: HTMLElement): boolean {
  const groups = Array.from(row.children) as HTMLElement[];
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const used = groups.reduce((sum, group) => sum + group.offsetWidth, 0) + gap * Math.max(0, groups.length - 1);
  return used <= row.clientWidth + 1;
}
function giveUp(row: HTMLElement, count: number): void {
  const steps: readonly string[] = FIT_STEPS.slice(0, count);
  const fit = steps.join(" ");
  if (row.dataset.fit !== fit) row.dataset.fit = fit;
  for (const button of row.querySelectorAll<HTMLElement>("[data-fold]")) button.toggleAttribute("data-folded", steps.includes(button.dataset.fold!));
}
function fit(row: HTMLElement, last: Fitted): void {
  if (isCompact()) {
    last.key = "";
    return giveUp(row, 0);
  }
  const key = `${row.clientWidth}|${row.childElementCount}|${row.textContent}`;
  if (key === last.key) return giveUp(row, last.count);
  let count = 0;
  giveUp(row, count);
  while (count < FIT_STEPS.length && !fits(row)) giveUp(row, ++count);
  last.key = key;
  last.count = count;
}
function useOneLine(row: RefObject<HTMLElement | null>): void {
  const last = useRef<Fitted>({ key: "", count: 0 });
  useLayoutEffect(() => {
    if (row.current) fit(row.current, last.current);
  });
  useEffect(() => {
    const onResize = () => row.current && fit(row.current, last.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [row]);
}

export const UP_NEXT_SECONDS = 15;

const SKIP_WORDS: Record<SkipKind, "hud.skipIntro" | "hud.skipRecap" | "hud.skipCredits"> = { intro: "hud.skipIntro", recap: "hud.skipRecap", credits: "hud.skipCredits" };

function SkipPill({
  kind,
  label,
  sub,
  seconds,
  total,
  fresh,
  goesIn,
  shownFor,
  onPress,
  onDismiss,
}: {
  kind: SkipKind | "next";
  label: string;
  sub?: string;
  seconds: number | null;
  total: number;
  fresh: boolean;
  goesIn?: number;
  shownFor?: number;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const counting = seconds !== null;
  const fading = !counting && goesIn !== undefined && (shownFor ?? 0) > 0;
  const next = kind === "next";
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const target = counting && total > 0 ? clamp((total - seconds + 1) / total) : fading ? clamp((goesIn! - 1) / shownFor!) : 0;
  const [fill, setFill] = useState(() => (counting && total > 0 ? clamp((total - seconds) / total) : fading ? clamp(goesIn! / shownFor!) : 0));
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFill(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return (
    <div className="hud-skip" data-kind={kind} data-testid={next ? "netflix-upnext" : "tv-skip"} data-counting={counting} data-fading={fading || undefined} data-fresh={fresh || undefined} role="group" aria-label={label}>
      <button type="button" className="hud-skip-btn" onClick={onPress} aria-label={sub ? `${label}: ${sub}` : label} data-testid={next ? "upnext-play-btn" : "tv-skip-btn"}>
        <span className="hud-skip-fill" style={{ transform: `scaleX(${counting || fading ? fill : 0})` }} aria-hidden="true" />
        {next ? <NextIcon /> : <FastForwardIcon />}
        <span className="hud-skip-words">
          <span className="hud-skip-label">{label}</span>
          {sub && <span className="hud-skip-sub">{sub}</span>}
        </span>
        {counting && <b className="hud-skip-count">{seconds}s</b>}
      </button>
      <button type="button" className="hud-skip-close" onClick={onDismiss} aria-label={t("common.cancel")} title={t("common.cancel")} data-testid={next ? "upnext-dismiss" : "tv-skip-dismiss"}>
        <CloseIcon />
      </button>
    </div>
  );
}

export interface FollowProps {
  host: string;
  catchingUp: boolean;
  admin: boolean;
  leaveRef: RefObject<HTMLButtonElement | null>;
  onLeave: () => void;
}

export interface HudProps {
  visible: boolean;
  player: PlayerState;
  title: string;
  subTitle: string;
  badge: string;
  episodeName?: string | undefined;
  nextLabel: string | null;
  prevLabel: string | null;
  sourceLabel: string | null;
  episodeCount: number;
  resolving: boolean;
  hideWait?: boolean;
  toast: { id: number; text: string; notice?: boolean; side?: "back" | "forward" } | null;
  upNext: { seconds: number | null; total: number; label: string; fresh: boolean } | null;
  skip: SkipView | null;
  onSkipPart: () => void;
  onDismissSkip: () => void;
  controlsRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onSkip: (seconds: number) => void;
  onSeekTo: (time: number) => void;
  onScrub: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onDismissUpNext: () => void;
  onOpenMenu: (kind: MenuKind) => void;
  partySize: number;
  onParty: (() => void) | null;
  muted: boolean;
  onMute: () => void;
  onFullscreen: (() => void) | null;
  onStop: () => void;
  stuck: boolean;
  onCancel: () => void;
  touch: boolean;
  boosting: boolean;
  heldLine?: string | null | undefined;
  follow?: FollowProps | undefined;
}

export const isBusy = (player: PlayerState, resolving: boolean) => resolving || player.state === "loading" || (player.state !== "error" && Boolean(player.buffering));

export const SPINNER_AFTER_MS = 400;

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

export const hasTracks = (player: PlayerState) => Boolean(player.subtitles?.tracks.length) || hasAudioChoice(player);

export const isBlocked = (player: PlayerState) => player.state === "error" && player.error === PlayerError.Blocked;

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

export const SCRUB_REST_MS = 350;

const fractionAt = (event: { clientX: number; currentTarget: HTMLElement }) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
};

function TracksButton({ p, player }: { p: HudProps; player: PlayerState }) {
  return (
    <button
      className={`tv-btn ${player.subtitles && player.subtitles.current !== -1 ? "tv-btn-on" : ""}`}
      data-testid="tv-audio-sub-btn"
      data-fold="tracks"
      onClick={() => p.onOpenMenu("tracks")}
      title={t(hasAudioChoice(player) ? "hud.tracksTip" : "hud.subtitlesTip")}
      aria-label={tracksTitle(player)}
    >
      <SubtitlesIcon />
      <span className="tv-btn-label">{tracksTitle(player)}</span>
    </button>
  );
}

function QualityButton({ p, player, label }: { p: HudProps; player: PlayerState; label: string }) {
  if (!hasPictureChoice(player)) return null;
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
      onClick={p.onParty ?? undefined}
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
        {p.onParty && <PartyButton p={p} partyLabel={partyLabel} />}
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
        {p.onParty && <PartyButton p={p} partyLabel={partyLabel} />}
        <MuteButton p={p} />
        <FullscreenButton p={p} />
        <button ref={follow.leaveRef} className="tv-btn" data-testid="tv-leave" data-fold="episodes" onClick={follow.onLeave} title={t("tv.leave")}>
          <CloseIcon />
          <span className="tv-btn-label">{t("tv.leave")}</span>
        </button>
      </div>
    </>
  );
}

export function Hud(p: HudProps) {
  useT();
  const { player } = p;
  const duration = player.duration || 0;
  const percent = (time: number) => (duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0);
  const playing = player.state === "playing";
  const busy = useBusy(player, p.resolving);
  const paused = !busy && player.state === "paused";
  const follow = p.follow;
  const steers = !follow || follow.admin;
  const nextAtTheEnd = Boolean(p.upNext && player.ended);
  const centre = steers && !busy && !nextAtTheEnd && (paused || (p.touch && playing));
  const qualityLabel = pictureName(player);
  const endsAt = formatEndsAt(player.currentTime, duration, player.playbackRate ?? 1, new Date());
  const partyLabel = p.partySize > 1 ? t("party.size", { count: p.partySize }) : t("party.rail");
  const held = p.heldLine ?? (follow ? t("hud.paused") : null);
  const [hover, setHover] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbing = scrub !== null;
  const shownTime = scrub !== null ? scrub * duration : player.currentTime;
  const seekRef = useRef(p.onSeekTo);
  seekRef.current = p.onSeekTo;
  const sentRef = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  scrubRef.current = scrub;
  const alone = !follow && p.partySize <= 1;
  useEffect(() => {
    if (scrub === null || !alone || !(duration > 0)) return;
    const timer = setTimeout(() => {
      sentRef.current = scrub;
      seekRef.current(scrub * duration);
    }, SCRUB_REST_MS);
    return () => clearTimeout(timer);
  }, [scrub, alone, duration]);
  useEffect(() => {
    if (!scrubbing) return;
    if (!steers) return setScrub(null);
    const end = (event: PointerEvent) => {
      if (event.pointerId !== holderRef.current || barRef.current?.contains(event.target as Node)) return;
      const at = scrubRef.current;
      setScrub(null);
      if (event.type === "pointerup" && at !== null && sentRef.current !== at && duration > 0) {
        sentRef.current = at;
        seekRef.current(at * duration);
      }
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [scrubbing, steers, duration]);
  useOneLine(p.controlsRef);

  return (
    <>
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

      {p.upNext && (
        <SkipPill
          kind="next"
          label={t("hud.nextEpisode")}
          sub={p.upNext.label}
          seconds={p.upNext.seconds}
          total={p.upNext.total}
          fresh={p.upNext.fresh}
          onPress={p.onNext}
          onDismiss={p.onDismissUpNext}
        />
      )}
      {!p.upNext && p.skip && (
        <SkipPill kind={p.skip.kind} label={t(SKIP_WORDS[p.skip.kind])} seconds={p.skip.seconds} total={p.skip.total} fresh={p.skip.fresh} goesIn={p.skip.goesIn} shownFor={p.skip.shownFor} onPress={p.onSkipPart} onDismiss={p.onDismissSkip} />
      )}

      {busy && !follow && !p.hideWait && (
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

      {isBlocked(player) && !follow && <TapToPlay onPlay={p.onToggle} />}

      <div className={`tv-overlay ${p.visible ? "visible" : "hidden"}`} data-picture data-paused={(paused && !nextAtTheEnd) || undefined} data-boosting={p.boosting || undefined}>
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
            <HudClock />
            {endsAt && <div className="hud-ends">{t("hud.endsAt", { time: endsAt })}</div>}
          </div>
        </header>

        <div className="hud-center">
          {paused && !nextAtTheEnd && (
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
              {formatTime(shownTime)}
            </span>
            <div
              className="hud-bar"
              ref={barRef}
              role={steers ? "slider" : "progressbar"}
              data-readonly={steers ? undefined : true}
              data-scrubbing={scrubbing || undefined}
              aria-label={steers ? t("hud.seek") : p.title}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(shownTime)}
              onPointerDown={
                steers
                  ? (event) => {
                      if (!(duration > 0) || (event.pointerType === "mouse" && event.button !== 0)) return;
                      try {
                        event.currentTarget.setPointerCapture(event.pointerId);
                      } catch {
                      }
                      sentRef.current = null;
                      holderRef.current = event.pointerId;
                      setHover(null);
                      setScrub(fractionAt(event));
                      p.onScrub();
                    }
                  : undefined
              }
              onPointerMove={
                steers
                  ? (event) => {
                      if (scrub === null) return;
                      setScrub(fractionAt(event));
                      p.onScrub();
                    }
                  : undefined
              }
              onPointerUp={
                steers
                  ? (event) => {
                      if (scrub === null) return;
                      const at = fractionAt(event);
                      setScrub(null);
                      if (sentRef.current !== at) p.onSeekTo(at * duration);
                    }
                  : undefined
              }
              onPointerCancel={steers ? () => setScrub(null) : undefined}
              onClick={steers && typeof PointerEvent === "undefined" ? (event) => p.onSeekTo(fractionAt(event) * duration) : undefined}
              onMouseMove={steers ? (event) => duration > 0 && setHover(fractionAt(event)) : undefined}
              onMouseLeave={steers ? () => setHover(null) : undefined}
            >
              <div className="hud-bar-track">
                <div className="hud-bar-buffered" style={{ width: `${percent(player.bufferedEnd ?? 0)}%` }} />
                <div className="hud-bar-fill" style={{ width: `${percent(shownTime)}%` }} />
                <div className="hud-bar-thumb" style={{ left: `${percent(shownTime)}%` }} />
                {(scrub ?? hover) !== null && (
                  <div className="hud-bar-tip" style={{ left: `${(scrub ?? hover ?? 0) * 100}%` }}>
                    {formatTime((scrub ?? hover ?? 0) * duration)}
                  </div>
                )}
              </div>
            </div>
            <span className="hud-time">{formatRemaining(shownTime, duration)}</span>
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
  message: string;
  onRetry: () => void;
  onLibrary: () => void;
  onReport: () => void;
}

export function ErrorCard(p: ErrorCardProps) {
  useT();
  const rootRef = useRef<HTMLDivElement>(null);
  useDpad(rootRef);
  useBack(p.onLibrary);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, []);

  return (
    <div className="tv-fail" ref={rootRef}>
      <div className="hud-error" data-testid="tv-error" role="alert">
        <small data-testid="error-title">{p.title}</small>
        <h2>{p.message}</h2>
        <div className="tv-actions">
          <button className="tv-action tv-action-primary" onClick={p.onRetry} data-testid="error-retry" data-nav>
            <RefreshIcon /> {t("common.retry")}
          </button>
          <button className="tv-action" onClick={p.onLibrary} data-testid="error-library" data-nav>
            <HomeIcon /> {t("tv.backToLibrary")}
          </button>
        </div>
        <button className="tv-action tv-report" onClick={p.onReport} data-testid="error-report" data-nav>
          <MessageIcon /> {t("feedback.report")}
        </button>
      </div>
    </div>
  );
}

const MORE_LIKE_THIS = 5;

interface EndCardProps {
  title: string;
  subTitle: string;
  page: string | undefined;
  hasNext: boolean;
  onNext: () => void;
  onAgain: () => void;
  onLibrary: () => void;
  onPlay: (url: string, options: PlayOptions) => void;
}

export function EndCard(p: EndCardProps) {
  useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const { progress, list } = useProfileData();
  const [like, setLike] = useState<LibraryItem[]>([]);
  useDpad(rootRef);
  useBack(p.onLibrary);

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
      .catch(() => {});
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

function HudClock() {
  const [clock, setClock] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setClock(formatClock(new Date())), 10_000);
    return () => clearInterval(timer);
  }, []);
  return <div className="hud-clock">{clock}</div>;
}