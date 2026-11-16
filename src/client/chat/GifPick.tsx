import { useEffect } from "react";
import { checkChatText } from "../../shared";
import { Sheet } from "../controller/Sheet";
import { useT } from "../i18n";
import { BackButton, Screen } from "../tv/Idle";
import type { Gif } from "./gifs";
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

/** One GIF of the grid: its picture at the size KLIPY gave, so that the grid does not move as they come. */
function GifButton({ gif, className, onSend, nav }: { gif: Gif; className: string; onSend: () => void; nav: boolean }) {
  const t = useT();
  return (
    <button type="button" className={className} onClick={onSend} aria-label={gif.title ? `${t("chat.gif")}: ${gif.title}` : t("chat.gif")} {...(nav ? { "data-nav": true } : {})} data-testid="chat-gif-pick">
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

/** The phone's: a sheet over the chat, the search box at its top. */
export function GifPickSheet({ name, gifKey, session, onClose }: { name: string; gifKey: string; session: ChatSession; onClose: () => void }) {
  const t = useT();
  const search = useGifSearch(gifKey);
  return (
    <Sheet title={t("chat.gifTo", { name })} onClose={onClose} testId="chat-gif-sheet">
      <div className="chat-gif-pane">
        <GifSearchBox search={search} className="chat-gif-search" testId="chat-gif-search" />
        <GifState search={search} prefix="chat" />
        {search.gifs.length > 0 && (
          <div className="chat-gifs" data-testid="chat-gifs">
            {search.gifs.map((gif, at) => (
              <GifButton
                key={`${at}:${gif.slug}`}
                gif={gif}
                className="chat-gif"
                nav={false}
                onSend={() => {
                  onClose();
                  void send(session, gif);
                }}
              />
            ))}
          </div>
        )}
        {search.more && search.gifs.length > 0 && (
          <button type="button" className="chat-tool chat-gif-more" onClick={search.loadMore} disabled={search.status === "loading"} data-testid="chat-gif-more">
            {search.status === "loading" ? t("common.loading") : t("chat.gifMore")}
          </button>
        )}
        <p className="chat-gif-powered" data-testid="chat-gif-powered">
          {t("chat.gifPowered")}
        </p>
      </div>
    </Sheet>
  );
}

/**
 * The page of a screen that types (a computer, or a hand-held screen showing the TV's pages): the search box first, then the grid the keyboard's arrows walk,
 * OK sends one and goes back to the chat. Back goes back to the chat without sending anything. (A TV that is only a remote has no GIF button: it would be
 * a search typed with the keys of the page.)
 */
export function GifPickTv({ name, gifKey, session, narrow, onBack }: { name: string; gifKey: string; session: ChatSession; narrow: boolean; onBack: () => void }) {
  const t = useT();
  const search = useGifSearch(gifKey);
  // (A hand-held screen lands on nothing: its keyboard would come up over the grid before it is seen. A computer starts in the search box.)
  useEffect(() => {
    if (narrow) return;
    const on = document.activeElement;
    if (on === null || on === document.body) document.querySelector<HTMLElement>("[data-testid='tv-chat-gif-search']")?.focus();
  }, [narrow]);
  return (
    <Screen key="gif" testId="tv-chat-gifs-page" compact focus={!narrow} onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("chat.gifTo", { name })}</h1>
      <GifSearchBox search={search} className="tv-chat-gif-search" testId="tv-chat-gif-search" focusFirst={!narrow} />
      <GifState search={search} prefix="tv-chat" />
      {search.gifs.length > 0 && (
        <div className="tv-chat-gifs" data-testid="tv-chat-gifs">
          {search.gifs.map((gif, at) => (
            <GifButton
              key={`${at}:${gif.slug}`}
              gif={gif}
              className="tv-chat-gif"
              nav
              onSend={() => {
                onBack();
                void send(session, gif);
              }}
            />
          ))}
        </div>
      )}
      {search.more && search.gifs.length > 0 && (
        <button type="button" className="tv-chat-gif-more" onClick={search.loadMore} disabled={search.status === "loading"} data-nav data-testid="tv-chat-gif-more">
          {search.status === "loading" ? t("common.loading") : t("chat.gifMore")}
        </button>
      )}
      <p className="tv-hint tv-chat-gif-powered" data-testid="tv-chat-gif-powered">
        {t("chat.gifPowered")}
      </p>
      <BackButton onClick={onBack} testId="tv-chat-gif-back" />
    </Screen>
  );
}
