import { checkChatText } from "../../shared";
import { useT } from "../i18n";
import type { Gif } from "./gifs";
import { useSavedPictures } from "./saved";
import { SavedPictures } from "./SavedPick";
import type { ChatSession } from "./useChat";
import { useGifSearch, type GifSearch } from "./useGifs";

/**
 * Sending a GIF in the chat (see gifs.ts): a grid of KLIPY's Trending, or of what is searched, in KLIPY's order; a press sends that one at once, through the
 * chat's own send (so what limits a message limits it too, and it is taken back as any message is), and the grid closes. What was being typed stays in the box.
 * The grid asks KLIPY nothing before it is opened.
 */

/** (As any message: the text as the server will keep it, and nothing that it would refuse.) */
const send = async (session: ChatSession, gif: Gif): Promise<boolean> => {
  const checked = checkChatText(gif.sent);
  return checked.ok ? session.send(checked.text) : false;
};

/** What the grid says besides the GIFs: that they are coming, that there are none for these words, that KLIPY could not be asked (and a way to ask again). */
function GifState({ search, prefix }: { search: GifSearch; prefix: string }) {
  const t = useT();
  const { status, gifs, query } = search;
  if (status === "loading" && gifs.length === 0) {
    return (
      <p className={`${prefix}-gif-note`} role="status" data-testid={`${prefix}-gif-loading`}>
        {t("common.loading")}
      </p>
    );
  }
  if (status === "failed" || status === "limited") {
    return (
      <div className={`${prefix}-gif-note`} role="status" data-testid={`${prefix}-gif-failed`}>
        <p>{t(status === "limited" ? "chat.gifLimited" : "chat.gifFailed")}</p>
        <button type="button" className={`${prefix}-gif-retry`} onClick={search.retry} data-nav data-testid={`${prefix}-gif-retry`}>
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (status === "ready" && gifs.length === 0) {
    return (
      <p className={`${prefix}-gif-note`} data-testid={`${prefix}-gif-none`}>
        {t("chat.gifNone", { query: query.trim() })}
      </p>
    );
  }
  return null;
}

/** One GIF of the grid: its picture at the size KLIPY gave, so that the grid does not move as they come. It waits while a message is on its way (see StickerPick.tsx). */
function GifButton({ gif, className, onSend, nav, waiting }: { gif: Gif; className: string; onSend: () => void; nav: boolean; waiting: boolean }) {
  const t = useT();
  return (
    <button type="button" className={className} onClick={onSend} disabled={waiting} aria-label={gif.title ? `${t("chat.gif")}: ${gif.title}` : t("chat.gif")} {...(nav ? { "data-nav": true } : {})} data-testid="chat-gif-pick">
      <img src={gif.thumb} width={gif.width} height={gif.height} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
    </button>
  );
}

/** The search box: "Search KLIPY", as KLIPY asks. */
function GifSearchBox({ search, className, testId, focusFirst = false }: { search: GifSearch; className: string; testId: string; focusFirst?: boolean }) {
  const t = useT();
  return (
    <input
      type="search"
      className={className}
      value={search.query}
      onChange={(event) => search.setQuery(event.target.value.slice(0, 100))}
      placeholder={t("chat.gifSearch")}
      aria-label={t("chat.gifSearch")}
      autoComplete="off"
      autoCapitalize="none"
      enterKeyHint="search"
      maxLength={100}
      data-nav
      {...(focusFirst ? { "data-autofocus": true } : {})}
      data-testid={testId}
    />
  );
}

/**
 * The GIFs of the chat's panel (ChatPanel.tsx): the search box at the top, the grid scrolling under it, KLIPY's line at the bottom. KLIPY is asked nothing
 * until this pane is shown (the panel draws only the pane of its tab). A press sends one, and the panel goes with it. `tv`: drawn for the TV's pages; `nav`:
 * walked with the arrows (a computer, or a hand-held screen showing the TV's pages; a TV that is only a remote has no GIFs: it would be a search typed with
 * the keys of the page).
 */
export function GifPane({ gifKey, session, tv, nav, onSent }: { gifKey: string; session: ChatSession; tv: boolean; nav: boolean; onSent: () => void }) {
  const t = useT();
  const search = useGifSearch(gifKey);
  const saved = useSavedPictures();
  const prefix = tv ? "tv-chat" : "chat";
  // (The GIFs the profile saved, first, while nothing is searched: a grid of their own, apart from KLIPY's Trending, which follows in KLIPY's order under its
  // own heading. A search shows KLIPY's answer only.)
  const withSaved = search.query.trim() === "" && saved.gifs.length > 0;
  return (
    <div className={`${prefix}-gif-pane`} data-testid={`${prefix}-gif-pane`}>
      <GifSearchBox search={search} className={`${prefix}-gif-search`} testId={`${prefix}-gif-search`} />
      <div className={`${prefix}-gif-list${withSaved ? " with-saved" : ""}`} data-testid={`${prefix}-gif-list`}>
        {withSaved && (
          <>
            <SavedPictures kind="gif" session={session} grid={`${prefix}-gifs`} className={`${prefix}-gif`} nav={nav} onSent={onSent} />
            <h2 className="chat-stickers-head chat-gif-head">{t("chat.gifTrending")}</h2>
          </>
        )}
        <GifState search={search} prefix={prefix} />
        {search.gifs.length > 0 && (
          <div className={`${prefix}-gifs`} data-testid={`${prefix}-gifs`}>
            {search.gifs.map((gif, at) => (
              <GifButton
                key={`${at}:${gif.slug}`}
                gif={gif}
                className={`${prefix}-gif`}
                nav={nav}
                waiting={session.sending}
                onSend={() => {
                  if (session.sending) return;
                  onSent();
                  void send(session, gif);
                }}
              />
            ))}
          </div>
        )}
        {search.more && search.gifs.length > 0 && (
          <button
            type="button"
            className={tv ? "tv-chat-gif-more" : "chat-tool chat-gif-more"}
            onClick={search.loadMore}
            disabled={search.status === "loading"}
            {...(nav ? { "data-nav": true } : {})}
            data-testid={`${prefix}-gif-more`}
          >
            {search.status === "loading" ? t("common.loading") : t("chat.gifMore")}
          </button>
        )}
      </div>
      <p className={`${prefix}-gif-powered`} data-testid={`${prefix}-gif-powered`}>
        {t("chat.gifPowered")}
      </p>
    </div>
  );
}

