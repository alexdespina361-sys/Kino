import { useEffect, useMemo, useState, type Ref } from "react";
import {
  CAPTION_SETTINGS,
  CAPTION_VALUES,
  describeStatus,
  episodeName,
  episodeStatus,
  formatDelay,
  groupBySeason,
  groupOf,
  isCurrentEpisode,
  PLAYBACK_SPEEDS,
  type CaptionSetting,
  type CaptionStyle,
  type PlayerState,
  type PlayerTrack,
  type SeasonGroup,
  type SeriesInfo,
  versionLabel,
  type WatchedEntry,
} from "../../shared";
import { languageNames, useSubtitleLists, type SubtitleLists } from "../account/subtitles";
import { t, useT } from "../i18n";
import { captionBottom, captionTextStyle } from "../shared/captionCss";
import { useEpisodeDetails, type SeasonDetails } from "../shared/episodeDetails";
import { formatLeft } from "../shared/format";
import { CheckIcon, CloseIcon } from "../shared/icons";
import { captionLabel, captionTitle, statusWords, trackName } from "../shared/words";
import { EpisodeRow, type EpisodeCard } from "./EpisodeRow";

export type MenuKind = "tracks" | "captions" | "speed" | "quality" | "sources" | "episodes";

interface Option {
  key: string | number;
  label: string;
  active: boolean;
  /** Shown at the end of the row instead of a check mark (the current value of a setting). */
  detail?: string;
  /** An episode with a picture and a line about it, instead of a line of text. */
  card?: EpisodeCard;
  pick: () => void;
  /** Moving onto the option already acts on it (a list of settings shows each one's choices as you pass). */
  onFocus?: () => void;
}
/** A line of text between options (the remote walks past it). */
interface Heading {
  key: string;
  heading: string;
}
interface Column {
  title: string;
  options: Array<Option | Heading>;
  /** How much room the column asks for: a short list of choices, or names that can be long. */
  size?: "narrow" | "wide";
  /** Long names may take two lines instead of being cut off. */
  wrap?: boolean;
}

interface MenuProps {
  kind: MenuKind;
  player: PlayerState;
  series: SeriesInfo | undefined;
  captionStyle: CaptionStyle;
  subtitleDelay?: number;
  onSubtitleDelay?: (delay: number) => void;
  /** The show's key and what has been watched, to mark the episode list. */
  show: string | undefined;
  watched: readonly WatchedEntry[];
  rootRef: Ref<HTMLDivElement>;
  onClose: () => void;
  onSubtitle: (track: number) => void;
  onAudio: (track: number) => void;
  onSpeed: (rate: number) => void;
  onQuality: (level: number) => void;
  onSource: (index: number) => void;
  onCaption: (changes: Partial<CaptionStyle>) => void;
  onKind: (kind: MenuKind) => void;
  onEpisode: (url: string) => void;
}

const titleOf = (kind: MenuKind): string => {
  switch (kind) {
    case "tracks":
      return t("player.audioSubtitles");
    case "captions":
      return t("player.captionStyle");
    case "speed":
      return t("player.speed");
    case "quality":
      return t("player.quality");
    case "sources":
      return t("player.source");
    case "episodes":
      return t("player.episodes");
  }
};

interface Selection {
  /** The seasons of the show, and the one listed. */
  groups: SeasonGroup[];
  shown: SeasonGroup | undefined;
  /** What is known of the listed season's episodes: undefined while it is being asked, null when nothing is (a plain list then). */
  details: SeasonDetails | null | undefined;
  setSeason: (season: number) => void;
  setting: CaptionSetting;
  setSetting: (setting: CaptionSetting) => void;
  /** The subtitle language whose releases are listed (moves with the remote through the languages). */
  language: string | undefined;
  setLanguage: (language: string) => void;
  /** List the languages a profile's own list leaves out, for as long as this menu is open. */
  showAll: () => void;
}

const NO_TRACKS: PlayerTrack[] = [];

function columnsFor(p: MenuProps, { groups, shown, details, setSeason, setting, setSetting, language, setLanguage, showAll }: Selection, lists: SubtitleLists<PlayerTrack>): Column[] {
  const { player, kind } = p;

  if (kind === "captions") {
    return [
      {
        title: t("player.styleColumn"),
        options: CAPTION_SETTINGS.map((key) => ({
          key,
          label: captionTitle(key),
          detail: captionLabel(key, p.captionStyle[key] as never),
          active: key === setting,
          pick: () => setSetting(key),
          onFocus: () => setSetting(key),
        })),
      },
      {
        title: captionTitle(setting),
        options: CAPTION_VALUES[setting].map((value) => ({
          key: value,
          label: captionLabel(setting, value as never),
          active: p.captionStyle[setting] === value,
          pick: () => p.onCaption({ [setting]: value }),
        })),
      },
    ];
  }

  if (kind === "speed") {
    const rate = player.playbackRate ?? 1;
    return [
      {
        title: t("player.speedShort"),
        options: PLAYBACK_SPEEDS.map((value) => ({
          key: value,
          label: value === 1 ? t("player.normal") : `${value}×`,
          active: Math.abs(rate - value) < 0.01,
          pick: () => p.onSpeed(value),
        })),
      },
    ];
  }

  if (kind === "quality") {
    const quality = player.quality;
    const levels = [...(quality?.levels ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    return [
      {
        title: t("player.quality"),
        options: [
          { key: -1, label: t("player.auto"), active: quality?.current === -1, pick: () => p.onQuality(-1) },
          ...levels.map((level) => ({
            key: level.id,
            label: level.label,
            active: quality?.current === level.id,
            pick: () => p.onQuality(level.id),
          })),
        ],
      },
    ];
  }

  if (kind === "sources") {
    const sources = player.sources;
    return [
      {
        title: t("player.sourceFrom"),
        options: (sources?.labels ?? []).map((label, index) => ({
          key: index,
          label,
          active: sources?.current === index,
          pick: () => p.onSource(index),
        })),
      },
    ];
  }

  if (kind === "episodes") {
    const series = p.series;
    if (!series || !shown) return [];
    const columns: Column[] = [];
    if (groups.length > 1) {
      columns.push({
        title: t("player.seasons"),
        options: groups.map((group) => ({
          key: group.season,
          label: t("player.season", { n: group.season }),
          active: group.season === shown.season,
          pick: () => setSeason(group.season),
        })),
      });
    }
    columns.push({
      title: groups.length > 1 ? t("player.season", { n: shown.season }) : t("player.episodes"),
      options: shown.episodes.map((episode): Option => {
        const current = isCurrentEpisode(series, episode);
        const status = episodeStatus(p.watched, p.show, episode.season, episode.episode);
        const note = describeStatus(status, statusWords());
        const known = details?.get(episode.episode);
        const name = episodeName(known?.title ? { ...episode, title: known.title } : episode, t("player.episodeN", { n: episode.episode }));
        const base = {
          key: `${episode.season}-${episode.episode}`,
          active: current,
          // Picking what is already playing just closes the list.
          pick: () => (current ? p.onClose() : p.onEpisode(episode.url)),
        };
        // Nothing known about the season's episodes beyond their names: the plain list. Otherwise (and while it is being asked, so the list does not change shape) each one is a card.
        if (details === null) {
          // Where the check mark would be for the episode playing now: what's left of the others.
          return { ...base, label: `${episode.episode}. ${name}`, ...(current ? {} : { detail: note }) };
        }
        return {
          ...base,
          label: name,
          card: {
            number: episode.episode,
            name,
            still: known?.still,
            overview: known?.overview,
            meta: current ? t("player.nowPlaying") : (note ?? (known?.runtime ? formatLeft(known.runtime * 60) : undefined)),
            state: current ? "now" : status.kind,
            fraction: status.kind === "started" ? status.fraction : undefined,
          },
        };
      }),
    });
    return columns;
  }

  const columns: Column[] = [];

  // Audio: only when there is a choice (a plain file has one track, and a column with a single "Default" is just noise).
  const audio = player.audio?.tracks ?? [];
  if (audio.length > 1) {
    columns.push({
      title: t("player.audio"),
      size: "narrow",
      options: audio.map((track) => ({
        key: track.id,
        label: trackName(track),
        active: player.audio?.current === track.id,
        pick: () => p.onAudio(track.id),
      })),
    });
  }

  // Subtitles: the languages the profile asked for come first, then the rest under a heading. One list while every language
  // has a single track; otherwise the languages, and beside them the releases of the language the remote is on (a source can
  // offer a dozen of the same one, too many to walk through in one list).
  const subtitles = player.subtitles;
  const { pinned, more } = lists;
  const visible = [...pinned, ...more];
  const off: Option = { key: -1, label: t("common.off"), active: (subtitles?.current ?? -1) === -1, pick: () => p.onSubtitle(-1) };
  const heading: Heading[] = pinned.length > 0 && more.length > 0 ? [{ key: "more-languages", heading: t("player.moreLanguages") }] : [];
  // The way out of a profile's "only these languages": the others, for as long as this menu is open.
  const reveal: Option[] = lists.hidden > 0 ? [{ key: "show-all", label: t("player.showAll"), active: false, pick: showAll }] : [];
  if (visible.every((group) => group.tracks.length === 1)) {
    const option = (track: PlayerTrack): Option => ({ key: track.id, label: trackName(track), active: subtitles?.current === track.id, pick: () => p.onSubtitle(track.id) });
    columns.push({
      title: t("player.subtitles"),
      size: "wide",
      options: [off, ...pinned.flatMap((group) => group.tracks.map(option)), ...heading, ...more.flatMap((group) => group.tracks.map(option)), ...reveal],
    });
  } else {
    const playing = groupOf(visible, subtitles?.current);
    const shown = visible.find((group) => group.key === language) ?? playing ?? visible[0]!;
    const option = (group: (typeof visible)[number]): Option => ({
      key: group.key,
      label: group.name,
      ...(group.tracks.length > 1 ? { detail: String(group.tracks.length) } : {}),
      active: playing?.key === group.key,
      // Passing a language lists its releases; OK turns it on (the release already chosen in it, else the first).
      onFocus: () => setLanguage(group.key),
      pick: () => p.onSubtitle(playing?.key === group.key ? subtitles!.current : group.tracks[0]!.id),
    });
    columns.push({
      title: t("player.language"),
      size: "narrow",
      options: [off, ...pinned.map(option), ...heading, ...more.map(option), ...reveal],
    });
    columns.push({
      title: t("player.versions", { language: shown.name }),
      size: "wide",
      wrap: true,
      options: shown.tracks.map((track, index) => ({
        key: track.id,
        label: versionLabel(track, languageNames(shown), index, t("player.version", { n: index + 1 })),
        active: subtitles?.current === track.id,
        pick: () => p.onSubtitle(track.id),
      })),
    });
  }

  const delay = p.subtitleDelay ?? 0;
  const nudge = (by: number) => p.onSubtitleDelay?.(Math.round((delay + by) * 10) / 10);
  columns.push({
    title: t("player.adjust"),
    size: "narrow",
    // "Aspectul subtitrărilor…" is longer than "Subtitle style…": a name may take two lines instead of being cut off.
    wrap: true,
    options: [
      { key: "sub-earlier", label: t("player.earlier"), detail: "−0.5s", active: false, pick: () => nudge(-0.5) },
      { key: "sub-later", label: t("player.later"), detail: "+0.5s", active: false, pick: () => nudge(0.5) },
      { key: "sub-reset", label: t("player.resetDelay"), detail: formatDelay(delay), active: false, pick: () => p.onSubtitleDelay?.(0) },
      { key: "style", label: t("player.captionStyleMore"), active: false, pick: () => p.onKind("captions") },
    ],
  });
  return columns;
}

/** Audio / subtitles / speed / quality / episodes picker. Every option is a real button so the remote's arrows and OK just work. */
export function TvMenu(props: MenuProps) {
  useT();
  const [season, setSeason] = useState<number | undefined>(props.series?.season);
  const [setting, setSetting] = useState<CaptionSetting>(CAPTION_SETTINGS[0]!);
  const [language, setLanguage] = useState<string | undefined>(undefined);
  const [all, setAll] = useState(false);
  const lists = useSubtitleLists(props.player.subtitles?.tracks ?? NO_TRACKS, props.player.subtitles?.current, all);
  const groups = useMemo(() => (props.kind === "episodes" ? groupBySeason(props.series?.episodes ?? []) : []), [props.kind, props.series?.episodes]);
  const shown = groups.find((group) => group.season === season) ?? groups[0];
  // Any episode's link will do to ask about its season: the first one is always the same.
  const details = useEpisodeDetails(shown?.episodes[0]?.url, shown?.season);
  const columns = columnsFor(props, { groups, shown, details, setSeason, setting, setSetting, language, setLanguage, showAll: () => setAll(true) }, lists);
  const title = titleOf(props.kind);

  // Start on whatever is selected now (the episode you're watching, the current language), so OK changes nothing by accident.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-tv-menu]");
    const actives = root?.querySelectorAll<HTMLElement>("[data-active='true']");
    const start = props.kind === "episodes" ? actives?.[actives.length - 1] : actives?.[0];
    (start ?? root?.querySelector<HTMLElement>("[data-opt]"))?.focus();
  }, [props.kind]);

  return (
    <div className="tv-menu-backdrop" data-kind={props.kind} onClick={props.onClose}>
      <div
        className="tv-menu"
        ref={props.rootRef}
        data-tv-menu
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="audio-subtitles-modal"
        data-kind={props.kind}
        data-cols={columns.length}
        data-rich={props.kind === "episodes" && details !== null}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tv-menu-top">
          <h2>
            {title}
            {props.kind === "episodes" && props.show && <small className="tv-menu-show">{props.show}</small>}
          </h2>
          <button className="tv-btn tv-btn-icon" onClick={props.onClose} aria-label={t("common.close")} title={t("common.close")}>
            <CloseIcon />
          </button>
        </div>
        <div className="tv-menu-cols">
          {columns.map((column, col) => (
            <div className="tv-menu-col" key={column.title} data-size={column.size} data-wrap={column.wrap}>
              <h3>{column.title}</h3>
              <div className="tv-opts" role="listbox" aria-label={column.title}>
                {column.options.map((option) =>
                  "heading" in option ? (
                    <div key={option.key} className="tv-opt-heading" role="presentation">
                      {option.heading}
                    </div>
                  ) : (
                    <button
                      key={option.key}
                      className={option.card ? "tv-opt tv-ep" : "tv-opt"}
                      data-opt
                      data-col={col}
                      data-active={option.active}
                      role="option"
                      aria-selected={option.active}
                      onClick={option.pick}
                      onFocus={option.onFocus}
                    >
                      {option.card ? (
                        <EpisodeRow {...option.card} />
                      ) : (
                        <>
                          <span>{option.label}</span>
                          {option.detail !== undefined ? <em className="tv-opt-detail">{option.detail}</em> : option.active && <CheckIcon />}
                        </>
                      )}
                    </button>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
        {props.kind === "tracks" && (
          // Drawn exactly like the real subtitles, so a look can be judged before it is chosen.
          <div className="tv-sub-preview" data-testid="subtitle-preview" aria-hidden="true">
            <span className="tv-caption" style={captionTextStyle(props.captionStyle)}>
              {t("player.sample")}
            </span>
          </div>
        )}
      </div>
      {props.kind === "captions" && (
        // Over the picture at the real size and height (the panel sits at the top), so Height can be seen moving the text.
        <div className="tv-caption-stage" data-testid="subtitle-preview" aria-hidden="true" style={{ bottom: captionBottom(props.captionStyle) }}>
          <span className="tv-caption" style={captionTextStyle(props.captionStyle)}>
            {t("player.sample")}
          </span>
        </div>
      )}
    </div>
  );
}

/** Arrow-key navigation inside the menu: up/down within a column, left/right across columns. */
export function moveInMenu(root: HTMLElement | null, direction: "up" | "down" | "left" | "right"): void {
  if (!root) return;
  const options = [...root.querySelectorAll<HTMLElement>("[data-opt]")];
  const current = options.find((option) => option === document.activeElement);
  if (!current) {
    (options.find((option) => option.dataset.active === "true") ?? options[0])?.focus();
    return;
  }

  const col = Number(current.dataset.col);
  const inColumn = (c: number) => options.filter((option) => Number(option.dataset.col) === c);
  const mine = inColumn(col);
  const row = mine.indexOf(current);

  if (direction === "up" || direction === "down") {
    mine[Math.max(0, Math.min(mine.length - 1, row + (direction === "down" ? 1 : -1)))]?.focus();
    return;
  }
  const other = inColumn(col + (direction === "right" ? 1 : -1));
  // Land on what is selected over there (the current episode, the current subtitle), else on the same row.
  (other.find((option) => option.dataset.active === "true") ?? other[Math.min(row, other.length - 1)])?.focus();
}
