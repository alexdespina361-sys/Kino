import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { checkChatText, episodeStatus, lastStartAt, resumeAt } from "../../shared";
import { ratingFor } from "../account/ratingText";
import { useProfileData } from "../account/store";
import { useT } from "../i18n";
import { useEpisodeDetails, useSeasons } from "../shared/episodeDetails";
import { formatTime } from "../shared/format";
import { CheckIcon, ChevronIcon, ChevronLeftIcon, MoreIcon, SendIcon, StarIcon } from "../shared/icons";
import { Poster } from "../shared/Poster";
import type { TitleExtras } from "../shared/titleAddress";
import { useBackFirst } from "../tv/dpad";
import { cardOf, showKeyOf, startOf, type Entry } from "../tv/pages";
import type { ChatSession } from "./useChat";
import { chosenExtras, isShowAddress, messageOf, movedTime, sendableTitles, TIME_MAX, typedTime, type Sendable } from "./titles";

function useSendable(): Sendable[] {
  const { progress, list } = useProfileData();
  return useMemo(() => sendableTitles(progress, list), [progress, list]);
}

const send = async (session: ChatSession, title: Sendable, extras: TitleExtras = {}): Promise<boolean> => {
  const checked = checkChatText(messageOf(title, location.origin, extras));
  return checked.ok ? session.send(checked.text) : false;
};

const navOf = (nav: boolean) => (nav ? { "data-nav": true } : {});

export function TitleList({ session, tv, nav, pointer = false, onSent }: { session: ChatSession; tv: boolean; nav: boolean; pointer?: boolean; onSent: () => void }) {
  const t = useT();
  const titles = useSendable();
  const prefix = tv ? "tv-chat" : "chat";
  const [step, setStep] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<string | null>(null);
  useEffect(() => {
    if (!nav || step !== null) return;
    const on = document.activeElement;
    if (on !== null && on !== document.body) return;
    (
      document.querySelector<HTMLElement>(`[data-testid='${prefix}-pick']:not(:disabled)`) ??
      document.querySelector<HTMLElement>(`[data-testid='${prefix}-panel-tab'][aria-selected='true']`)
    )?.focus();
  }, [titles, nav, prefix, step]);
  useLayoutEffect(() => {
    const address = back.current;
    if (step !== null || address === null) return;
    back.current = null;
    list.current?.querySelector<HTMLElement>(`[data-testid='${prefix}-pick-more'][data-address='${address}']`)?.focus({ preventScroll: false });
  }, [step, prefix]);

  const open = titles.find((title) => title.address === step);
  const gone = step !== null && !open;
  useEffect(() => {
    if (gone) setStep(null);
  }, [gone]);
  if (open) {
    return (
      <TitleSend
        key={open.address}
        title={open}
        session={session}
        tv={tv}
        nav={nav}
        pointer={pointer}
        onBack={() => {
          back.current = open.address;
          setStep(null);
        }}
        onSent={onSent}
      />
    );
  }
  if (titles.length === 0) {
    return (
      <p className={`${prefix}-pick-none`} data-testid={`${prefix}-pick-none`}>
        {t("chat.noTitles")}
      </p>
    );
  }
  return (
    <div className={`${prefix}-picks`} ref={list} data-testid={`${prefix}-picks`}>
      {titles.map((title, at) => (
        <div className={`${prefix}-pick-row`} key={title.address}>
          <button
            type="button"
            className={`${prefix}-pick`}
            disabled={session.sending}
            onClick={() => {
              if (session.sending) return;
              onSent();
              void send(session, title);
            }}
            {...navOf(nav)}
            {...(nav && at === 0 ? { "data-autofocus": true } : {})}
            data-address={title.address}
            data-testid={`${prefix}-pick`}
          >
            <Poster className={`${prefix}-pick-art`} title={title.title} image={title.image} />
            <span className={`${prefix}-pick-name`}>{title.title}</span>
            {title.year && <span className={`${prefix}-pick-year`}>{title.year}</span>}
          </button>
          <button
            type="button"
            className={`${prefix}-pick-more`}
            aria-label={t("chat.sendMore", { title: title.title })}
            title={t("chat.sendMore", { title: title.title })}
            aria-haspopup="true"
            onClick={() => setStep(title.address)}
            {...navOf(nav)}
            data-address={title.address}
            data-testid={`${prefix}-pick-more`}
          >
            <MoreIcon aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

interface EpisodeChoice {
  season: number;
  episode: number;
}

function TitleSend({ title, session, tv, nav, pointer, onBack, onSent }: { title: Sendable; session: ChatSession; tv: boolean; nav: boolean; pointer: boolean; onBack: () => void; onSent: () => void }) {
  const t = useT();
  const prefix = tv ? "tv-chat" : "chat";
  const { progress, watched, ratings } = useProfileData();
  const show = isShowAddress(title.address);
  const url = title.url ?? "";
  const entry: Entry = useMemo(() => ({ id: title.address, title: title.title, url, kind: show ? "series" : "movie" }), [title.address, title.title, url, show]);
  useBackFirst(onBack);
  const root = useRef<HTMLDivElement>(null);

  const seasons = useSeasons(show && url ? url : undefined);
  const [episode, setEpisode] = useState<EpisodeChoice | null>(null);
  const details = useEpisodeDetails(episode && url ? url : undefined, episode?.season);
  const numbers = details ? [...details.values()].filter((detail) => detail.url).map((detail) => detail.episode).sort((a, b) => a - b) : details;
  const shown: EpisodeChoice | null = episode && numbers?.length ? { season: episode.season, episode: numbers.includes(episode.episode) ? episode.episode : numbers[0]! } : episode;
  const offerEpisode = show && url !== "" && (seasons === undefined || seasons.length > 0);
  const canEpisode = offerEpisode && seasons !== undefined;

  useEffect(() => {
    const step = root.current;
    if (!step || step.contains(document.activeElement)) return;
    (step.querySelector<HTMLElement>("[data-autofocus]") ?? step.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
  }, [offerEpisode]);
  const chooseEpisode = () => {
    const own = startOf(entry, true, progress);
    const season = own && seasons?.includes(own.season) ? own.season : (seasons?.[0] ?? 1);
    setEpisode({ season, episode: own && own.season === season ? own.episode : 1 });
  };
  const stepSeason = (by: number) => {
    if (!shown || !seasons) return;
    const next = seasons[seasons.indexOf(shown.season) + by];
    if (next !== undefined) setEpisode({ season: next, episode: 1 });
  };
  const stepEpisode = (by: number) => {
    if (!shown || !numbers) return;
    const next = numbers[numbers.indexOf(shown.episode) + by];
    if (next !== undefined) setEpisode({ season: shown.season, episode: next });
  };

  const timed = !show || shown !== null;
  const [at, setAt] = useState(0);
  const runtime = shown && details ? details.get(shown.episode)?.runtime : undefined;
  const card = cardOf(entry, progress);
  const end = runtime ? runtime * 60 : !show && card && card.duration > 0 ? Math.floor(card.duration) : undefined;
  const max = end ? Math.max(1, lastStartAt(end)) : TIME_MAX;
  const startAt = Math.min(at, max);
  const ownTime = !show
    ? card
      ? resumeAt(card)
      : undefined
    : shown
      ? (() => {
          const status = episodeStatus(watched, showKeyOf(entry, progress), shown.season, shown.episode);
          return status.kind === "started" ? Math.floor(status.position) : undefined;
        })()
      : undefined;
  const [typed, setTyped] = useState<string | null>(null);
  const typedAt = typed === null ? undefined : typedTime(typed, max);
  const badTime = timed && typed !== null && typed.trim() !== "" && typedAt === undefined;

  const rating = url ? ratingFor(ratings, url) : undefined;
  const [withRating, setWithRating] = useState(false);

  const extras = chosenExtras({ show, episode: shown && numbers?.length ? shown : null, at: timed ? startAt : 0, score: withRating ? rating?.score : undefined });
  const waiting = show && episode !== null && !numbers?.length;

  return (
    <div className={`${prefix}-extras`} ref={root} data-testid={`${prefix}-extras`}>
      <div className={`${prefix}-extras-head`}>
        <button type="button" className={`${prefix}-extras-back`} aria-label={t("chat.sendBack")} title={t("chat.sendBack")} onClick={onBack} {...navOf(nav)} data-testid={`${prefix}-extras-back`}>
          <ChevronLeftIcon aria-hidden="true" />
        </button>
        <Poster className={`${prefix}-extras-art`} title={title.title} image={title.image} />
        <b className={`${prefix}-extras-name`}>{title.year ? `${title.title} (${title.year})` : title.title}</b>
      </div>

      {offerEpisode && (
        <div className={`${prefix}-extras-line`} role="radiogroup" aria-label={t("player.episodes")}>
          <button type="button" role="radio" aria-checked={episode === null} className={`${prefix}-extras-chip`} onClick={() => setEpisode(null)} {...navOf(nav)} data-autofocus data-testid={`${prefix}-extras-whole`}>
            {t("chat.sendWhole")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={episode !== null}
            aria-disabled={!canEpisode || undefined}
            className={`${prefix}-extras-chip`}
            onClick={() => canEpisode && episode === null && chooseEpisode()}
            {...navOf(nav)}
            data-testid={`${prefix}-extras-one`}
          >
            {t("chat.sendOne")}
          </button>
        </div>
      )}
      {canEpisode && shown && (
        <div className={`${prefix}-extras-line`}>
          <Stepper
            prefix={prefix}
            nav={nav}
            value={t("player.season", { n: shown.season })}
            back={{ label: t("chat.seasonPrev"), can: seasons!.indexOf(shown.season) > 0, run: () => stepSeason(-1) }}
            on={{ label: t("chat.seasonNext"), can: seasons!.indexOf(shown.season) < seasons!.length - 1, run: () => stepSeason(1) }}
            testId={`${prefix}-extras-season`}
          />
          <Stepper
            prefix={prefix}
            nav={nav}
            value={numbers === undefined ? "…" : numbers === null || numbers.length === 0 ? "-" : t("player.episodeN", { n: shown.episode })}
            back={{ label: t("chat.episodePrev"), can: Boolean(numbers?.length) && numbers!.indexOf(shown.episode) > 0, run: () => stepEpisode(-1) }}
            on={{ label: t("chat.episodeNext"), can: Boolean(numbers?.length) && numbers!.indexOf(shown.episode) < numbers!.length - 1, run: () => stepEpisode(1) }}
            testId={`${prefix}-extras-episode`}
          />
        </div>
      )}
      {canEpisode && shown && numbers === null && <p className={`${prefix}-extras-note`}>{t("series.failed")}</p>}

      {timed && (
        <>
          <p className={`${prefix}-extras-label`} data-testid={`${prefix}-extras-from`}>
            <span>{t("chat.sendStart")}:</span> <b>{startAt > 0 ? t("starting.from", { time: formatTime(startAt) }) : t("chat.fromStart")}</b>
          </p>
          <div className={`${prefix}-extras-line`}>
            {[-10, -1, 1, 10].map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`${prefix}-extras-step`}
                aria-label={t(minutes < 0 ? "chat.minutesBack" : "chat.minutesOn", { n: Math.abs(minutes) })}
                aria-disabled={(minutes < 0 ? startAt === 0 : startAt >= max) || undefined}
                onClick={() => {
                  setTyped(null);
                  setAt(movedTime(startAt, minutes, max));
                }}
                {...navOf(nav)}
                {...(!offerEpisode && minutes === 1 ? { "data-autofocus": true } : {})}
                data-testid={`${prefix}-extras-time`}
                data-minutes={minutes}
              >
                {minutes < 0 ? `−${-minutes}` : `+${minutes}`}
              </button>
            ))}
            {ownTime !== undefined && (
              <button
                type="button"
                className={`${prefix}-extras-chip`}
                aria-pressed={startAt === ownTime}
                onClick={() => {
                  setTyped(null);
                  setAt(ownTime);
                }}
                {...navOf(nav)}
                data-testid={`${prefix}-extras-own`}
              >
                {t("chat.whereYouAre", { time: formatTime(ownTime) })}
              </button>
            )}
          </div>
          {pointer && !nav && (
            <label className={`${prefix}-extras-typed`}>
              <span>{t("chat.timeTyped")}</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={9}
                value={typed ?? (startAt > 0 ? formatTime(startAt) : "")}
                placeholder="0:00"
                aria-invalid={badTime}
                onChange={(event) => {
                  setTyped(event.target.value);
                  const seconds = typedTime(event.target.value, max);
                  if (seconds !== undefined) setAt(seconds);
                  else if (event.target.value.trim() === "") setAt(0);
                }}
                onBlur={() => setTyped(null)}
                data-testid={`${prefix}-extras-typed`}
              />
            </label>
          )}
        </>
      )}

      {rating && (
        <button type="button" className={`${prefix}-extras-chip ${prefix}-extras-rating`} aria-pressed={withRating} onClick={() => setWithRating((on) => !on)} {...navOf(nav)} data-testid={`${prefix}-extras-rating`}>
          {withRating ? <CheckIcon aria-hidden="true" /> : <StarIcon aria-hidden="true" />} {t("chat.sendRating", { score: rating.score })}
        </button>
      )}

      <button
        type="button"
        className={`${prefix}-extras-go`}
        aria-disabled={session.sending || waiting || badTime || undefined}
        onClick={() => {
          if (session.sending || waiting || badTime) return;
          onSent();
          void send(session, title, extras);
        }}
        {...navOf(nav)}
        data-testid={`${prefix}-extras-go`}
      >
        <SendIcon aria-hidden="true" /> {t("chat.sendIt")}
      </button>
    </div>
  );
}

function Stepper({ prefix, nav, value, back, on, testId }: { prefix: string; nav: boolean; value: string; back: { label: string; can: boolean; run: () => void }; on: { label: string; can: boolean; run: () => void }; testId: string }) {
  return (
    <span className={`${prefix}-extras-stepper`} data-testid={testId}>
      <button type="button" className={`${prefix}-extras-step`} aria-label={back.label} title={back.label} aria-disabled={!back.can || undefined} onClick={() => back.can && back.run()} {...navOf(nav)} data-testid={`${testId}-back`}>
        <ChevronLeftIcon aria-hidden="true" />
      </button>
      <span className={`${prefix}-extras-value`} aria-live="polite">
        {value}
      </span>
      <button type="button" className={`${prefix}-extras-step`} aria-label={on.label} title={on.label} aria-disabled={!on.can || undefined} onClick={() => on.can && on.run()} {...navOf(nav)} data-testid={`${testId}-on`}>
        <ChevronIcon aria-hidden="true" />
      </button>
    </span>
  );
}
