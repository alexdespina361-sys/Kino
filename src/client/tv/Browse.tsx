import { Fragment, memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode, type RefObject, useCallback } from "react";
import { canAskTogether, DEFAULT_LIST, forChildren, friendChoices, isWanted, LibraryItemsSchema, LibrarySchema, listKey, MAX_LISTS, ratingsShown, savedKeys, sectionOf, tagLabel, titleLink, wantedSections, type Library, type LibraryItem, type PlayHint, type Person } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { hintOf, listEntryOf, listName } from "../account/cards";
import { describeError } from "../account/errors";
import { signedInLine } from "../account/google";
import { useCanConnectGoogle } from "../account/GoogleButton";
import { ListEditor } from "../account/Lists";
import { listTap } from "../account/listTap";
import { ratingFor, scoreOf } from "../account/ratingText";
import { useScores } from "../account/ratings";
import { profileStore, useProfileData } from "../account/store";
import { GetTheAppStrip } from "../app/GetTheApp";
import { waitingFrom } from "../chat/notices";
import { nameOf, recommendationOf, presenceInChat } from "../friends/entries";
import { useFriends } from "../friends/FriendsProvider";
import { useBell } from "../friends/useBell";
import { friendGrid, friendRows, friendsSummary } from "../friends/pages";
import { askLists, askRatings, useShared } from "../friends/useShared";
import { useLanguage, useT } from "../i18n";
import { browserBack, handHeld, useBackWhile } from "../shared/backButton";
import { libraryAnswer } from "../shared/earlyLibrary";
import { AnimeIcon, BackspaceIcon, CartoonIcon, CheckIcon, ChevronIcon, ChevronLeftIcon, ClearIcon, ClockIcon, CloseIcon, EyeIcon, FilmIcon, GearIcon, GridIcon, HomeIcon, InfoIcon, ListIcon, MessageIcon, PencilIcon, PhoneIcon, PlayIcon, PlusIcon, SearchIcon, SparkleIcon, StarIcon, TvIcon, UsersIcon } from "../shared/icons";
import { allRows, failedShelves, feed, GRID_CAP, hasMoreShelves, hasMoreTitles, loadingShelves, loadingTitles, nearBottom, pageRows, ROW_CAP, useFeed } from "../shared/feed";
import { canFullscreen } from "../shared/fullscreen";
import { FullscreenToggle } from "../shared/FullscreenToggle";
import { Logo } from "../shared/Logo";
import { CARD_FIT, comesIn, FAN_FIT, hueOf, Poster, posterSizes, sharper, TILE_FIT } from "../shared/Poster";
import { useLikes } from "../shared/recommend";
import { useWatching } from "../shared/watching";
import { personalSlots } from "../shared/taste";
import { ScoreBadge } from "../shared/ScoreBadge";
import { AboutFacts, AboutPeople } from "../shared/AboutFacts";
import { shownTitle, useShown } from "../shared/names";
import { aboutRows, useAbout } from "../shared/about";
import { takeStrayAddress } from "../shared/strayAddress";
import { ownTitles, useChildGate } from "../shared/childGate";
import { useProfileHold } from "../shared/profileHold";
import { addressOf, dropLink, pendingLink, showTitle } from "../shared/titleAddress";
import { playOnTv, switchRole, thisIsPhone, thisTier } from "../role";
import { gridRows, sectionPlaces, sectionRows, stepFrom, type Pos, type Shape, type Target, type Zone } from "./browseNav";
import { isCompact, useCompact, useFlatHand } from "./compact";
import { episodeRows, SeriesSection, useSeriesPage, type PageEpisode } from "./Episodes";
import { AddFriendTv, FriendPickerTv, FriendRequestTv, FriendSettingsTv, NotificationsTv, PlanPickerTv, PlanTv, UnfriendTv } from "./Friends";
import { dayOf, LATEST, useNews } from "../changelog/news";
import { AccountChip, BackButton, BellChip, Screen } from "./Idle";
import { actionForKey } from "./keys";
import { useBackFirst } from "./dpad";
import { allExact, editBox, KEYBOARD_COLUMNS, KEYBOARD_KEYS, KEYBOARD_SHAPE, keepMatching, matchLocal, mergeAnswers, NO_ANSWERS, onlyForChildren, onlySection, selectedText, typedCharacter, type Answers, type BoxEdit, type SearchBox } from "./librarySearch";
import { columnsFor, pageWidth, PITCH_EM } from "./columns";
import { filterRows, ownSection, ratingChoices, usableFilter, type RatingFilter } from "../account/ratingFilter";
import { useCardSections } from "./cardSections";
import { asOpened, backOf, entryOfItem, gridOf, hasRows, heroActions, isProfilePage, isRowsPage, isTitle, listOfRow, openedAt, overviewActions, playLabel, ratingSectionIn, resumable, rowsOfPage, SECTION_FILTERS, sectionOfPage, shownList, viewKey, type RowsPage, type Entry, type FriendTab, type HeroAction, type HomeRow, type Layout, type PageData, type SectionFilter, type Start, type View } from "./pages";
import { profileRows } from "./profile";
import { warmPlayer } from "./engine";
import { ProfileHead } from "./ProfileHead";
import { Rail, type RailEntry } from "./Rail";
import { RateOverlay } from "./RateOverlay";
import { SearchField } from "./SearchField";
import { watchSeen } from "./rowWatch";
import { ChatTv } from "../chat/ChatTv";
import type { OpenTitle } from "../chat/titles";
import { useHost } from "../chat/useHost";
import { NewsList } from "../changelog/NewsList";

const STEP = 0.8;
const NEAR_END = 1.5;
const WAITING_TILES = 3;
const NEAR_MARGIN = "1250px 0px";
function RowTiles({ children, onNearEnd, loading, startFar }: { children: ReactNode; onNearEnd?: () => void; loading?: boolean; startFar?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });
  const wantsMore = useRef(onNearEnd);
  wantsMore.current = onNearEnd;
  const onScreen = useRef(typeof IntersectionObserver === "undefined");
  const near = useRef(typeof IntersectionObserver === "undefined" || !startFar);

  useLayoutEffect(() => {
    if (!near.current) box.current?.setAttribute("data-far", "");
  }, []);

  const measure = useCallback(() => {
    const row = scroller.current;
    if (!row || !near.current) return;
    const before = row.scrollLeft > 2;
    const after = row.scrollLeft < row.scrollWidth - row.clientWidth - 2;
    setMore((was) => (was.before === before && was.after === after ? was : { before, after }));
    if (onScreen.current && row.clientWidth > 0 && row.scrollWidth - row.clientWidth - row.scrollLeft <= row.clientWidth * NEAR_END) wantsMore.current?.();
  }, []);

  useEffect(measure, [children, loading, Boolean(onNearEnd)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const row = scroller.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [measure]);
  useEffect(() => {
    const row = scroller.current;
    if (!row || typeof IntersectionObserver === "undefined") return;
    return watchSeen(row, null, "0px", (on) => {
      onScreen.current = on;
      if (on) measure();
    });
  }, [measure]);
  useEffect(() => {
    const here = box.current;
    if (!here || typeof IntersectionObserver === "undefined") return;
    return watchSeen(here, here.closest(".tv-rows"), NEAR_MARGIN, (on) => {
      near.current = on;
      here.toggleAttribute("data-far", !on);
      if (on && onScreen.current) measure();
    });
  }, [measure]);

  const go = (direction: -1 | 1) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * STEP, behavior: "smooth" });
  const arrow = (side: "before" | "after") => (
    <button
      type="button"
      className="tv-row-more"
      data-side={side}
      data-testid={side === "before" ? "tv-row-back" : "tv-row-next"}
      tabIndex={-1}
      aria-hidden="true"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => go(side === "before" ? -1 : 1)}
    >
      {side === "before" ? <ChevronLeftIcon /> : <ChevronIcon />}
    </button>
  );
  return (
    <div className="tv-row-box" ref={box}>
      <div className="tv-row-tiles" ref={scroller} onScroll={measure}>
        {children}
        {loading && Array.from({ length: WAITING_TILES }, (_, at) => <div className="tv-tile tv-skeleton" data-testid="tv-row-waiting" aria-hidden="true" key={`waiting-${at}`} />)}
      </div>
      {more.before && arrow("before")}
      {more.after && arrow("after")}
    </div>
  );
}

function Thumb({ on }: { on: unknown }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const thumb = ref.current;
    const box = thumb?.parentElement;
    if (!thumb || !box) return;
    const place = () => {
      const chosen = box.querySelector<HTMLElement>('[aria-checked="true"]');
      thumb.style.visibility = chosen ? "" : "hidden";
      if (chosen) {
        thumb.style.width = `${chosen.offsetWidth}px`;
        thumb.style.transform = `translateX(${chosen.offsetLeft}px)`;
      }
    };
    place();
    if (typeof ResizeObserver !== "function") return;
    const watch = new ResizeObserver(place);
    for (const one of Array.from(box.children)) watch.observe(one);
    return () => watch.disconnect();
  }, [on]);
  return <i ref={ref} className="tv-thumb" aria-hidden="true" />;
}

const scoreMenuRows = (scores: number, columns: number) => [1, ...Array.from({ length: Math.ceil((scores - 1) / columns) }, (_, at) => Math.min(columns, scores - 1 - at * columns))];

function ScorePick({ scores, chosen, countOf, row, columns, open, onOpen, onPick, onFocusButton }: { scores: ReadonlyArray<number | undefined>; chosen: number | undefined; countOf: (score: number | undefined) => number; row: number; columns: number; open: boolean; onOpen: (open: boolean) => void; onPick: (score: number | undefined) => void; onFocusButton: () => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const shut = () => {
    onOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  useBackFirst(open ? shut : undefined);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open, onOpen]);
  const label = (score: number | undefined) =>
    score === undefined ? (
      t("rating.filterAnyScore")
    ) : (
      <>
        <StarIcon filled /> {score}
      </>
    );
  return (
    <div
      ref={box}
      className="tv-score-pick"
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !box.current?.contains(event.relatedTarget)) onOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="tv-choice tv-score-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("rating.filterScores")}: ${chosen === undefined ? t("rating.filterAnyScore") : t("rating.filterScore", { score: chosen })}`}
        data-testid="rating-pick"
        data-zone="chips"
        data-row={row}
        data-col={0}
        onClick={() => onOpen(!open)}
        onFocus={onFocusButton}
      >
        {label(chosen)}
        <ChevronIcon className="tv-score-chevron" />
      </button>
      {open && (
        <div className="tv-score-menu" role="listbox" aria-label={t("rating.filterScores")} data-testid="rating-pick-menu" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {scores.map((score, index) => (
            <button
              key={score ?? "any"}
              type="button"
              role="option"
              aria-selected={chosen === score}
              className={index === 0 ? "tv-score-option tv-score-any" : "tv-score-option"}
              data-testid={`rating-pick-${score ?? "any"}`}
              data-zone="chips"
              data-row={index === 0 ? row + 1 : row + 2 + Math.floor((index - 1) / columns)}
              data-col={index === 0 ? 0 : (index - 1) % columns}
              onClick={() => {
                onPick(score);
                shut();
              }}
            >
              <span className="tv-score-name">{label(score)}</span>
              <span className="tv-score-count">{countOf(score)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AboutText({ text, className }: { text: string; className: string }) {
  const t = useT();
  const box = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useEffect(() => setOpen(false), [text]);
  useEffect(() => {
    const element = box.current;
    if (!element || open) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, [text, open]);

  return (
    <>
      <p ref={box} className={`${className}${open ? " is-open" : ""}`} data-testid="about-text">
        {text}
      </p>
      {(cut || open) && (
        <button
          type="button"
          className="about-more"
          aria-expanded={open}
          data-testid="about-more"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((was) => !was);
          }}
        >
          {t(open ? "library.aboutLess" : "library.aboutMore")}
        </button>
      )}
    </>
  );
}

function NewsTv({ onClose, onSeen }: { onClose: () => void; onSeen: () => void }) {
  const t = useT();
  const page = useRef<HTMLDivElement>(null);
  useEffect(onSeen, [onSeen]);
  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const watch = new MutationObserver(() => {
      const first = root.querySelector<HTMLElement>(".news-lines li");
      if (!first) return;
      watch.disconnect();
      const now = document.activeElement;
      if (!now || now === document.body || now.classList.contains("tv-back")) first.focus();
    });
    watch.observe(root, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  return (
    <Screen testId="tv-news" compact focus onBack={onClose} className="tv-news-screen">
      <BackButton onClick={onClose} testId="tv-news-back" />
      <h1 className="tv-headline tv-headline-small">{t("news.title")}</h1>
      <div ref={page} className="tv-news-body">
        <NewsList remote className="tv-news-list" />
      </div>
    </Screen>
  );
}

function TvChat({ friendId, narrow, onClose, onOpenTitle }: { friendId: string; narrow: boolean; onClose: () => void; onOpenTitle?: ((entry: Entry) => void) | undefined }) {
  const host = useHost(friendId, onClose);
  if (!host.friend) return null;
  const open: OpenTitle | undefined = onOpenTitle
    ? (item, opening) => {
        host.close();
        onOpenTitle(openedAt(entryOfItem(item), opening));
      }
    : undefined;
  return (
    <ChatTv
      name={host.friend.name}
      avatar={host.friend.avatar}
      online={host.friend.on && host.friend.online}
      presence={presenceInChat(host.friend, Date.now())}
      session={host.session}
      report={host.report}
      receiving={host.receiving}
      narrow={narrow}
      desk={typeof document !== "undefined" && document.documentElement.dataset.fit === "desk"}
      onClose={host.close}
      onOpenTitle={open}
    />
  );
}

export interface PlayOptions {
  startAt?: number;
  hint?: PlayHint;
}

interface BrowseProps {
  onPlay: (url: string, options?: PlayOptions) => void;
  onSignIn: () => void;
  onSettings: () => void;
  onConnect: () => void;
  onParty: () => void;
  onJoinParty: (code: string) => void;
  onStartTogether: (friend: string) => void;
  connected: boolean;
  partySize: number;
  notice?: string | null;
  quiet?: boolean;
}

const remembered = {
  library: null as Library | null,
  view: { kind: "home" } as View,
  list: DEFAULT_LIST as string,
  query: "",
  results: NO_ANSWERS as Answers,
  resultsFor: "",
  filter: "all" as SectionFilter,
  focus: {} as Record<string, Pos>,
  row: {} as Record<string, string>,
  tile: {} as Record<string, string>,
  detail: null as { page: Focused; season: number | undefined } | null,
  notice: null as { text: string; until: number | null } | null,
};

const NOTICE_MS = 8000;

export function keepPageFor(link: string | undefined) {
  dropLink();
  remembered.notice = null;
  const kept = remembered.detail;
  if (kept && (!link || titleLink(link) !== titleLink(kept.page.entry.url))) remembered.detail = null;
  if (!remembered.detail) showTitle(null);
}

const BANNER_DELAY_MS = 200;
const SEARCH_DELAY_MS = 350;
const SEARCH_RETRY_MS = 5000;
const ROWS_AHEAD = 3;
const TITLES_AHEAD = 6;
const GRID_COLUMNS = 8;
const CATEGORY_COLUMNS = 4;
const WIDE_COLUMNS = 5;
const RESULT_COLUMNS = 5;
const EPISODE_COLUMNS = 2;
const NARROW = "(max-width: 899px)";
const NARROW_TILE_PX = 190;
const NARROW_POSTER_PX = 132;
const POSTERS_THREE_FROM_PX = 360;
const FEATURE_FROM = 6;

function useNarrowColumns(posters: boolean): number {
  const read = () => {
    if (!matchMedia(NARROW).matches) return 0;
    if (isCompact()) return innerWidth >= POSTERS_THREE_FROM_PX ? 3 : 2;
    return Math.max(2, Math.floor(innerWidth / (posters ? NARROW_POSTER_PX : NARROW_TILE_PX)));
  };
  const [columns, setColumns] = useState(read);
  useEffect(() => {
    const update = () => setColumns(read());
    update();
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, [posters]);
  return columns;
}
function usePageWidth(): number {
  const read = () => pageWidth(innerWidth, innerHeight, document.documentElement.dataset.fit === "desk");
  const [width, setWidth] = useState(read);
  useEffect(() => {
    const update = () => setWidth(read());
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  return width;
}

interface Focused {
  entry: Entry;
  label: string;
  source?: string;
}

type PickOverlay = { kind: "pick"; entry: Entry; back: Target; fresh?: boolean };
type RateOverlayState = { kind: "rate"; entry: Entry; back: Target; isShow: boolean; seasons: number[]; shown: number | undefined; episodes: number | undefined };
type Overlay =
  | PickOverlay
  | RateOverlayState
  | { kind: "edit"; id: string | null; back: Target; from?: PickOverlay }
  | { kind: "recommend"; entry: Entry; back: Target }
  | { kind: "addFriend"; back: Target }
  | { kind: "friendSettings"; back: Target }
  | { kind: "news"; back: Target }
  | { kind: "unfriend"; id: string; name: string; back: Target }
  | { kind: "friendRequest"; person: Person; back: Target }
  | { kind: "plan"; id: string; back: Target }
  | { kind: "planPick"; friend: string; back: Target }
  | { kind: "chat"; friend: string; back: Target }
  | { kind: "bell"; back: Target };

const CONTENT: Target = { zone: "content", row: -1, col: -1 };
const RAIL: Target = { zone: "rail", row: -1, col: -1 };
const DETAIL: Target = { zone: "detail", row: 0, col: 0 };
const fresh = (target: Target): Target => (target ? { ...target } : target);
const CONTENT_ZONES: Zone[] = ["rows", "grid", "keys"];
const RESTORABLE: Zone[] = [...CONTENT_ZONES, "chips", "results", "foot", "hero"];

const find = (root: ParentNode, pos: Pos) => root.querySelector<HTMLElement>(`[data-zone="${pos.zone}"][data-row="${pos.row}"][data-col="${pos.col}"]`);
function posOf(element: Element | null): Pos | null {
  if (!(element instanceof HTMLElement) || !element.dataset.zone) return null;
  return { zone: element.dataset.zone as Zone, row: Number(element.dataset.row), col: Number(element.dataset.col) };
}

function underMiddle(root: ParentNode, from: Element | null, row: number, length: number): number | null {
  if (!(from instanceof HTMLElement) || length === 0) return null;
  const was = from.getBoundingClientRect();
  const first = find(root, { zone: "rows", row, col: 0 })?.getBoundingClientRect();
  if (!first || was.width === 0 || Math.abs(first.width - was.width) <= was.width / 6) return null;
  const middle = was.left + Math.min(was.width, first.width) / 2;
  let under: { col: number; far: number } | null = null;
  for (let col = 0; col < length; col++) {
    const box = find(root, { zone: "rows", row, col })?.getBoundingClientRect();
    if (!box) continue;
    const far = Math.max(box.left - middle, 0, middle - box.right);
    if (far < (under?.far ?? Infinity)) under = { col, far };
    else if (box.left > middle) break;
  }
  return under?.col ?? null;
}

const FRIEND_TABS = ["lists", "ratings"] as const;
const friendChip = (tab: FriendTab | undefined): number => 1 + Math.max(0, FRIEND_TABS.indexOf(tab ?? "lists"));

const SECTION_CHIPS = [
  { kind: "home", label: "tv.filterAll" },
  { kind: "movies", label: "tv.filterMovies" },
  { kind: "series", label: "tv.filterSeries" },
  { kind: "cartoons", label: "tv.filterCartoons" },
  { kind: "anime", label: "tv.filterAnime" },
] as const;
const sectionChip = (view: View, chips: ReadonlyArray<{ kind: string }> = SECTION_CHIPS): number => chips.findIndex((chip) => chip.kind === view.kind);

const FIRST_ROWS = 4;

function savedPos(view: View, rows: readonly HomeRow[]): Pos | undefined {
  const key = viewKey(view);
  const saved = remembered.focus[key];
  if (!saved) return undefined;
  if (!hasRows(view) || saved.zone !== "rows") return saved;
  const id = remembered.row[key];
  const row = rows.findIndex((candidate) => candidate.id === id);
  if (row === -1) return undefined;
  const entries = rows[row]!.entries;
  const at = entries.findIndex((entry) => entry.id === remembered.tile[key]);
  return { zone: "rows", row, col: at !== -1 ? at : id === "continue" ? 0 : Math.min(saved.col, Math.max(0, entries.length - 1)) };
}

const PAGE_ZONES: Zone[] = ["detail", "close", "seasons", "episodes", "related"];

function landOnPage(next: Target, from: Pos, root: ParentNode): Target {
  if (!next || next.row === -1 || next.zone === from.zone) return next;
  const pick = (selector: string) => root.querySelector<HTMLElement>(selector);
  if (next.zone === "seasons") {
    const shown = pick('[data-zone="seasons"][aria-checked="true"]');
    return shown ? { ...next, col: Number(shown.dataset.col) } : next;
  }
  if (next.zone === "episodes") {
    if (from.zone === "related") return next;
    const target = pick('[data-zone="episodes"][data-target="true"]');
    return target ? { ...next, row: Number(target.dataset.row), col: Number(target.dataset.col) } : next;
  }
  return next;
}

function keepInView(container: HTMLElement, element: HTMLElement, room = parseFloat(getComputedStyle(container).fontSize) * 1.5) {
  const box = container.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  if (at.top < box.top + room) container.scrollBy({ top: at.top - box.top - room, behavior: "smooth" });
  else if (at.bottom > box.bottom - room) container.scrollBy({ top: at.bottom - box.bottom + room, behavior: "smooth" });
}

function slideIntoView(button: HTMLElement) {
  const row = button.parentElement;
  if (!row) return;
  const room = parseFloat(getComputedStyle(row).fontSize) * 1.5;
  const box = row.getBoundingClientRect();
  const at = button.getBoundingClientRect();
  if (at.left < box.left + room) row.scrollBy({ left: at.left - box.left - room, behavior: "smooth" });
  else if (at.right > box.right - room) row.scrollBy({ left: at.right - box.right + room, behavior: "smooth" });
}

function slideAlong(element: HTMLElement) {
  const scroller = element.parentElement!;
  const edge = element.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const room = edge.width * 0.7;
  if (edge.left < box.left + room) scroller.scrollBy({ left: edge.left - box.left - room, behavior: "smooth" });
  else if (edge.right > box.right - room) scroller.scrollBy({ left: edge.right - box.right + room, behavior: "smooth" });
}

export function TvBrowse({ onPlay, onSignIn, onSettings, onConnect, onParty, onJoinParty, onStartTogether, connected, partySize, notice, quiet = false }: BrowseProps) {
  const t = useT();
  const language = useLanguage();
  const news = useNews();
  const { status: accountStatus, me, profile, say, withGoogle, childLock } = useAccount();
  const canConnectGoogle = useCanConnectGoogle();
  const friends = useFriends();
  const bell = useBell();
  const { progress, watched, lists, list, ratings, settings } = useProfileData();
  const holding = useProfileHold();
  const child = settings.child === true;
  const childRef = useRef(child);
  childRef.current = child;
  const wantedKey = (settings.sections ?? []).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wanted = useMemo(() => (child ? null : wantedSections(settings)), [child, wantedKey]);
  const sectionChips = useMemo(() => SECTION_CHIPS.filter((chip) => chip.kind === "home" || !wanted || wanted.has(sectionOfPage(chip.kind)!)), [wanted]);
  const sectionChipsRef = useRef(sectionChips);
  sectionChipsRef.current = sectionChips;
  const ratingsOn = ratingsShown(settings);
  const iGet = friendChoices(settings).friendsGet;
  const compact = useCompact();
  const flatHand = useFlatHand();
  const few = compact || flatHand;
  const sliding = few && thisTier() === "full";
  const narrowColumns = useNarrowColumns(true);
  const narrowCategoryColumns = useNarrowColumns(false);
  const narrow = narrowColumns > 0;
  const wide = usePageWidth();
  const resultColumns = narrowColumns || columnsFor(wide, RESULT_COLUMNS, PITCH_EM.poster);
  const [library, setLibrary] = useState<Library | null>(remembered.library);
  const [libraryStatus, setStatus] = useState<"loading" | "ready" | "failed">(remembered.library ? "ready" : "loading");
  const status = holding ? "loading" : libraryStatus;
  const [attempt, setAttempt] = useState(0);
  const [view, setViewState] = useState<View>(remembered.view);
  const [box, setBox] = useState<SearchBox>(() => ({ text: remembered.query, caret: remembered.query.length }));
  const query = box.text;
  const edit = (change: BoxEdit) => setBox((before) => editBox(before, change));
  const [results, setResults] = useState<Answers>(remembered.results);
  const [filter, setFilter] = useState<SectionFilter>(remembered.filter);
  const [searching, setSearching] = useState(false);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [searchTry, setSearchTry] = useState(0);
  const searchFailed = failedFor !== null && failedFor === query.trim();
  const [railOpen, setRailOpen] = useState(false);
  const [phone] = useState(thisIsPhone);
  const [focused, setFocused] = useState<Focused | null>(null);
  const act = useRef<TileActs>(null!);
  const tilesOfRows = useRef(new Map<string, { deps: unknown[]; tiles: ReactNode[] }>());
  const [detail, setDetail] = useState<Focused | null>(() => {
    const kept = remembered.detail;
    return kept && { ...kept.page, entry: resumable(asOpened(kept.page.entry), progress) };
  });
  useEffect(() => {
    remembered.detail = null;
  }, []);
  const series = useSeriesPage(detail?.entry, progress, watched, remembered.detail?.season);
  const about = useAbout(detail && !detail.entry.opens && detail.entry.url ? detail.entry.url : undefined);
  const aboutList = aboutRows(about)
    .map((row) => (child ? { ...row, items: row.items.filter((item) => forChildren(item)) } : row))
    .filter((row) => row.items.length > 0);
  const [deep, setDeep] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [pending, setPending] = useState<Target>(null);
  const bannerTimer = useRef<number>(0);
  const rootRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    libraryAnswer(attempt > 0 ? { cache: "reload" } : undefined)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: unknown) => {
        const parsed = LibrarySchema.parse(data);
        if (!live) return;
        remembered.library = parsed;
        feed.setBase(parsed.rows.filter((row) => row.items.length > 0));
        if (attempt > 0) remembered.resultsFor = "";
        setLibrary(parsed);
        setStatus("ready");
      })
      .catch(() => {
        if (live && !remembered.library) setStatus("failed");
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const feeding = useFeed();
  const rows = feeding.data.base;
  const hasTiles = status === "ready" && rows.length > 0;
  const pageSection = isRowsPage(view) ? (child ? "cartoon" : sectionOfPage(view.kind)) : undefined;
  const feedSection = pageSection ?? (isRowsPage(view) && wanted?.size === 1 ? [...wanted][0] : undefined);
  const pageLibraryRows = useMemo(() => pageRows(feeding.data, feedSection), [feeding.data, feedSection]);
  const keepLike = useMemo<((item: LibraryItem) => boolean) | undefined>(
    () => (pageSection ? (item) => sectionOf(item) === pageSection : wanted ? (item) => isWanted(wanted, item) : undefined),
    [pageSection, wanted],
  );
  const placesFor = useMemo(() => personalSlots(keepLike ? pageLibraryRows.filter((row) => (pageSection ? sectionOf(row) === pageSection : isWanted(wanted, row))).length : pageLibraryRows.length), [pageLibraryRows, keepLike, pageSection, wanted]);
  const personal = useLikes({ want: child ? 0 : placesFor, keep: keepLike, showing: isRowsPage(view), page: pageSection ?? "home" });
  const watching = useWatching(!child && !pageSection && isRowsPage(view));
  const growing = useMemo(() => new Set(pageLibraryRows.filter((row) => hasMoreTitles(feeding, row.id, row.items.length, ROW_CAP)).map((row) => row.id)), [pageLibraryRows, feeding]);
  const everyRow = useMemo(() => allRows(feeding.data), [feeding.data]);
  const looked = useCardSections(progress, everyRow, pageSection !== undefined && !child);
  const childEntries = useMemo(() => (child ? ownTitles(progress, list, ratings) : []), [child, progress, list, ratings]);
  const childGate = useChildGate(childEntries, everyRow, child);
  const shownRatings = useMemo(() => (childGate ? ratings.filter((rating) => childGate.allows({ id: rating.key, url: rating.url, kind: rating.kind })) : ratings), [childGate, ratings]);
  const shownProgress = useMemo(() => (childGate ? progress.filter((card) => childGate.allows({ id: card.key, url: card.url })) : progress), [childGate, progress]);
  const data = useMemo<PageData>(
    () => ({ rows: pageLibraryRows, all: everyRow, progress, lists, list, ratings: ratingsOn ? shownRatings : [], personal, looked, child: childGate, wanted, watching }),
    [pageLibraryRows, everyRow, progress, lists, list, shownRatings, ratingsOn, personal, looked, childGate, wanted, watching],
  );

  const rowsPage = hasRows(view);
  const friendId = view.kind === "friend" ? view.id : "";
  const friendTab: FriendTab = view.kind === "friend" ? (view.tab ?? "lists") : "lists";
  const friend = friends.state?.friends.find((each) => each.id === friendId);
  const chatChip = (friend && canAskTogether(friend) ? 3 : 1) + FRIEND_TABS.length;
  const sharedLists = useShared(friendId, Boolean(friendTab === "lists" && friend?.on && friend.lists), askLists, friend?.activity);
  const sharedRatings = useShared(friendId, Boolean(friendTab === "ratings" && friend?.on && friend.ratings), askRatings, friend?.activity);
  /* eslint-disable react-hooks/exhaustive-deps */
  const listedRows = useMemo<HomeRow[]>(() => {
    if (holding) return [];
    if (isRowsPage(view)) return rowsOfPage(view.kind, data);
    if (view.kind === "friends") return friendRows(friends.state, Date.now(), iGet);
    if (view.kind !== "profile") return [];
    const latest = { version: LATEST.version, day: dayOf(LATEST.date, language, true), fresh: news.fresh };
    return profileRows({ name: profile?.name ?? "", signedIn: Boolean(me && profile), ratingsOn, ratings: shownRatings, friendsOn: friends.on, friends: friends.state, unread: friends.attention, watched: shownProgress.length, progress: shownProgress, news: latest });
  }, [holding, view, data, language, friends.state, friends.on, friends.attention, me, profile, ratingsOn, shownRatings, shownProgress, iGet, news.fresh]);
  const featureRow = compact && isRowsPage(view) ? listedRows.find((row) => row.layout === "ranked") : undefined;
  const featured = featureRow?.entries.slice(0, FEATURE_FROM).find((entry) => entry.url && !entry.opens && (entry.image ?? entry.backdrop));
  const homeRows = useMemo(
    () => (featureRow && featured ? listedRows.flatMap((row) => (row !== featureRow ? [row] : row.entries.length > 1 ? [{ ...row, entries: row.entries.filter((entry) => entry !== featured) }] : [])) : listedRows),
    [listedRows, featureRow, featured],
  );
  const grid = useMemo(
    () => (holding ? null : (gridOf(view, data) ?? friendGrid(view, friends.state, sharedLists, sharedRatings, iGet, Date.now(), data))),
    [holding, view, data, language, friends.state, sharedLists, sharedRatings, iGet],
  );
  /* eslint-enable react-hooks/exhaustive-deps */
  const ratingSectionOf = useMemo(() => (view.kind === "ratings" ? ratingSectionIn(everyRow) : ownSection), [view.kind, everyRow]);
  const ratingFilter: RatingFilter = view.kind === "ratings" ? usableFilter(data.ratings, view, ratingSectionOf) : {};
  const ratingOptions = view.kind === "ratings" ? ratingChoices(data.ratings, ratingFilter, ratingSectionOf) : null;
  const ratingRows = ratingOptions ? filterRows(ratingOptions) : { sections: [], scores: [] };
  const scoreCount = (score: number | undefined) => (!ratingOptions ? 0 : score === undefined ? ratingOptions.scores.reduce((sum, each) => sum + each.count, 0) : (ratingOptions.scores.find((each) => each.score === score)?.count ?? 0));
  const [scoreOpen, setScoreOpen] = useState(false);
  const scorePicking = few && ratingRows.scores.length > 0;
  const scoreColumns = compact ? 2 : 5;
  useEffect(() => setScoreOpen(false), [view.kind, scorePicking, scoreColumns]);
  const scoreRows = ratingRows.scores.length === 0 ? [] : scorePicking ? [1, ...(scoreOpen ? scoreMenuRows(ratingRows.scores.length, scoreColumns) : [])] : [ratingRows.scores.length];
  const ratingChipRows = [...(ratingRows.sections.length > 0 ? [ratingRows.sections.length] : []), ...scoreRows];
  const scoreRow = ratingRows.sections.length > 0 ? 1 : 0;
  const posterGrid = !!grid && grid.layout !== "categories" && grid.entries.every(isTitle);
  const gridColumns =
    grid?.layout === "categories"
      ? compact
        ? 2
        : narrowCategoryColumns || columnsFor(wide, CATEGORY_COLUMNS, PITCH_EM.category)
      : posterGrid
        ? narrowColumns || columnsFor(wide, GRID_COLUMNS, PITCH_EM.poster)
        : narrowCategoryColumns || columnsFor(wide, WIDE_COLUMNS, PITCH_EM.wide);
  const episodeColumns = narrow || few ? 1 : columnsFor(wide, EPISODE_COLUMNS, PITCH_EM.episode);
  const sectionPlace = grid?.sections ? sectionPlaces(grid.sections, gridColumns) : undefined;
  const searchFilters: readonly SectionFilter[] = child ? ["cartoon"] : wanted ? SECTION_FILTERS.filter((filter) => filter === "all" || wanted.has(filter)) : SECTION_FILTERS;
  const shownAnswers = useMemo(
    () => (holding ? NO_ANSWERS : child ? onlyForChildren(onlySection(results, "cartoon")) : onlySection(results, filter)),
    [results, filter, child, holding],
  );
  const shownResults = shownAnswers.items;
  const resultRowsOf = (columns: number) => [...gridRows(shownAnswers.exact, columns), ...gridRows(shownResults.length - shownAnswers.exact, columns)];

  const homeFocus = rowsPage ? savedPos(view, homeRows) : undefined;
  const startRow = Math.min(homeFocus?.row ?? 0, Math.max(0, homeRows.length - 1));
  const startCol = Math.min(homeFocus?.col ?? 0, Math.max(0, (homeRows[startRow]?.entries.length ?? 1) - 1));
  const start = homeRows[startRow]?.entries[startCol];
  const rowsKey = viewKey(view);
  const [grownFor, setGrownFor] = useState<string | null>(null);
  const allRowsDrawn = grownFor === rowsKey || homeRows.length <= startRow + FIRST_ROWS;
  useEffect(() => {
    if (grownFor !== rowsKey) startTransition(() => setGrownFor(rowsKey));
  }, [rowsKey, grownFor]);
  const drawnRows = allRowsDrawn ? homeRows : homeRows.slice(0, startRow + FIRST_ROWS);
  const farFrom = Math.max(startRow, focused && rowsPage ? homeRows.findIndex((row) => row.title === focused.label) : -1) + FIRST_ROWS;
  const onNow = focused && rowsPage ? homeRows.find((row) => row.title === focused.label)?.entries.find((entry) => entry.id === focused.entry.id) : undefined;
  const shown: Focused | null = focused
    ? onNow
      ? { ...focused, entry: resumable(onNow, progress) }
      : focused
    : rowsPage && start
      ? { entry: start, label: homeRows[startRow]!.title, ...(homeRows[startRow]!.source ? { source: homeRows[startRow]!.source! } : {}) }
      : null;
  const actions = rowsPage ? heroActions(shown?.entry) : [];
  const featuredIn = featured ? homeRows.find((row) => row.layout !== "continue") : undefined;
  const saved = useMemo(() => savedKeys(list), [list]);
  const scores = useScores();
  const inList = (entry: Entry, id: string) => saved.has(listKey(entry.url, id));
  const isSaved = (entry: Entry) => lists.some((info) => inList(entry, info.id));
  const several = lists.length > 1;
  const tapOf = (entry: Entry) => listTap(lists, saved, entry.url);
  const canAdd = lists.length < MAX_LISTS;
  const shownId = shownList(view, lists).id;
  const listChips = several ? lists : [];
  const editedId = overlay?.kind === "edit" ? overlay.id : null;
  const editedAt = editedId ? lists.findIndex((info) => info.id === editedId) : -1;

  const choose = (next: View) => {
    dropLink();
    remembered.view = next;
    remembered.detail = null;
    setViewState(next);
    setFocused(null);
    setDetail(null);
    setDeep(false);
    setRailOpen(false);
    setPending(CONTENT);
    if (next.kind === "profile") rowsRef.current?.scrollTo({ top: 0 });
  };
  useEffect(() => {
    if (!child) return;
    const opened = detailRef.current;
    if (opened && !(forChildren(opened.entry) || childGate?.allows(opened.entry))) closeDetail();
    if ((isRowsPage(view) && view.kind !== "home") || view.kind === "friends" || view.kind === "friend") choose({ kind: "home" });
    setOverlay(null);
  }, [child]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wanted && isRowsPage(view) && view.kind !== "home" && !wanted.has(sectionOfPage(view.kind)!)) choose({ kind: "home" });
  }, [wanted, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectList = (id: string) => {
    const next: View = { kind: "list", list: id };
    remembered.list = id;
    remembered.view = next;
    setViewState(next);
  };
  const selectRatings = (filter: RatingFilter) => {
    const next: View = { kind: "ratings", ...(filter.section ? { section: filter.section } : {}), ...(filter.score !== undefined ? { score: filter.score } : {}) };
    remembered.view = next;
    setViewState(next);
  };
  const selectTab = (id: string, tab: FriendTab) => {
    const next: View = { kind: "friend", id, tab };
    remembered.view = next;
    setViewState(next);
  };
  const selectSection = (next: View) => {
    remembered.view = next;
    remembered.detail = null;
    setViewState(next);
    setFocused(null);
    setDeep(false);
    rowsRef.current?.scrollTo({ top: 0 });
  };
  const closeOverlay = () => {
    setPending(overlay?.back ?? CONTENT);
    setOverlay(null);
  };
  const leaveEdit = () => (overlay?.kind === "edit" && overlay.from ? setOverlay(overlay.from) : closeOverlay());
  const openDetail = (title: Focused) => {
    warmPlayer();
    dropLink();
    setDetail(title);
    setPending(DETAIL);
  };
  const closeDetail = () => {
    dropLink();
    remembered.detail = null;
    setDetail(null);
    setPending(CONTENT);
  };
  const [linked] = useState(() => pendingLink());  const linkPending = () => linked !== null && pendingLink() !== null;
  const [ownNotice, setOwnNoticeState] = useState<string | null>(() => {
    if (takeStrayAddress()) remembered.notice = { text: t("notice.noSuchPage"), until: null };
    const kept = remembered.notice;
    return kept && (kept.until === null || kept.until > Date.now()) ? kept.text : null;
  });
  const setOwnNotice = (text: string | null) => {
    remembered.notice = text ? { text, until: null } : null;
    setOwnNoticeState(text);
  };
  useEffect(() => {
    const kept = remembered.notice;
    if (!ownNotice || !kept || quiet) return;
    kept.until ??= Date.now() + NOTICE_MS;
    const timer = setTimeout(() => setOwnNotice(null), Math.max(0, kept.until - Date.now()));
    return () => clearTimeout(timer);
  }, [ownNotice, quiet]);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  useEffect(() => {
    if (!linked || holding) return;
    let live = true;
    void linked.item.then((item) => {
      if (!live) return;
      const wanted = pendingLink() !== null;
      dropLink();
      if (detailRef.current) return;
      const mayOpen = item && (!childRef.current || forChildren(item));
      if (wanted && mayOpen) return openDetail({ entry: openedAt(entryOfItem(item), linked.extras), label: t(item.kind === "series" ? "tv.series" : "tv.movies") });
      showTitle(null);
      if (wanted) setOwnNotice(t(item ? "notice.notForChild" : "notice.noSuchTitle"));
    });
    return () => {
      live = false;
    };
  }, [linked, holding]);

  const closeBesideIt = (event: MouseEvent) => {
    if (event.target === event.currentTarget && !handHeld()) closeDetail();
  };
  const withBrowserBack = browserBack();
  useBackWhile(withBrowserBack && view.kind !== "home", () => choose(backOf(view) ?? { kind: "home" }));
  useBackWhile(withBrowserBack && detail !== null, closeDetail);
  const openAddress = detail && !detail.entry.opens ? addressOf(detail.entry) : null;
  useEffect(() => {
    if (!linkPending() || openAddress) showTitle(openAddress);
  }, [openAddress]);

  const partyPlace: RailEntry = { id: "party", label: t("party.rail"), icon: <UsersIcon />, ...(partySize > 1 ? { badge: String(partySize) } : {}), testId: "rail-party", onPress: onParty };
  const phonePlace: RailEntry = phone
    ? { id: "connect", label: t("tv.useRemote"), icon: <PhoneIcon />, testId: "rail-connect", onPress: () => switchRole("remote") }
    : { id: "connect", label: t(connected ? "tv.phoneConnected" : "tv.connectPhone"), icon: <PhoneIcon />, ...(connected ? { lit: true } : {}), testId: "rail-connect", onPress: onConnect };
  const homeLine: RailEntry = { id: "home", label: t("tv.home"), icon: <HomeIcon />, current: few ? isRowsPage(view) : view.kind === "home", testId: "rail-home", onPress: () => choose({ kind: "home" }) };
  const searchLine: RailEntry = { id: "search", label: t("tv.search"), icon: <SearchIcon />, current: view.kind === "search", testId: "rail-search", onPress: () => choose({ kind: "search" }) };
  const categoriesLine: RailEntry = { id: "categories", label: t("tv.categories"), icon: <GridIcon />, current: view.kind === "categories" || view.kind === "category", testId: "rail-categories", onPress: () => choose({ kind: "categories" }) };
  const listLine: RailEntry = { id: "list", label: t("rows.myList"), icon: <ListIcon />, current: view.kind === "list", testId: "rail-list", onPress: () => choose({ kind: "list", list: remembered.list }) };
  const entries: RailEntry[] = few
    ? [homeLine, searchLine, categoriesLine, listLine]
    : child
      ? [searchLine, homeLine, categoriesLine, listLine, { ...phonePlace, apart: true }]
      : [
          searchLine,
          homeLine,
          ...(
            [
              { id: "movies", label: t("tv.movies"), icon: <FilmIcon />, current: view.kind === "movies", testId: "rail-movies", onPress: () => choose({ kind: "movies" }) },
              { id: "series", label: t("tv.series"), icon: <TvIcon />, current: view.kind === "series", testId: "rail-series", onPress: () => choose({ kind: "series" }) },
              { id: "cartoons", label: t("tv.cartoons"), icon: <CartoonIcon />, current: view.kind === "cartoons", testId: "rail-cartoons", onPress: () => choose({ kind: "cartoons" }) },
              { id: "anime", label: t("tv.anime"), icon: <AnimeIcon />, current: view.kind === "anime", testId: "rail-anime", onPress: () => choose({ kind: "anime" }) },
            ] satisfies RailEntry[]
          ).filter((line) => !wanted || wanted.has(sectionOfPage(line.id as RowsPage)!)),
          categoriesLine,
          listLine,
          { ...partyPlace, apart: true },
          phonePlace,
        ];
  const openEntry = entries.findIndex((entry) => entry.current);
  const railIndex = openEntry === -1 ? entries.indexOf(homeLine) : openEntry;

  const canSignIn = accountStatus === "ready";
  const showAccount = accountStatus !== "loading";
  const showBell = canSignIn && bell.on;
  const wayBack = view.kind !== "friend" && isProfilePage(view) ? backOf(view) : null;
  const lead = wayBack ? 1 : 0;
  const topButtons = lead + (showBell ? 1 : 0) + (showAccount ? 1 : 0) + (canFullscreen() ? 1 : 0);
  const signedIn = Boolean(me && profile);
  const places = few ? (child ? [phonePlace] : [partyPlace, phonePlace]) : [];
  const connectGoogle = canConnectGoogle && signedIn && !childLock.locked ? () => withGoogle("link") : undefined;
  const myTag = signedIn && friends.on && profile?.tag !== undefined ? tagLabel(profile.name, profile.tag) : undefined;
  const profileButtons = view.kind === "profile" ? (signedIn || !canSignIn ? 2 : 3) + places.length + (connectGoogle ? 1 : 0) + (myTag ? 1 : 0) : 0;
  const sectionButtons = few && isRowsPage(view) && !child;
  const showRetry = rowsPage && homeRows.length === 0 && status !== "loading";
  const sectionPage = pageSection !== undefined;
  const sectionWaiting = showRetry && hasTiles && sectionPage && hasMoreShelves(feeding, pageSection);
  const kindEmpty = showRetry && hasTiles && sectionPage && !sectionWaiting;
  const shape: Shape = {
    rail: compact ? [entries.length] : entries.map(() => 1),
    top: topButtons > 0 ? [topButtons] : [],
    ...(rowsPage ? { hero: profileButtons > 0 ? [profileButtons] : !compact && !deep && actions.length > 0 ? [actions.length] : [], rows: showRetry ? [1] : homeRows.map((row) => row.entries.length) } : {}),
    ...(sectionButtons ? { chips: [sectionChips.length] } : {}),
    ...(grid ? { grid: grid.sections ? sectionRows(grid.sections, gridColumns) : gridRows(grid.entries.length, gridColumns) } : {}),
    ...(view.kind === "search" ? { ...(narrow ? {} : { keys: KEYBOARD_SHAPE }), chips: [searchFilters.length], results: resultRowsOf(resultColumns) } : {}),
    ...(view.kind === "list" ? { chips: [lists.length + (canAdd ? 2 : 1)] } : {}),
    ...(view.kind === "ratings" && ratingChipRows.length > 0 ? { chips: ratingChipRows } : {}),
    ...(view.kind === "friend" && friend ? { chips: [canAskTogether(friend) ? 6 : 4], foot: [1] } : {}),
    ...(detail
      ? {
          close: [1],
          detail: [overviewActions(detail.entry, ratingsOn, friends.on, handHeld(), several).length],
          ...(series.seasons.length > 1 ? { seasons: [series.seasons.length] } : {}),
          ...(series.shown?.length ? { episodes: episodeRows(series, episodeColumns) } : {}),
          ...(aboutList.length > 0 ? { related: aboutList.map((row) => row.items.length) } : {}),
        }
      : {}),
  };
  const latest = useRef({ shape, view, query, box, railIndex, homeRows, detail, overlay, lists, signedIn, feedSection, growing, compact, few });
  latest.current = { shape, view, query, box, railIndex, homeRows, detail, overlay, lists, signedIn, feedSection, growing, compact, few };

  const resolve = (target: Target, leaving?: Zone): Pos | null => {
    const root = rootRef.current;
    if (!target || !root) return null;
    if (target.row !== -1) return target as Pos;
    if (target.zone === "rail") return latest.current.compact ? { zone: "rail", row: 0, col: latest.current.railIndex } : { zone: "rail", row: latest.current.railIndex, col: 0 };
    const at = savedPos(latest.current.view, latest.current.homeRows);
    if (at && at.zone !== leaving && RESTORABLE.includes(at.zone) && find(root, at)) return at;
    const page = latest.current.view;
    const zones: Zone[] =
      page.kind === "list" || page.kind === "friend" || (latest.current.few && isRowsPage(page))
        ? [...CONTENT_ZONES, "chips"]
        : page.kind === "profile" && !latest.current.signedIn
          ? ["hero", ...CONTENT_ZONES]
          : CONTENT_ZONES;
    const start = (zone: Zone): Pos => ({ zone, row: 0, col: zone === "chips" ? (page.kind === "friend" ? friendChip(page.tab) : Math.max(0, sectionChip(page, sectionChipsRef.current))) : 0 });
    return zones.filter((zone) => zone !== leaving).map(start).find((pos) => find(root, pos)) ?? null;
  };
  const focusAt = (target: Target, leaving?: Zone) => {
    const pos = resolve(target, leaving);
    if (pos && rootRef.current) find(rootRef.current, pos)?.focus({ preventScroll: true });
  };
  const go = (target: Target, leaving?: Zone) => {
    if (target && target.zone === "rail" && !latest.current.compact) {
      setRailOpen(true);
      setPending(target);
    } else focusAt(target, leaving);
  };

  useEffect(() => {
    if (!pending) return;
    setPending(null);
    focusAt(pending);
  }, [pending]);

  const openId = detail?.entry.id;
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>(".tv-detail-scroll")?.scrollTo({ top: 0 });
  }, [openId]);

  const standingOn = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const gone = standingOn.current;
    if (!gone || gone.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
    standingOn.current = null;
    setPending(fresh(latest.current.detail ? DETAIL : CONTENT));
  }, [homeRows, grid]);

  const hadTiles = useRef(hasTiles);
  useEffect(() => {
    const at = posOf(document.activeElement);
    const came = hasTiles && !hadTiles.current;
    hadTiles.current = hasTiles;
    const waited = came && at?.zone === "chips" && latest.current.few && isRowsPage(latest.current.view);
    if (waited) delete remembered.focus[viewKey(latest.current.view)];
    if (!at || at.zone === "top" || waited) setPending(fresh(latest.current.detail ? DETAIL : CONTENT));
  }, [hasTiles, status, view.kind, library]);

  useEffect(() => {
    if (status !== "ready") return;
    if (allRowsDrawn && isRowsPage(view) && nearBottom(rowsRef.current)) feed.loadShelves(feedSection);
    if (view.kind === "category" && nearBottom(gridRef.current)) feed.loadMore(view.rowId, GRID_CAP);
  }, [feeding, status, view, feedSection, homeRows.length, grid?.entries.length, allRowsDrawn]);
  const askShelves = () => {
    if (status === "ready" && allRowsDrawn && isRowsPage(view) && nearBottom(rowsRef.current)) feed.loadShelves(feedSection);
    const to = heading.current;
    if (to && rowsRef.current) {
      const left = Math.abs(rowsRef.current.scrollTop - to.top);
      if (left <= 1 || left > to.left + 1 || performance.now() > to.until) heading.current = null;
      else to.left = left;
    }
    noteAnchor();
  };
  const anchor = useRef<{ page: string; id: string; gap: number } | null>(null);
  const heading = useRef<{ box: HTMLElement; top: number; left: number; until: number } | null>(null);
  const rowBoxes = () => (rowsRef.current ? (Array.from(rowsRef.current.children) as HTMLElement[]).filter((each) => each.classList.contains("tv-row")) : []);
  const noteAnchor = () => {
    const top = rowsRef.current?.scrollTop ?? 0;
    const box = top < 2 ? undefined : rowBoxes().find((each) => each.offsetTop + each.offsetHeight > top + 1);
    anchor.current = box ? { page: viewKey(latest.current.view), id: box.dataset.rowId ?? "", gap: box.offsetTop - top } : null;
  };
  const drawnIds = drawnRows.map((row) => row.id).join("\n");
  useLayoutEffect(() => {
    const rows = rowsRef.current;
    const was = anchor.current;
    const box = was && was.page === rowsKey ? rowBoxes().find((each) => each.dataset.rowId === was.id) : undefined;
    let putBack = false;
    if (rows && was && box) {
      const moved = box.offsetTop - rows.scrollTop - was.gap;
      if (Math.abs(moved) > 1) {
        rows.scrollTop += moved;
        putBack = true;
      }
    }
    const to = heading.current;
    if (rows && to && to.box.isConnected && performance.now() < to.until) {
      const top = to.box.offsetTop;
      if (Math.abs(top - to.top) > 1 || putBack) {
        heading.current = { ...to, top, left: Math.abs(rows.scrollTop - top) };
        rows.scrollTo({ top, behavior: "smooth" });
      }
    } else heading.current = null;
    noteAnchor();
  }, [drawnIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const askTitles = () => {
    if (status === "ready" && view.kind === "category" && nearBottom(gridRef.current)) feed.loadMore(view.rowId, GRID_CAP);
  };

  useEffect(() => {
    if (notice) setAttempt((n) => n + 1);
  }, [notice]);

  useEffect(() => {
    if (view.kind === "category" && status === "ready" && !grid) choose({ kind: "home" });
    else if (view.kind === "ratings" && !ratingsOn) choose({ kind: "profile" });
  }, [view, status, grid, ratingsOn]);

  useEffect(() => {
    if ((view.kind === "friends" || view.kind === "friend") && !friends.on) choose({ kind: "profile" });
    else if (view.kind === "friend" && friends.state && !friend) choose({ kind: "friends" });
  }, [view.kind, friends.on, friends.state, friend]);
  useEffect(() => {
    if (overlay?.kind === "unfriend" && friends.state && !friends.state.friends.some((each) => each.id === overlay.id)) setOverlay(null);
    if (overlay?.kind === "friendRequest" && friends.state && !friends.state.requests.some((each) => each.from.id === overlay.person.id)) closeOverlay();
    if (overlay?.kind === "planPick" && friends.state && !friends.state.friends.some((each) => each.id === overlay.friend)) closeOverlay();
    if (overlay?.kind === "bell" && !bell.on) closeOverlay();
  }, [overlay, friends.state, bell.on]);
  useEffect(() => {
    if (view.kind === "friends") void friends.refresh();
  }, [view.kind]);
  useEffect(() => {
    if (view.kind === "friends" && friends.unread > 0) void friends.markRead().catch(() => undefined);
  }, [view.kind, friends.unread]);
  useEffect(() => () => window.clearTimeout(bannerTimer.current), []);

  useEffect(() => {
    remembered.query = query;
    remembered.results = results;
    remembered.filter = filter;
  }, [query, results, filter]);

  useEffect(() => {
    if (view.kind !== "search") return;
    const text = query.trim();
    if (text === remembered.resultsFor) return setSearching(false);
    if (!text) {
      remembered.resultsFor = "";
      setResults(NO_ANSWERS);
      return setSearching(false);
    }
    const local = matchLocal(feed.index, rows, text);
    setResults((before) => (text.length < 2 ? local : mergeAnswers(local, keepMatching(before, text), text)));
    if (text.length < 2) {
      remembered.resultsFor = text;
      return setSearching(false);
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      Promise.resolve()
        .then(() => fetch(`/api/library/search?q=${encodeURIComponent(text)}`, { signal: controller.signal }))
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`search answered ${res.status}`))))
        .then((answer: unknown) => {
          const parsed = LibraryItemsSchema.parse(answer);
          feed.learn(parsed.items);
          const merged = mergeAnswers(local, { items: parsed.items, exact: parsed.exact ?? parsed.items.length }, text);
          setResults(merged);
          remembered.results = merged;
          remembered.resultsFor = text;
          setFailedFor(null);
          setSearching(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setFailedFor(text);
          setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, view.kind, rows, searchTry]);

  useEffect(() => {
    if (failedFor === null || view.kind !== "search") return;
    const timer = window.setTimeout(() => setSearchTry((n) => n + 1), SEARCH_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [failedFor, searchTry, view.kind]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const { shape: now, view: page, query: text, detail: open, overlay: over, lists: all } = latest.current;
      if (over) return;

      const boxKeys = page.kind === "search" && !open && !(event.target instanceof HTMLInputElement);
      if (boxKeys && (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        edit({ kind: "selectAll" });
        return;
      }
      const typed = boxKeys ? typedCharacter(event) : null;
      if (typed !== null) {
        event.preventDefault();
        edit({ kind: "type", char: typed });
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const extendTo = !boxKeys || !event.shiftKey ? null : event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : event.key === "Home" ? "start" : event.key === "End" ? "end" : null;
      if (extendTo) {
        event.preventDefault();
        edit({ kind: "move", to: extendTo, extend: true });
        return;
      }
      const caretKey: BoxEdit | null = !boxKeys ? null : event.key === "Delete" ? { kind: "delete" } : event.key === "Home" ? { kind: "move", to: "start" } : event.key === "End" ? { kind: "move", to: "end" } : null;
      if (caretKey) {
        event.preventDefault();
        edit(caretKey);
        return;
      }

      const action = actionForKey(event);
      if (action === "back") {
        event.preventDefault();
        if (open) return closeDetail();
        if (event.key === "Backspace" && page.kind === "search") {
          if (text) return edit({ kind: "backspace" });
          if (event.repeat) return;
          if (document.documentElement.dataset.fit === "desk") return;
        }
        const back = backOf(page);
        if (posOf(document.activeElement)?.zone === "rail" && resolve(CONTENT)) go(CONTENT);
        else if (back) choose(back);
        else go(RAIL);
        return;
      }
      if (action !== "up" && action !== "down" && action !== "left" && action !== "right") return;
      if (event.target instanceof HTMLInputElement && (action === "left" || action === "right")) return;
      event.preventDefault();

      const at = posOf(document.activeElement);
      if (open) return go(at && PAGE_ZONES.includes(at.zone) ? landOnPage(stepFrom(now, at, action), at, root) : DETAIL);
      if (!at) {
        if (resolve(CONTENT)) return focusAt(CONTENT);
        return go(action === "left" ? RAIL : action === "up" && now.top?.length ? { zone: "top", row: 0, col: 0 } : null);
      }
      const next = stepFrom(now, at, action);
      if (isRowsPage(page) && at.zone === "rows" && next?.zone === "rows" && next.row !== at.row) {
        const col = underMiddle(root, document.activeElement, next.row, now.rows?.[next.row] ?? 0);
        if (col !== null) return go({ ...next, col }, at.zone);
      }
      if (page.kind === "profile" && at.zone === "hero" && action === "down" && next?.row === -1) {
        const from = (event.target as HTMLElement).getBoundingClientRect();
        const middle = from.left + from.width / 2;
        const zone = CONTENT_ZONES.find((one) => (now[one]?.length ?? 0) > 0);
        let under: { col: number; far: number } | null = null;
        for (let col = 0; zone && col < (now[zone]?.[0] ?? 0); col++) {
          const box = find(root, { zone, row: 0, col })?.getBoundingClientRect();
          const far = box ? Math.max(box.left - middle, 0, middle - box.right) : Infinity;
          if (far < (under?.far ?? Infinity)) under = { col, far };
        }
        if (zone && under) return go({ zone, row: 0, col: under.col }, at.zone);
      }
      const shownChip = page.kind === "friend" ? friendChip(page.tab) : Math.max(0, all.findIndex((info) => info.id === shownList(page, all).id));
      const section = sectionChip(page, sectionChipsRef.current);
      const chip = at.zone === "grid" ? shownChip : section !== -1 && (at.zone === "rows" || at.zone === "top") ? section : null;
      go(next?.zone === "chips" && chip !== null ? { ...next, col: chip } : next, at.zone);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const inBox = (event: ClipboardEvent) => {
      const { view: page, detail: open, overlay: over } = latest.current;
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      return page.kind === "search" && !open && !over && !field;
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = inBox(event) ? event.clipboardData?.getData("text/plain") : "";
      if (!text) return;
      event.preventDefault();
      edit({ kind: "paste", text });
    };
    const onCopy = (event: ClipboardEvent) => {
      const { box: now } = latest.current;
      const part = selectedText(now);
      const text = part || now.text;
      if (!inBox(event) || !text || !event.clipboardData || window.getSelection()?.toString()) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
      if (event.type === "cut") edit(part ? { kind: "backspace" } : { kind: "clear" });
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCopy);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCopy);
    };
  }, []);

  const arrived = (element: HTMLElement, pos: Pos, now: Focused) => {
    if (pos.zone === "related") return slideAlong(element);
    const key = viewKey(latest.current.view);
    remembered.focus[key] = pos;
    standingOn.current = element;
    if (pos.zone === "rows") {
      remembered.row[key] = latest.current.homeRows[pos.row]?.id ?? "";
      remembered.tile[key] = latest.current.homeRows[pos.row]?.entries[pos.col]?.id ?? "";
      setDeep(pos.row > 0);
      slideAlong(element);
      const scroller = element.parentElement!;
      const rowBox = scroller.closest<HTMLElement>(".tv-row")!;
      const rows = rowsRef.current;
      if (rows && latest.current.compact && rowBox.offsetHeight > rows.clientHeight) keepInView(rows, element);
      else if (rows) {
        const top = rowBox.offsetTop;
        const left = Math.abs(rows.scrollTop - top);
        heading.current = left > 1 ? { box: rowBox, top, left, until: performance.now() + 1500 } : null;
        rows.scrollTo({ top, behavior: "smooth" });
      }
      const { homeRows: laid, view: page, feedSection: section, growing: more } = latest.current;
      const row = laid[pos.row];
      if (row?.layout === "continue") warmPlayer();
      if (status === "ready" && isRowsPage(page) && pos.row >= laid.length - ROWS_AHEAD) feed.loadShelves(section);
      if (row && row.layout === "wide" && more.has(row.id) && pos.col >= row.entries.length - TITLES_AHEAD) feed.loadMore(row.id, ROW_CAP);
    } else {
      const container = element.closest<HTMLElement>(".tv-grid");
      if (container) keepInView(container, element);
      const { view: page, shape: laid } = latest.current;
      if (page.kind === "category" && pos.zone === "grid" && pos.row >= (laid.grid?.length ?? 0) - ROWS_AHEAD) feed.loadMore(page.rowId, GRID_CAP);
    }

    window.clearTimeout(bannerTimer.current);
    if (!focused) setFocused(now);
    else bannerTimer.current = window.setTimeout(() => setFocused(now), BANNER_DELAY_MS);
  };

  const retry = () => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  };
  const playEntry = (entry: Entry, at?: Pick<Start, "url" | "startAt">) => {
    dropLink();
    remembered.notice = null;
    remembered.detail = detail && series.isShow ? { page: detail, season: series.season } : null;
    const startAt = at ? at.startAt : entry.startAt;
    onPlay(new URL(at?.url ?? entry.resumeUrl ?? entry.url, location.href).href, { hint: hintOf(entry), ...(startAt ? { startAt } : {}) });
  };
  const playEntryOnTv = (entry: Entry, at?: Pick<Start, "url" | "startAt">) => {
    const startAt = at ? at.startAt : entry.startAt;
    playOnTv(new URL(at?.url ?? entry.resumeUrl ?? entry.url, location.href).href, startAt);
  };
  const askToWatch = async (friendId: string, ended?: string) => {
    const name = nameOf(friends.state?.friends ?? [], friendId);
    try {
      const answer = await friends.send([friendId], { kind: "together" });
      say(answer.sent.length > 0 ? t("friends.askSent", { name }) : t("friends.declined", { names: name }));
      if (answer.sent.length > 0 && ended) {
        await friends.dismiss(ended);
        setFocused(null);
        go(CONTENT);
      }
    } catch (error) {
      say(describeError(error));
    }
  };

  const press = (title: Focused, from: Target) => {
    const { entry } = title;
    if (entry.action) return setOverlay({ kind: entry.action, back: from });
    if (entry.request) return setOverlay({ kind: "friendRequest", person: entry.request, back: from });
    if (entry.plan) return setOverlay({ kind: "plan", id: entry.plan, back: from });
    if (entry.chat) return setOverlay({ kind: "chat", friend: entry.chat, back: from });
    if (entry.party) return onJoinParty(entry.party);
    if (entry.wants) return onStartTogether(entry.wants);
    if (entry.ask) return void askToWatch(entry.ask, entry.inboxId);
    if (!entry.opens) return openDetail(title);
    return choose(entry.opens.kind === "category" && view.kind === "categories" ? { ...entry.opens, from: "categories" } : entry.opens);
  };

  const cornerOf = (entry: Entry, listId: string | undefined): Corner | undefined => {
    if (entry.opens || !entry.url) return undefined;
    const sent = entry.inboxId;
    if (sent) {
      return {
        kind: "clear",
        label: t("friends.dismiss"),
        run: () => {
          void friends.dismiss(sent).catch(() => undefined);
          if (shown?.entry.inboxId === sent) setFocused(null);
        },
      };
    }
    const key = entry.progressKey;
    if (key) {
      return {
        kind: "clear",
        label: t("rows.remove"),
        run: () => {
          profileStore.removeProgress(key);
          if (shown?.entry.progressKey === key) setFocused(null);
        },
      };
    }
    const info = lists.find((each) => each.id === listId) ?? lists[0]!;
    const kept = inList(entry, info.id);
    return { kind: kept ? "kept" : "add", label: t(kept ? "rows.removeFromList" : "library.addToList", { list: listName(info) }), run: () => profileStore.setInList(listEntryOf(entry), !kept, info.id) };
  };

  act.current = { arrived, press, cornerOf };
  const tile = (entry: Entry, pos: Pos, label: string, layout: Layout, source?: string, listId?: string, shape?: HomeRow["shape"]) => {
    const score = view.kind !== "ratings" && view.kind !== "friend" ? scoreOf(scores, entry.url) : undefined;
    const corner = cornerOf(entry, listId);
    return <Tile key={`${pos.zone}-${entry.id}`} entry={entry} resumed={resumable(entry, progress)} label={label} source={source} listId={listId} layout={layout} landscape={shape === "landscape"} compact={compact} rank={pos.col + 1} pos={pos} corner={corner && { kind: corner.kind, label: corner.label }} score={score} act={act} />;
  };
  useEffect(() => {
    const shown = new Set(homeRows.map((row) => row.id));
    for (const id of tilesOfRows.current.keys()) if (!shown.has(id)) tilesOfRows.current.delete(id);
  }, [homeRows]);
  const rowTiles = (row: HomeRow, r: number) => {
    const deps = [row, r, compact, progress, scores, saved, lists, view.kind, t];
    const kept = tilesOfRows.current.get(row.id);
    if (kept && kept.deps.every((dep, at) => dep === deps[at])) return kept.tiles;
    const tiles = row.entries.map((entry, c) => tile(entry, { zone: "rows", row: r, col: c }, row.title, row.layout, row.source, listOfRow(row.id), row.shape));
    tilesOfRows.current.set(row.id, { deps, tiles });
    return tiles;
  };

  const playEpisode = (episode: PageEpisode) => detail && playEntry(detail.entry, episode);
  const scrollPage = (event: FocusEvent<HTMLElement>) => {
    const target = event.target;
    if (!target.matches(":focus-visible")) return;
    if (target.closest(".tv-detail-hero")) event.currentTarget.scrollTo({ top: 0, behavior: "smooth" });
    else keepInView(event.currentTarget, target, event.currentTarget.clientHeight * 0.22);
  };

  const doAction = (action: HeroAction, entry: Entry | undefined = shown?.entry, from: Target = CONTENT, at?: Start) => {
    if (!entry) return;
    if (action === "play") playEntry(entry, at);
    else if (action === "tv") playEntryOnTv(entry, at);
    else if (action === "rate") setOverlay({ kind: "rate", entry, back: from, isShow: series.isShow, seasons: series.seasons, shown: series.season, episodes: series.count ?? undefined });
    else if (action === "recommend") setOverlay({ kind: "recommend", entry, back: from });
    else if (action === "join") {
      if (entry.party) onJoinParty(entry.party);
    } else if (action === "start") {
      if (entry.wants) onStartTogether(entry.wants);
    } else if (action === "ask") {
      if (entry.ask) void askToWatch(entry.ask, entry.inboxId);
    } else if (action === "dismiss") {
      if (!entry.inboxId) return;
      void friends.dismiss(entry.inboxId).catch(() => undefined);
      setFocused(null);
      if (detail) closeDetail();
      else go(CONTENT);
    } else if (action === "list") {
      const tap = tapOf(entry);
      if (tap === "pick") setOverlay({ kind: "pick", entry, back: from });
      else profileStore.setInList(listEntryOf(entry), tap === "add", DEFAULT_LIST);
    } else if (action === "lists") {
      setOverlay({ kind: "pick", entry, back: from });
    } else if (entry.progressKey) {
      profileStore.removeProgress(entry.progressKey);
      setFocused(null);
      if (detail) {
        const { progressKey: _gone, ...rest } = asOpened(entry);
        setDetail({ ...detail, entry: rest });
        setPending(fresh(DETAIL));
      } else go(CONTENT);
    }
  };

  const labelOf = (action: HeroAction, entry: Entry, spelled: boolean): ReactNode => {
    if (action === "play") {
      return (
        <>
          <PlayIcon /> {playLabel(entry, spelled ? series.said : undefined)}
        </>
      );
    }
    if (action === "tv") {
      return (
        <>
          <TvIcon /> {t("tv.playOnTv")}
        </>
      );
    }
    if (action === "remove") {
      return (
        <>
          <CloseIcon /> {t("rows.remove")}
        </>
      );
    }
    if (action === "rate") {
      const given = ratingFor(ratings, entry.url);
      return (
        <>
          <StarIcon filled={given !== undefined} /> {given ? `${given.score}/10` : t("rating.rate")}
        </>
      );
    }
    if (action === "recommend") {
      return (
        <>
          <UsersIcon /> {t("friends.recommend")}
        </>
      );
    }
    if (action === "dismiss") {
      return (
        <>
          <CloseIcon /> {t("friends.dismiss")}
        </>
      );
    }
    if (action === "join") {
      return (
        <>
          <PlayIcon /> {t("friends.join")}
        </>
      );
    }
    if (action === "ask" || action === "start") {
      return (
        <>
          <UsersIcon /> {t(action === "ask" ? "friends.askTogether" : "friends.startParty")}
        </>
      );
    }
    if (action === "lists") {
      return (
        <>
          <ListIcon /> {t("rows.otherLists")}
        </>
      );
    }
    const tap = tapOf(entry);
    const text = spelled && !several ? listSpelled(entry) : tap === "pick" ? t("rows.myList") : listName(lists[0]!);
    return (
      <>
        {tap === "add" ? <PlusIcon /> : <CheckIcon />} {text}
      </>
    );
  };
  const listSpelled = (entry: Entry): string => {
    const tap = tapOf(entry);
    return tap === "pick" ? t("rows.inLists") : t(tap === "remove" ? "rows.removeFromList" : "library.addToList", { list: listName(lists[0]!) });
  };

  const kindWord = (entry: Entry): string | undefined =>
    entry.opens ? undefined : entry.kind === "movie" ? t("library.kindMovie") : entry.kind === "series" ? t("library.kindSeries") : undefined;

  const detailArt = detail ? (detail.entry.backdrop ?? detail.entry.image) : undefined;
  const stage = isRowsPage(view) && !compact;
  const billboard = stage && !deep && !detail && Boolean(shown && isTitle(shown.entry) && shown.entry.backdrop);
  const heroPoster = !compact && !billboard && shown && isTitle(shown.entry) ? sharper(shown.entry.image) : undefined;
  const peopleRow = view.kind === "friends" ? homeRows.find((row) => row.id === "friend-people") : undefined;
  const friendsHead = view.kind === "friends" && !compact && (!shown || (peopleRow?.entries.some((entry) => entry.id === shown.entry.id) ?? false));
  const wordmarkHome = () => {
    if (detail) closeDetail();
    choose({ kind: "home" });
    rowsRef.current?.scrollTo({ top: 0 });
  };
  const headInRows = compact && view.kind === "profile" && drawnRows.length > 0;
  const profileHead =
    view.kind === "profile" ? (
      <ProfileHead
        name={signedIn && profile ? profile.name : t("profile.guest")}
        avatar={signedIn ? profile?.avatar : undefined}
        line={me ? signedInLine(me) : canSignIn ? t("auth.pitchDetail") : ""}
        signedIn={signedIn}
        canSignIn={canSignIn}
        onSignIn={onSignIn}
        onSettings={onSettings}
        onArrive={(col, button) => {
          remembered.focus[viewKey(view)] = { zone: "hero", row: 0, col };
          if (headInRows && rowsRef.current) keepInView(rowsRef.current, button);
        }}
        places={places}
        onConnectGoogle={connectGoogle}
        tag={myTag}
      />
    ) : null;
  const headInGrid = compact && grid !== null && grid.entries.length > 0;
  const viewHead = grid ? (
    <>
      {view.kind === "friend" && friend ? (
        <div className="tv-friend-head">
          <span className="tv-person-pic" data-online={friend.on && friend.online ? "true" : undefined}>
            <Avatar id={friend.avatar} />
          </span>
          <div className="tv-friend-names">
            <h1 className="tv-view-title" data-testid="tv-view-title">
              {grid.title}
            </h1>
            {grid.meta && <p className="tv-view-meta">{grid.meta}</p>}
            {grid.hint && (
              <p className="tv-view-hint" data-testid="tv-view-hint">
                {grid.hint}
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <h1 className="tv-view-title" data-testid="tv-view-title">
            {grid.title}
          </h1>
          {grid.meta && <p className="tv-view-meta">{grid.meta}</p>}
          {grid.hint && (
            <p className="tv-view-hint" data-testid="tv-view-hint">
              {grid.hint}
            </p>
          )}
        </>
      )}
      {view.kind === "ratings" && ratingOptions && ratingChipRows.length > 0 && (
        <div className="tv-rating-filters" data-testid="rating-filters">
          {ratingRows.sections.length > 0 && (
            <div className="tv-filters tv-filters-kind" role="radiogroup" aria-label={t("rating.filterKind")} onFocus={(event) => slideIntoView(event.target as HTMLElement)}>
              {sliding && <Thumb on={`${ratingFilter.section}|${ratingRows.sections.length}`} />}
              {ratingRows.sections.map((section, col) => {
                const pos: Pos = { zone: "chips", row: 0, col };
                const count = section ? (ratingOptions.sections.find((each) => each.section === section)?.count ?? 0) : data.ratings.length;
                return (
                  <button
                    key={section ?? "all"}
                    className="tv-choice"
                    role="radio"
                    aria-checked={ratingFilter.section === section}
                    data-testid={`rating-filter-${section ?? "all"}`}
                    data-zone={pos.zone}
                    data-row={pos.row}
                    data-col={pos.col}
                    onClick={() => selectRatings({ ...ratingFilter, section })}
                    onFocus={() => (remembered.focus[viewKey(view)] = pos)}
                  >
                    {t(section === undefined ? "tv.filterAll" : section === "movie" ? "tv.filterMovies" : section === "series" ? "tv.filterSeries" : section === "cartoon" ? "tv.filterCartoons" : "tv.filterAnime")}
                    <span className="tv-choice-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
          {scorePicking && (
            <ScorePick
              scores={ratingRows.scores}
              chosen={ratingFilter.score}
              countOf={scoreCount}
              row={scoreRow}
              columns={scoreColumns}
              open={scoreOpen}
              onOpen={setScoreOpen}
              onPick={(score) => selectRatings({ ...ratingFilter, score })}
              onFocusButton={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: scoreRow, col: 0 })}
            />
          )}
          {ratingRows.scores.length > 0 && !scorePicking && (
            <div className="tv-filters tv-filters-wrap" role="radiogroup" aria-label={t("rating.filterScores")} onFocus={(event) => slideIntoView(event.target as HTMLElement)}>
              {ratingRows.scores.map((score, col) => {
                const pos: Pos = { zone: "chips", row: scoreRow, col };
                const count = scoreCount(score);
                return (
                  <button
                    key={score ?? "any"}
                    className="tv-choice"
                    role="radio"
                    aria-checked={ratingFilter.score === score}
                    {...(score !== undefined ? { "aria-label": `${t("rating.filterScore", { score })} (${count})` } : {})}
                    data-testid={`rating-score-${score ?? "any"}`}
                    data-zone={pos.zone}
                    data-row={pos.row}
                    data-col={pos.col}
                    onClick={() => selectRatings({ ...ratingFilter, score })}
                    onFocus={() => (remembered.focus[viewKey(view)] = pos)}
                  >
                    {score === undefined ? (
                      t("rating.filterAnyScore")
                    ) : (
                      <>
                        <StarIcon filled /> {score}
                      </>
                    )}
                    <span className="tv-choice-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {view.kind === "list" && !canAdd && (
        <p className="tv-view-meta" data-testid="lists-full">
          {t("lists.full", { count: MAX_LISTS })}
        </p>
      )}
      {view.kind === "list" && (
        <div className="tv-filters tv-filters-wrap" role="radiogroup" aria-label={t("rows.myList")} onFocus={(event) => slideIntoView(event.target as HTMLElement)}>
          {listChips.map((info, col) => (
            <button
              key={info.id}
              className="tv-choice"
              role="radio"
              aria-checked={info.id === shownId}
              data-testid={`list-chip-${info.id}`}
              data-zone="chips"
              data-row={0}
              data-col={col}
              onClick={() => selectList(info.id)}
              onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col })}
            >
              {listName(info)}
            </button>
          ))}
          {canAdd && (
            <button
              className="tv-choice"
              data-testid="list-new"
              data-zone="chips"
              data-row={0}
              data-col={listChips.length}
              onClick={() => setOverlay({ kind: "edit", id: null, back: { zone: "chips", row: 0, col: listChips.length } })}
              onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: listChips.length })}
            >
              <PlusIcon /> {t("lists.new")}
            </button>
          )}
          <button
            className="tv-choice"
            data-testid="list-edit"
            data-zone="chips"
            data-row={0}
            data-col={listChips.length + (canAdd ? 1 : 0)}
            onClick={() => setOverlay({ kind: "edit", id: shownId, back: { zone: "chips", row: 0, col: listChips.length + (canAdd ? 1 : 0) } })}
            onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: listChips.length + (canAdd ? 1 : 0) })}
          >
            <PencilIcon /> {t("lists.edit")}
          </button>
        </div>
      )}
      {view.kind === "friend" && friend && (
        <div className="tv-filters tv-filters-friend" role="toolbar" aria-label={friend.name} onFocus={(event) => slideIntoView(event.target as HTMLElement)}>
          <button
            className="tv-choice tv-choice-round"
            data-testid="tv-friend-back"
            data-zone="chips"
            data-row={0}
            data-col={0}
            aria-label={t("common.back")}
            title={t("common.back")}
            onClick={() => choose({ kind: "friends" })}
            onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: 0 })}
          >
            <ChevronIcon className="flip" />
          </button>
          <span className="tv-segmented tv-friend-tabs" role="radiogroup" aria-label={friend.name}>
          {FRIEND_TABS.map((value, index) => (
            <button
              key={value}
              className="tv-choice"
              role="radio"
              aria-checked={friendTab === value}
              data-testid={`friend-tab-${value}`}
              data-zone="chips"
              data-row={0}
              data-col={1 + index}
              onClick={() => selectTab(friend.id, value)}
              onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: 1 + index })}
            >
              {t(value === "lists" ? "friends.tabLists" : "friends.tabRatings")}
            </button>
          ))}
          </span>
          <span className="tv-friend-gap" aria-hidden="true" />
          {canAskTogether(friend) && (
            <>
              <button
                className="tv-choice tv-choice-primary"
                data-testid="friend-together"
                title={t("friends.askTogether")}
                data-zone="chips"
                data-row={0}
                data-col={1 + FRIEND_TABS.length}
                onClick={() => void askToWatch(friend.id)}
                onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: 1 + FRIEND_TABS.length })}
              >
                <UsersIcon /> {t("friends.togetherShort")}
              </button>
              <button
                className="tv-choice"
                data-testid="friend-plan"
                title={t("friends.planButton")}
                data-zone="chips"
                data-row={0}
                data-col={2 + FRIEND_TABS.length}
                onClick={() => setOverlay({ kind: "planPick", friend: friend.id, back: { zone: "chips", row: 0, col: 2 + FRIEND_TABS.length } })}
                onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: 2 + FRIEND_TABS.length })}
              >
                <ClockIcon /> {t("friends.planShort")}
              </button>
            </>
          )}
          <button
            className="tv-choice"
            data-testid="friend-chat"
            data-zone="chips"
            data-row={0}
            data-col={chatChip}
            onClick={() => setOverlay({ kind: "chat", friend: friend.id, back: { zone: "chips", row: 0, col: chatChip } })}
            onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: chatChip })}
          >
            <MessageIcon /> {t("chat.open")}
            {waitingFrom(friends.state, friend.id) > 0 && (
              <small className="tv-badge" data-testid="friend-chat-unread">
                {waitingFrom(friends.state, friend.id)}
              </small>
            )}
          </button>
        </div>
      )}
    </>
  ) : null;
  const viewFoot = view.kind === "friend" && friend ? (
    <div className="tv-view-foot tv-friend-foot">
      <button
        className="tv-choice tv-choice-danger"
        data-testid="friend-remove"
        data-zone="foot"
        data-row={0}
        data-col={0}
        onClick={() => setOverlay({ kind: "unfriend", id: friend.id, name: friend.name, back: { zone: "foot", row: 0, col: 0 } })}
        onFocus={() => (remembered.focus[viewKey(view)] = { zone: "foot", row: 0, col: 0 })}
      >
        <CloseIcon /> {t("friends.remove")}
      </button>
    </div>
  ) : null;
  const intoGridView = (event: FocusEvent<HTMLElement>) => {
    if (gridRef.current) keepInView(gridRef.current, event.target as HTMLElement);
  };
  const headPlace = `${headInRows}:${headInGrid}`;
  const headWas = useRef(headPlace);
  useLayoutEffect(() => {
    if (headWas.current === headPlace) return;
    headWas.current = headPlace;
    if (document.activeElement && document.activeElement !== document.body) return;
    const at = remembered.focus[viewKey(view)];
    if (at && (at.zone === "hero" || at.zone === "chips" || at.zone === "foot")) focusAt(at);
  }, [headPlace]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section
      className="tv-browse"
      ref={rootRef}
      data-testid="tv-browse"
      data-view={viewKey(view)}
      data-deep={deep}
      data-stage={stage ? "rows" : undefined}
      data-billboard={billboard ? "true" : undefined}
      data-hand={few ? "true" : undefined}
      aria-label={t("tv.library")}
    >
      <Backdrop image={compact ? undefined : (shown?.entry.backdrop ?? shown?.entry.image)} />
      <div className="tv-browse-shade" />
      {stage && <div className="tv-browse-shade tv-browse-bill" />}

      <Rail open={railOpen} onOpen={setRailOpen} entries={entries} bar={compact} flat={flatHand && !compact} onHome={wordmarkHome} onArrive={(element) => keepInView(element.closest<HTMLElement>(".tv-rail")!, element)} />

      <header className="tv-browse-top">
        <button type="button" className="tv-browse-logo" data-testid="tv-logo-home" tabIndex={-1} aria-label={t("tv.home")} onMouseDown={(event) => event.preventDefault()} onClick={wordmarkHome}>
          <Logo />
        </button>
        {(notice || ownNotice) && !detail && (
          <p className="tv-notice" role="alert" data-testid="tv-notice">
            {notice || ownNotice}
          </p>
        )}
        <div className="tv-browse-corner">
          {wayBack && <BackButton onClick={() => choose(wayBack)} testId="tv-page-back" col={0} />}
          {showBell && <BellChip onOpen={() => setOverlay({ kind: "bell", back: { zone: "top", row: 0, col: lead } })} col={lead} />}
          {showAccount && <AccountChip onOpen={() => choose({ kind: "profile" })} current={isProfilePage(view)} zone col={lead + (showBell ? 1 : 0)} />}
          <FullscreenToggle className="tv-corner-button" data={{ "data-zone": "top", "data-row": 0, "data-col": lead + (showBell ? 1 : 0) + (showAccount ? 1 : 0) }} />
        </div>
      </header>

      {rowsPage && (
        <>
          {view.kind !== "profile" && <GetTheAppStrip className="in-browse" />}
          {sectionButtons && (
            <div className="tv-filters tv-sections tv-filters-kind" role="radiogroup" aria-label={t("tv.sections")} onFocus={(event) => slideIntoView(event.target as HTMLElement)}>
              {sliding && <Thumb on={`${view.kind}|${sectionChips.length}`} />}
              {sectionChips.map((chip, col) => (
                <button
                  key={chip.kind}
                  className="tv-choice"
                  role="radio"
                  aria-checked={view.kind === chip.kind}
                  data-testid={`section-${chip.kind}`}
                  data-zone="chips"
                  data-row={0}
                  data-col={col}
                  onClick={() => selectSection({ kind: chip.kind })}
                  onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col })}
                >
                  {t(chip.label)}
                </button>
              ))}
            </div>
          )}
          {!headInRows && (
          <div
            className={`tv-hero${view.kind === "profile" ? " tv-hero-profile" : friendsHead ? " tv-hero-friends" : ""}`}
            data-testid="tv-hero"
            data-poster={heroPoster && view.kind !== "profile" ? "true" : undefined}
          >
            {view.kind === "profile" ? (
              profileHead
            ) : friendsHead ? (
              <div className="tv-hero-text tv-friends-head" key="friends-head">
                <h1 className="tv-hero-title" data-testid="tv-friends-title">
                  {t("friends.title")}
                </h1>
                <p className="tv-hero-meta" data-testid="tv-friends-summary">
                  {friendsSummary(friends.state)}
                </p>
              </div>
            ) : shown && !compact ? (
              <>
                {heroPoster && <Poster key={`poster-${shown.entry.id}`} className="tv-hero-poster" title={shownTitle(shown.entry)} image={heroPoster} seed={shown.entry.id} />}
              <div className="tv-hero-text" key={shown.entry.id}>
                <p className="tv-hero-eyebrow" data-testid="tv-hero-eyebrow">{shown.entry.opens?.kind === "category" || shown.entry.opens?.kind === "categories" ? t("tv.categories") : shown.label}</p>
                <h1 className="tv-hero-title" data-testid="tv-hero-title">
                  <ShownName of={shown.entry} />
                </h1>
                <p className="tv-hero-meta">{[shown.entry.year, shown.entry.note, kindWord(shown.entry)].filter(Boolean).join("  ·  ")}</p>
                <HeroAbout entry={shown.entry} />
                <div className="tv-hero-actions">
                  {actions.map((action, col) => (
                    <button
                      key={action}
                      className={`tv-hero-button${action === "play" ? " is-primary" : ""}`}
                      data-testid={`tv-hero-${action}`}
                      data-zone="hero"
                      data-row={0}
                      data-col={col}
                      aria-pressed={action === "list" ? isSaved(shown.entry) : undefined}
                      onClick={() => doAction(action, undefined, { zone: "hero", row: 0, col })}
                    >
                      {labelOf(action, shown.entry, false)}
                    </button>
                  ))}
                </div>
              </div>
              </>
            ) : shown ? null : status === "loading" ? (
              <p className="tv-hero-eyebrow">{t("tv.loadingLibrary")}</p>
            ) : sectionWaiting ? (
              <p className="tv-hero-eyebrow">{t("tv.loadingLibrary")}</p>
            ) : kindEmpty ? (
              <>
                <h1 className="tv-hero-title tv-hero-status">
                  {t(view.kind === "movies" ? "tv.kindEmptyMovies" : view.kind === "series" ? "tv.kindEmptySeries" : view.kind === "cartoons" ? "tv.kindEmptyCartoons" : "tv.kindEmptyAnime")}
                </h1>
                <p className="tv-hero-about">{t("tv.kindEmptyHelp")}</p>
                <div className="tv-actions tv-actions-start">
                  <button className="tv-action tv-action-primary" onClick={() => choose({ kind: "home" })} autoFocus data-testid="tv-browse-home" data-zone="rows" data-row={0} data-col={0}>
                    {t("tv.home")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="tv-hero-title tv-hero-status">{status === "failed" ? t("tv.libraryFailed") : t("tv.libraryEmpty")}</h1>
                <p className="tv-hero-about">{status === "failed" ? t("tv.libraryFailedHelp") : t("tv.libraryEmptyHelp")}</p>
                <div className="tv-actions tv-actions-start">
                  <button className="tv-action tv-action-primary" onClick={retry} autoFocus data-testid="tv-browse-retry" data-zone="rows" data-row={0} data-col={0}>
                    {t("common.retry")}
                  </button>
                </div>
              </>
            )}
          </div>
          )}

          <div className="tv-rows" ref={rowsRef} onScroll={askShelves} data-skip={isRowsPage(view) && !few ? "true" : undefined}>
            {homeRows.length > 0
              ? drawnRows.map((row, r) => (
                  <section
                    className="tv-row"
                    key={row.id}
                    data-row-id={row.id}
                    data-layout={row.layout}
                    data-shape={row.shape}
                    data-posters={row.layout === "wide" && !row.shape && row.entries[0] && isTitle(row.entries[0]) ? "true" : undefined}
                    data-grouped={row.group ? "true" : undefined}
                    aria-label={row.title}
                  >
                    {headInRows && r === 0 && (
                      <div className="tv-hero tv-hero-profile" data-testid="tv-hero">
                        {profileHead}
                      </div>
                    )}
                    {row.group && homeRows[r - 1]?.group !== row.group && (
                      <h2 className="tv-row-group" data-testid="tv-row-group">
                        {row.group}
                      </h2>
                    )}
                    {featured && row === featuredIn && (
                      <Feature
                        entry={resumable(featured, progress)}
                        play={labelOf("play", resumable(featured, progress), false)}
                        list={labelOf("list", featured, false)}
                        kept={isSaved(featured)}
                        onOpen={() => openDetail({ entry: resumable(featured, progress), label: row.title, ...(row.source ? { source: row.source } : {}) })}
                        onPlay={() => playEntry(resumable(featured, progress))}
                        onList={() => doAction("list", featured)}
                      />
                    )}
                    {!(friendsHead && row === peopleRow) && <h2 className="tv-row-title">{row.title}</h2>}
                    <RowTiles startFar={r >= farFrom} {...(row.layout === "wide" && growing.has(row.id) ? { onNearEnd: () => feed.loadMore(row.id, ROW_CAP), loading: loadingTitles(feeding, row.id) } : {})}>
                      {rowTiles(row, r)}
                    </RowTiles>
                  </section>
                ))
              : status === "loading" && (
                  <section className="tv-row" aria-hidden="true">
                    <h2 className="tv-row-title tv-skeleton-title" />
                    <div className="tv-row-tiles">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div className="tv-tile tv-skeleton" key={i} />
                      ))}
                    </div>
                  </section>
                )}
            {homeRows.length > 0 && isRowsPage(view) && failedShelves(feeding, feedSection) && (
              <p className="tv-rows-note" role="status" data-testid="tv-rows-failed">
                {t("rows.moreFailed")}
              </p>
            )}
            {homeRows.length > 0 && isRowsPage(view) && loadingShelves(feeding, feedSection) && (
              <section className="tv-row tv-row-waiting" aria-hidden="true" data-testid="tv-rows-waiting">
                <h2 className="tv-row-title tv-skeleton-title" />
                <div className="tv-row-tiles">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div className="tv-tile tv-skeleton" key={i} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      {grid && (
        <div className="tv-view" data-testid={view.kind === "category" ? "tv-category" : `tv-${view.kind}`}>
          {!headInGrid && viewHead}
          {grid.entries.length > 0 ? (
            <div className={`tv-grid${grid.layout === "categories" ? " tv-grid-categories" : posterGrid ? " tv-grid-posters" : ""}`} ref={gridRef} onScroll={askTitles} style={{ "--cols": gridColumns } as CSSProperties}>
              {headInGrid && (
                <div className="tv-view-head" onFocus={intoGridView}>
                  {viewHead}
                </div>
              )}
              {grid.entries.map((entry, i) => {
                const at: { row: number; col: number; heading?: string } = sectionPlace?.[i] ?? { row: Math.floor(i / gridColumns), col: i % gridColumns };
                return (
                  <Fragment key={`grid-${entry.id}`}>
                    {at.heading !== undefined && (
                      <h2 className="tv-grid-heading" data-testid="tv-grid-heading">
                        {at.heading}
                      </h2>
                    )}
                    {tile(entry, { zone: "grid", row: at.row, col: at.col }, grid.title, grid.layout, undefined, view.kind === "list" ? shownId : undefined)}
                  </Fragment>
                );
              })}
              {view.kind === "category" &&
                loadingTitles(feeding, view.rowId) &&
                Array.from({ length: gridColumns }, (_, i) => <div className="tv-tile tv-skeleton" data-testid="tv-grid-waiting" aria-hidden="true" key={`waiting-${i}`} />)}
              {headInGrid && viewFoot && (
                <div className="tv-view-tail" onFocus={intoGridView}>
                  {viewFoot}
                </div>
              )}
            </div>
          ) : (
            <p className="tv-view-empty" data-testid="tv-view-empty">
              {grid.empty}
            </p>
          )}
          {!headInGrid && viewFoot}
        </div>
      )}

      {view.kind === "search" && (
        <div className="tv-search" data-testid="tv-search">
          <div className="tv-search-side">
            {narrow ? (
              <div className="tv-query-field">
              <input
                className="tv-query"
                data-testid="tv-query"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                placeholder={t("tv.searchHint")}
                aria-label={t("tv.search")}
                value={query}
                onChange={(event) => setBox({ text: event.target.value, caret: event.target.value.length })}
              />
              {query && (
                <button
                  type="button"
                  className="tv-query-clear"
                  data-testid="tv-query-clear"
                  aria-label={t("tv.clear")}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    edit({ kind: "clear" });
                    event.currentTarget.parentElement?.querySelector("input")?.focus();
                  }}
                >
                  <CloseIcon />
                </button>
              )}
              </div>
            ) : (
              <>
                <SearchField box={box} hint={t("tv.searchHint")} onEdit={edit} />
                <div className="tv-keys" role="group" aria-label={t("tv.keyboard")}>
                  {KEYBOARD_KEYS.map((key, i) => (
                    <Key key={key} testId={`key-${key}`} pos={{ zone: "keys", row: Math.floor(i / KEYBOARD_COLUMNS), col: i % KEYBOARD_COLUMNS }} onPress={() => edit({ kind: "type", char: key })}>
                      {key}
                    </Key>
                  ))}
                  <Key testId="key-left" label={t("tv.caretLeft")} pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 0 }} onPress={() => edit({ kind: "move", to: "left" })}>
                    <ChevronLeftIcon />
                  </Key>
                  <Key testId="key-right" label={t("tv.caretRight")} pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 1 }} onPress={() => edit({ kind: "move", to: "right" })}>
                    <ChevronIcon />
                  </Key>
                  <Key testId="key-space" wide pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 2 }} onPress={() => edit({ kind: "type", char: " " })}>
                    {t("tv.space")}
                  </Key>
                  <Key testId="key-delete" label={t("tv.delete")} pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 3 }} onPress={() => edit({ kind: "backspace" })}>
                    <BackspaceIcon />
                  </Key>
                  <Key testId="key-clear" label={t("tv.clear")} pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 4 }} onPress={() => edit({ kind: "clear" })}>
                    <ClearIcon />
                  </Key>
                </div>
              </>
            )}
          </div>
          <div className="tv-search-main">
            <div className="tv-filters tv-filters-kind" role="radiogroup" aria-label={t("tv.search")}>
              {sliding && <Thumb on={`${filter}|${child}|${searchFilters.length}`} />}
              {searchFilters.map((value, col) => {
                const pos: Pos = { zone: "chips", row: 0, col };
                return (
                  <button
                    key={value}
                    className="tv-choice"
                    role="radio"
                    aria-checked={child || filter === value}
                    data-testid={`filter-${value}`}
                    data-zone={pos.zone}
                    data-row={pos.row}
                    data-col={pos.col}
                    onClick={() => setFilter(value)}
                    onFocus={() => (remembered.focus.search = pos)}
                  >
                    {t(value === "all" ? "tv.filterAll" : value === "movie" ? "tv.filterMovies" : value === "series" ? "tv.filterSeries" : value === "cartoon" ? "tv.filterCartoons" : "tv.filterAnime")}
                  </button>
                );
              })}
            </div>
            <p className="tv-view-meta" data-testid="tv-search-status">
              {!query.trim()
                ? t("tv.typeToSearch")
                : shownResults.length > 0
                  ? `${shownAnswers.exact > 0 ? t("tv.found", { count: shownAnswers.exact, query: query.trim() }) : t("tv.closestOnly", { query: query.trim() })}${searchFailed ? t("tv.searchOffline") : searching ? t("tv.stillLooking") : ""}`
                  : searchFailed
                    ? t("tv.searchFailed")
                    : searching
                      ? t("tv.looking")
                      : t("tv.nothingMatches", { query: query.trim() })}
            </p>
            <div className="tv-grid tv-grid-posters tv-results" style={{ "--cols": resultColumns } as CSSProperties}>
              {shownResults.map((item, i) => {
                const close = i >= shownAnswers.exact;
                const at = close ? i - shownAnswers.exact : i;
                const row = Math.floor(at / resultColumns) + (close ? Math.ceil(shownAnswers.exact / resultColumns) : 0);
                return (
                  <Fragment key={item.id}>
                    {i === shownAnswers.exact && i > 0 && (
                      <h2 className="tv-results-closest" data-testid="tv-closest">
                        {t("tv.closest")}
                      </h2>
                    )}
                    {tile(entryOfItem(item), { zone: "results", row, col: at % resultColumns }, t("tv.search"), "wide")}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="tv-detail" role="dialog" aria-modal="true" aria-label={shownTitle(detail.entry)} data-testid="tv-detail" data-show={series.isShow} data-art={Boolean(detailArt)} onClick={closeBesideIt}>
          {!compact && <DetailArt image={detailArt} />}
          <div className="tv-detail-scroll" onClick={closeBesideIt} onFocus={scrollPage}>
            {compact && <DetailArt image={detailArt} />}
            <div className="tv-detail-hero" onClick={closeBesideIt}>
              <div className="tv-detail-text">
                <p className="tv-hero-eyebrow">{detail.label}</p>
                <h1 className="tv-detail-title" data-testid="tv-detail-title">
                  <ShownName of={detail.entry} />
                </h1>
                <p className="tv-hero-meta">{[detail.entry.year, detail.entry.note, kindWord(detail.entry)].filter(Boolean).join("  ·  ")}</p>
                {series.unavailable && (
                  <p className="tv-detail-gone" data-testid="tv-detail-unavailable">
                    {t("library.unavailableFilm")}
                  </p>
                )}
                {about && <AboutFacts about={about} hasRoDub={detail.entry.hasRoDub || about.hasRoDub} />}
                <DetailAbout entry={detail.entry} />
                {about && <AboutPeople about={about} />}
                <div className="tv-hero-actions">
                  {overviewActions(detail.entry, ratingsOn, friends.on, handHeld(), several).map((action, col) => (
                    <button
                      key={action}
                      className={`tv-hero-button${action === "play" ? " is-primary" : ""}`}
                      data-testid={`tv-detail-${action}`}
                      data-zone="detail"
                      data-row={0}
                      data-col={col}
                      aria-pressed={action === "list" ? isSaved(detail.entry) : undefined}
                      aria-haspopup={action === "lists" || (action === "list" && tapOf(detail.entry) === "pick") ? "dialog" : undefined}
                      aria-label={action === "list" && several ? listSpelled(detail.entry) : undefined}
                      aria-disabled={series.holding && (action === "play" || action === "tv") ? true : undefined}
                      onClick={() => !(series.holding && (action === "play" || action === "tv")) && doAction(action, detail.entry, { zone: "detail", row: 0, col }, series.start)}
                    >
                      {labelOf(action, detail.entry, true)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {series.isShow && <SeriesSection page={series} columns={episodeColumns} onPlay={playEpisode} onSlide={slideIntoView} />}
            {aboutList.map((row, r) => (
              <section className="tv-detail-more" key={`${detail.entry.id}-${row.id}`} aria-label={t(`about.${row.id}`)} data-testid={`tv-about-${row.id}`}>
                <h2 className="tv-row-title">{t(`about.${row.id}`)}</h2>
                <RowTiles>{row.items.map((item, c) => tile(entryOfItem(item), { zone: "related", row: r, col: c }, t(`about.${row.id}`), "wide"))}</RowTiles>
              </section>
            ))}
          </div>
          <button className="tv-hero-button tv-detail-close" onClick={closeDetail} data-testid="tv-detail-close" data-zone="close" data-row={0} data-col={0}>
            <CloseIcon /> {t("common.close")}
          </button>
          {notice && (
            <p className="tv-notice tv-detail-notice" role="alert" data-testid="tv-notice">
              {notice}
            </p>
          )}
        </div>
      )}

      {overlay?.kind === "pick" && (
        <Screen testId="tv-list-picker" compact focus onBack={closeOverlay}>
          <h1 className="tv-headline tv-headline-small">{t("library.addToAList")}</h1>
          <p className="tv-lead">{overlay.entry.title}</p>
          <div className="tv-list-picks" role="group" aria-label={t("library.addToAList")}>
            {lists.map((info) => {
              const has = inList(overlay.entry, info.id);
              return (
                <button key={info.id} className="tv-action" aria-pressed={has} data-nav data-testid={`pick-${info.id}`} onClick={() => profileStore.setInList(listEntryOf(overlay.entry), !has, info.id)}>
                  {has ? <CheckIcon /> : <PlusIcon />} {listName(info)}
                </button>
              );
            })}
            {canAdd && (
              <button className="tv-action tv-action-new" onClick={() => setOverlay({ kind: "edit", id: null, back: overlay.back, from: overlay })} data-nav data-testid="pick-new">
                <PlusIcon /> {t("lists.new")}
              </button>
            )}
          </div>
          {!canAdd && (
            <p className="tv-view-meta" data-testid="lists-full">
              {t("lists.full", { count: MAX_LISTS })}
            </p>
          )}
          <div className="tv-actions">
            <button className="tv-action tv-action-primary" onClick={closeOverlay} data-nav data-testid="pick-done" {...(overlay.fresh ? { "data-autofocus": true } : {})}>
              {t("common.done")}
            </button>
          </div>
        </Screen>
      )}

      {overlay?.kind === "rate" && (
        <RateOverlay entry={overlay.entry} isShow={overlay.isShow} seasons={overlay.seasons} shown={overlay.shown} episodes={overlay.episodes} onClose={closeOverlay} />
      )}

      {overlay?.kind === "recommend" && <FriendPickerTv title={t("friends.sendTitle")} lead={overlay.entry.title} build={() => recommendationOf(overlay.entry)} said="friends.sent" onClose={closeOverlay} />}
      {overlay?.kind === "addFriend" && <AddFriendTv onClose={closeOverlay} />}
      {overlay?.kind === "friendSettings" && <FriendSettingsTv onClose={closeOverlay} />}
      {overlay?.kind === "news" && <NewsTv onClose={closeOverlay} onSeen={news.seen} />}
      {overlay?.kind === "friendRequest" && <FriendRequestTv person={overlay.person} onClose={closeOverlay} />}
      {overlay?.kind === "plan" && (
        <PlanTv
          id={overlay.id}
          onStartParty={(friendId) => {
            setOverlay(null);
            onStartTogether(friendId);
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "planPick" && <PlanPickerTv friendId={overlay.friend} onClose={closeOverlay} />}
      {overlay?.kind === "chat" && (
        <TvChat
          key={overlay.friend}
          friendId={overlay.friend}
          narrow={narrow}
          onClose={closeOverlay}
          onOpenTitle={(entry) => openDetail({ entry: resumable(entry, progress), label: t(entry.kind === "series" ? "tv.series" : "tv.movies") })}
        />
      )}
      {overlay?.kind === "bell" && (
        <NotificationsTv
          onPress={(entry) => {
            setOverlay(null);
            press({ entry: resumable(entry, progress), label: t("bell.title") }, overlay.back);
          }}
          onFriends={() => {
            setOverlay(null);
            choose({ kind: "friends" });
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "unfriend" && (
        <UnfriendTv
          id={overlay.id}
          name={overlay.name}
          onCancel={closeOverlay}
          onGone={() => {
            setOverlay(null);
            choose({ kind: "friends" });
          }}
        />
      )}

      {overlay?.kind === "edit" && (
        <Screen testId="tv-list-edit" compact focus onBack={leaveEdit}>
          <h1 className="tv-headline tv-headline-small">{t(overlay.id ? "lists.edit" : "lists.new")}</h1>
          <ListEditor
            tv
            list={lists.find((info) => info.id === overlay.id)}
            taken={lists.filter((info) => info.id !== overlay.id).map(listName)}
            onSave={(name) => {
              if (overlay.id) {
                profileStore.renameList(overlay.id, name);
                return closeOverlay();
              }
              const made = profileStore.createList(name);
              if (overlay.from) {
                if (made) profileStore.setInList(listEntryOf(overlay.from.entry), true, made);
                return setOverlay({ ...overlay.from, fresh: true });
              }
              if (!made) return closeOverlay();
              selectList(made);
              setOverlay(null);
              setPending({ zone: "chips", row: 0, col: lists.length });
            }}
            onCancel={leaveEdit}
            {...(editedAt > 0 && lists.length > 2
              ? { onMove: (by: -1 | 1) => profileStore.moveList(editedId!, by), canMoveEarlier: editedAt > 1, canMoveLater: editedAt < lists.length - 1 }
              : {})}
            onDelete={
              overlay.id && overlay.id !== DEFAULT_LIST
                ? () => {
                    profileStore.deleteList(overlay.id!);
                    selectList(DEFAULT_LIST);
                    setOverlay(null);
                    setPending({ zone: "chips", row: 0, col: 0 });
                  }
                : undefined
            }
          />
        </Screen>
      )}
    </section>
  );
}

function Backdrop({ image }: { image: string | undefined }) {
  const [layers, setLayers] = useState<Array<{ id: number; image: string | undefined }>>([]);
  const counter = useRef(0);
  useEffect(() => {
    let live = true;
    const show = (picture: string | undefined) => live && setLayers((now) => (now[now.length - 1]?.image === picture ? now : [...now.slice(-3), { id: ++counter.current, image: picture }]));
    if (!image) show(undefined);
    else {
      const loader = new Image();
      loader.src = image;
      const ready = loader.decode
        ? loader.decode()
        : new Promise<void>((resolve, reject) => {
            loader.onload = () => resolve();
            loader.onerror = reject;
          });
      ready.then(() => show(image), () => show(undefined));
    }
    return () => {
      live = false;
    };
  }, [image]);
  return (
    <>
      {layers.map((layer) => (
        <div
          key={layer.id}
          className="tv-hero-bg"
          {...(layer.image ? { style: { backgroundImage: `url(${JSON.stringify(layer.image)})` } } : {})}
          onAnimationEnd={() => setLayers((now) => now.filter((other) => other.id >= layer.id))}
        />
      ))}
    </>
  );
}

function DetailArt({ image }: { image: string | undefined }) {
  return (
    <>
      <Backdrop image={image} />
      <div className="tv-browse-shade" />
    </>
  );
}

function Key({ children, pos, wide, label, testId, onPress }: { children: ReactNode; pos: Pos; wide?: boolean; label?: string; testId: string; onPress: () => void }) {
  return (
    <button
      className={`tv-key${wide ? " tv-key-wide" : ""}`}
      {...(label ? { "aria-label": label, title: label } : {})}
      data-testid={testId}
      data-zone={pos.zone}
      data-row={pos.row}
      data-col={pos.col}
      onClick={onPress}
      onFocus={() => (remembered.focus.search = pos)}
    >
      {children}
    </button>
  );
}

const PLACE_ICON: Record<string, ReactNode> = {
  "profile:ratings": <StarIcon />,
  "profile:friends": <UsersIcon />,
  "profile:history": <ClockIcon />,
  "profile:news": <SparkleIcon />,
};

const TOOL_ICON: Record<string, ReactNode> = {
  "add-friend": <PlusIcon />,
  "friend-settings": <GearIcon />,
  "activity-off": <EyeIcon />,
};

interface Corner {
  kind: "add" | "kept" | "clear";
  label: string;
  run: () => void;
}

function ShownName({ of }: { of: Entry }) {
  return <>{useShown(of).title}</>;
}

function HeroAbout({ entry }: { entry: Entry }) {
  const { description } = useShown(entry);
  return description ? <p className="tv-hero-about">{description}</p> : null;
}
function DetailAbout({ entry }: { entry: Entry }) {
  const { description } = useShown(entry);
  return description ? <AboutText text={description} className="tv-detail-about" /> : null;
}

interface TileActs {
  arrived: (element: HTMLElement, pos: Pos, now: Focused) => void;
  press: (title: Focused, from: Pos) => void;
  cornerOf: (entry: Entry, listId: string | undefined) => Corner | undefined;
}
interface TileProps {
  entry: Entry;
  resumed: Entry;
  label: string;
  source: string | undefined;
  listId: string | undefined;
  layout: Layout;
  landscape: boolean;
  compact: boolean;
  rank: number;
  pos: Pos;
  corner: Pick<Corner, "kind" | "label"> | undefined;
  score: number | undefined;
  act: RefObject<TileActs>;
}
const sameTile = (a: TileProps, b: TileProps) =>
  a.entry === b.entry &&
  (a.resumed === b.resumed || (a.resumed.resumeUrl === b.resumed.resumeUrl && a.resumed.startAt === b.resumed.startAt)) &&
  a.label === b.label &&
  a.source === b.source &&
  a.listId === b.listId &&
  a.layout === b.layout &&
  a.landscape === b.landscape &&
  a.compact === b.compact &&
  a.rank === b.rank &&
  a.pos.zone === b.pos.zone &&
  a.pos.row === b.pos.row &&
  a.pos.col === b.pos.col &&
  a.corner?.kind === b.corner?.kind &&
  a.corner?.label === b.corner?.label &&
  a.score === b.score &&
  a.act === b.act;
const Tile = memo(function Tile({ entry, resumed, label, source, listId, layout: asked, landscape, compact, rank, pos, corner, score, act }: TileProps) {
  const title = (): Focused => ({ entry: resumed, label, ...(source ? { source } : {}) });
  const onArrive = (element: HTMLElement) => act.current.arrived(element, pos, title());
  const onPress = () => act.current.press(title(), pos);
  const [broken, setBroken] = useState(false);
  const name = useShown(isTitle(entry) ? entry : null).title || entry.title;
  const hue = hueOf(entry.id);
  const layout: Layout = compact && asked === "ranked" ? "wide" : asked;
  const wideCard = landscape && layout === "wide" && isTitle(entry);
  const poster = layout === "wide" && isTitle(entry) && !wideCard;
  const picture = layout === "ranked" || poster ? (entry.image ?? entry.backdrop) : (entry.backdrop ?? entry.image);
  const showPicture = picture && !broken;
  const fit = pos.zone !== "rows" && pos.zone !== "related" ? undefined : layout === "ranked" || poster ? TILE_FIT : wideCard || layout === "categories" ? CARD_FIT : undefined;
  const common = {
    "data-zone": pos.zone,
    "data-row": pos.row,
    "data-col": pos.col,
    "data-entry": entry.id,
    onMouseDown: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (corner && (event.target as Element).closest("[data-corner]")) return act.current.cornerOf(entry, listId)?.run();
      event.currentTarget.focus({ preventScroll: true });
      onPress();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => onArrive(event.currentTarget),
    title: name,
  };

  if (layout === "categories") {
    const place = PLACE_ICON[entry.id];
    const tool = TOOL_ICON[entry.id];
    const fan = entry.posters !== undefined && entry.posters.length > 0;
    return (
      <button
        className={`tv-tile tv-tile-category${entry.avatar || tool ? " tv-tile-person" : ""}${tool ? " tv-tile-tool" : ""}${place ? " tv-tile-place" : ""}${fan ? " tv-tile-fan" : ""}`}
        data-testid="tv-category-tile"
        data-tool={tool ? entry.id : undefined}
        {...common}
        style={{ "--hue": hue } as CSSProperties}
      >
        {showPicture && <img loading="lazy" {...posterSizes(picture, fit)} src={picture} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} {...comesIn} />}
        {fan && (
          <span className="tv-category-fan" aria-hidden="true">
            {entry.posters!.map((poster, at) => (
              <img key={poster} loading="lazy" {...posterSizes(poster, fit && FAN_FIT)} src={poster} alt="" decoding="async" referrerPolicy="no-referrer" style={{ "--at": at } as CSSProperties} {...comesIn} />
            ))}
          </span>
        )}
        {place && (
          <span className="tv-place-icon" aria-hidden="true">
            {place}
          </span>
        )}
        {entry.avatar || tool ? (
          <>
            {tool ? (
              <span className="tv-tool-icon" aria-hidden="true">
                {tool}
              </span>
            ) : (
              <span className="tv-person-pic" data-online={entry.online ? "true" : undefined}>
                <Avatar id={entry.avatar!} />
              </span>
            )}
            <span className="tv-person-text">
              <span className="tv-category-name">{entry.title}</span>
              {entry.note && <span className="tv-category-count">{entry.note}</span>}
            </span>
          </>
        ) : (
          <>
            <span className="tv-category-name">{entry.title}</span>
            {entry.note && <span className="tv-category-count">{entry.note}</span>}
          </>
        )}
      </button>
    );
  }

  const under = entry.note ?? entry.year;
  return (
    <button className={`tv-tile tv-tile-${layout}${layout === "ranked" ? "" : " tv-tile-stack"}${poster ? " tv-tile-poster" : ""}${wideCard ? " tv-tile-landscape" : ""}`} data-testid="tv-browse-tile" aria-label={layout === "ranked" ? name : undefined} {...common}>
      {layout === "ranked" && (
        <span className={`tv-rank${rank > 9 ? " tv-rank-wide" : ""}`} aria-hidden="true">
          <b>{rank}</b>
        </span>
      )}
      <span className="tv-tile-art" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
        {showPicture ? (
          <img loading="lazy" {...posterSizes(picture, fit)} src={picture} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} {...comesIn} />
        ) : (
          <span className="tv-tile-initial" aria-hidden="true">
            {name.trim().charAt(0).toUpperCase()}
          </span>
        )}
        {layout === "continue" && (
          <span className="tv-tile-play" aria-hidden="true">
            <PlayIcon />
          </span>
        )}
        {(entry.progress ?? 0) > 0 && (
          <span className="tv-tile-progress" aria-hidden="true">
            <i style={{ width: `${Math.round((entry.progress ?? 0) * 100)}%` }} />
          </span>
        )}
        {score !== undefined && <ScoreBadge score={score} />}
        {corner && <span className="tv-tile-corner" data-corner={corner.kind} data-testid="tv-tile-corner" title={corner.label} aria-hidden="true" />}
      </span>
      {layout !== "ranked" && <span className="tv-tile-name">{name}</span>}
      {layout !== "ranked" && under && <span className={entry.note ? "tv-tile-year" : "tv-tile-year is-year"}>{under}</span>}
    </button>
  );
}, sameTile);

function Feature({ entry, play, list, kept, onOpen, onPlay, onList }: { entry: Entry; play: ReactNode; list: ReactNode; kept: boolean; onOpen: () => void; onPlay: () => void; onList: () => void }) {
  const t = useT();
  const name = useShown(entry).title;
  const plays = entry.kind === "movie";
  const meta = [entry.year, entry.kind === "movie" ? t("library.kindMovie") : entry.kind === "series" ? t("library.kindSeries") : undefined].filter(Boolean).join(" · ");
  return (
    <div className="tv-feature" data-testid="tv-feature">
      <button type="button" className="tv-feature-open" onClick={onOpen} aria-label={`${t("rows.open")} ${name}`} data-testid="tv-feature-open">
        <Poster className="tv-feature-art" title={name} image={sharper(entry.image) ?? entry.backdrop} seed={entry.id} />
      </button>
      <div className="tv-feature-text">
        <h2 className="tv-feature-title">{name}</h2>
        {meta && <p className="tv-feature-meta">{meta}</p>}
        <div className="tv-feature-actions">
          <button type="button" className="tv-hero-button is-primary" onClick={plays ? onPlay : onOpen} data-testid="tv-feature-play">
            {plays ? (
              play
            ) : (
              <>
                <InfoIcon /> {t(entry.kind === "series" ? "player.episodes" : "rows.open")}
              </>
            )}
          </button>
          <button type="button" className="tv-hero-button" onClick={onList} aria-pressed={kept} data-testid="tv-feature-list">
            {list}
          </button>
        </div>
      </div>
    </div>
  );
}
