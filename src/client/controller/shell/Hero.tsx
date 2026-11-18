import type { LibraryItem, PlayHint } from "../../../shared";
import { hintOf, listName } from "../../account/cards";
import { useProfileData } from "../../account/store";
import { useT } from "../../i18n";
import { CheckIcon, InfoIcon, PlayIcon, PlusIcon } from "../../shared/icons";
import { Poster, sharper } from "../../shared/Poster";
import { entryOfItem, resumable, type Entry } from "../../tv/pages";
import type { ListToggle } from "../Round";

export function Hero({
  item,
  toggle,
  onOpen,
  onPlay,
}: {
  item: LibraryItem;
  toggle: ListToggle;
  onOpen: (entry: Entry) => void;
  onPlay?: (url: string, startAt: number | undefined, hint: PlayHint) => void;
}) {
  const t = useT();
  const { progress, lists } = useProfileData();
  const entry = resumable(entryOfItem(item), progress);
  const kind = item.kind === "movie" ? t("library.kindMovie") : item.kind === "series" ? t("library.kindSeries") : undefined;
  const meta = [item.year, kind].filter(Boolean).join(" · ");
  const plays = onPlay !== undefined && item.kind === "movie" && entry.url !== "";
  const label = plays ? t(entry.startAt !== undefined ? "rows.resume" : "rows.play") : item.kind === "series" ? t("player.episodes") : t("rows.open");
  const open = () => onOpen(entryOfItem(item));
  const play = () => onPlay?.(new URL(entry.resumeUrl ?? entry.url, location.href).href, entry.startAt, hintOf(entry));
  return (
    <section className="hero" data-testid="home-hero" aria-label={item.title}>
      <button type="button" className="hero-open" onClick={open} aria-label={`${t("rows.open")} ${item.title}`} data-testid="hero-open">
        <Poster className="lib-art hero-art" title={item.title} image={sharper(item.image) ?? item.backdrop} seed={item.id} />
      </button>
      <div className="hero-text">
        <h2 className="hero-title">{item.title}</h2>
        {meta && <p className="hero-meta">{meta}</p>}
        <div className="hero-actions">
          <button type="button" className="btn btn-red hero-play" onClick={plays ? play : open} data-testid="hero-play">
            {plays ? <PlayIcon /> : <InfoIcon />} {label}
          </button>
          <button type="button" className="btn hero-list" onClick={toggle.onClick} aria-pressed={toggle.inList} aria-haspopup={toggle.asks ? "dialog" : undefined} aria-label={`${toggle.label}: ${item.title}`} data-testid="hero-list">
            {toggle.inList ? <CheckIcon /> : <PlusIcon />} {toggle.asks ? t("rows.myList") : listName(lists[0]!)}
          </button>
        </div>
      </div>
    </section>
  );
}
