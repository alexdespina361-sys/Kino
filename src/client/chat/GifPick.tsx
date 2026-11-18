import { checkChatText } from "../../shared";
import { useT } from "../i18n";
import type { Gif } from "./gifs";
import { useSavedPictures } from "./saved";
import { SavedPictures } from "./SavedPick";
import type { ChatSession } from "./useChat";
import { useGifSearch, type GifSearch } from "./useGifs";

const send = async (session: ChatSession, gif: Gif): Promise<boolean> => {
  const checked = checkChatText(gif.sent);
  return checked.ok ? session.send(checked.text) : false;
};

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

function GifButton({ gif, className, onSend, nav, waiting }: { gif: Gif; className: string; onSend: () => void; nav: boolean; waiting: boolean }) {
  const t = useT();
  return (
    <button type="button" className={className} onClick={onSend} disabled={waiting} aria-label={gif.title ? `${t("chat.gif")}: ${gif.title}` : t("chat.gif")} {...(nav ? { "data-nav": true } : {})} data-testid="chat-gif-pick">
      <img src={gif.thumb} width={gif.width} height={gif.height} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
    </button>
  );
}

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

export function GifPane({ gifKey, session, tv, nav, onSent }: { gifKey: string; session: ChatSession; tv: boolean; nav: boolean; onSent: () => void }) {
  const t = useT();
  const search = useGifSearch(gifKey);
  const saved = useSavedPictures();
  const prefix = tv ? "tv-chat" : "chat";
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

