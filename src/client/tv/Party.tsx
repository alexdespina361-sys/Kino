import { useEffect, useRef, useState, type RefObject } from "react";
import { tagLabel, type Message, type PartyTv, type PartyView } from "../../shared";
import { useFriends } from "../friends/FriendsProvider";
import { useAddable, useAddFromParty } from "../friends/useRequests";
import { useT } from "../i18n";
import { pressAgain } from "../shared/backButton";
import { CopyLink } from "../shared/CopyLink";
import { formatCode } from "../shared/format";
import { canPaste, pasteText } from "../shared/clipboard";
import { BackspaceIcon, CheckIcon, ClipboardIcon, CloseIcon, FullscreenIcon, PlusIcon, UsersIcon } from "../shared/icons";
import { partyCodeIn, partyLink } from "../shared/launch";
import { isEditable } from "./keys";
import { QrCode } from "../shared/QrCode";
import { FriendPickerTv, useFriendPicker } from "./Friends";
import { BackButton, Screen } from "./Idle";

type Nav = Record<string, string | number | boolean>;
const PAGE_NAV: Nav = { "data-nav": true };
const PANEL_NAV: Nav = { "data-opt": true, "data-col": 1 };
const PANEL_INVITE_NAV: Nav = { "data-opt": true, "data-col": 0 };
const PANEL_PICK_NAV: Nav = { "data-opt": true, "data-col": 0 };

function MemberActions({ tv, nav, onRemove, onAdmin }: { tv: PartyTv & { host: boolean }; nav: Nav; onRemove?: ((id: string) => void) | undefined; onAdmin?: ((id: string, admin: boolean) => void) | undefined }) {
  const t = useT();
  const addable = useAddable(tv.profile);
  const addFromParty = useAddFromParty();
  const steering = !tv.host && (onAdmin || onRemove);
  if (!addable && !steering) return null;
  return (
    <span className="tv-party-actions">
      {tv.profile && addable && (
        <button
          className="tv-party-remove tv-party-add"
          data-testid="tv-party-add"
          data-state={addable}
          aria-disabled={addable === "asked"}
          aria-label={t("friends.partyAddAria", { name: tagLabel(tv.profile.name, tv.profile.tag) })}
          onClick={() => addable === "add" && void addFromParty(tv.profile!)}
          {...nav}
        >
          {addable === "asked" ? (
            <>
              <CheckIcon /> {t("friends.partyRequested")}
            </>
          ) : (
            <>
              <PlusIcon /> {t("friends.partyAdd")}
            </>
          )}
        </button>
      )}
      {steering && onAdmin && (
        <button className="tv-party-remove" data-testid="tv-party-admin" onClick={() => onAdmin(tv.id, !tv.admin)} {...nav}>
          {t(tv.admin ? "party.removeAdmin" : "party.makeAdmin")}
        </button>
      )}
      {steering && onRemove && (
        <button className="tv-party-remove" data-testid="tv-party-remove" onClick={() => onRemove(tv.id)} {...nav}>
          {t("party.remove")}
        </button>
      )}
    </span>
  );
}

function Members({ party, nav, onRemove, onAdmin }: { party: PartyView; nav: Nav; onRemove?: (id: string) => void; onAdmin?: (id: string, admin: boolean) => void }) {
  const t = useT();
  const all = [
    { ...party.host, host: true },
    ...party.guests.map((guest) => ({ ...guest, host: false })),
  ];
  return (
    <ul className="tv-party-members" data-testid="tv-party-members" aria-label={t("party.members")}>
      {all.map((tv) => (
        <li className="tv-party-member" key={tv.id} data-testid="tv-party-member" data-online={tv.online} data-host={tv.host} data-admin={tv.admin || undefined}>
          <i className="tv-party-dot" aria-hidden="true" />
          <span className="tv-party-name">{tv.name}</span>
          {tv.id === party.you && <small>{t("party.you")}</small>}
          {tv.host && <small>{t("party.host")}</small>}
          {tv.admin && <small>{t("party.admin")}</small>}
          {!tv.online && <small>{t("party.offline")}</small>}
          {tv.id !== party.you && <MemberActions tv={tv} nav={nav} onRemove={onRemove} onAdmin={onAdmin} />}
        </li>
      ))}
    </ul>
  );
}

function Invite({ code, nav }: { code: string | undefined; nav: Nav }) {
  const t = useT();
  return (
    <div className="tv-pair tv-party-invite">
      <ol className="tv-steps">
        <li>
          <span className="tv-step-no">1</span>
          <span>
            {t("party.stepOpen")} <b>{location.host}</b>
          </span>
        </li>
        <li>
          <span className="tv-step-no">2</span>
          <span>{t("party.stepJoin")}</span>
        </li>
        <li>
          <span className="tv-step-no">3</span>
          <span>{t("party.stepCode")}</span>
        </li>
        <li className="tv-code-row">
          <p className="tv-code" data-testid="tv-party-code">
            {code ? formatCode(code) : "…"}
          </p>
        </li>
        {code && (
          <li className="tv-link-row">
            <CopyLink link={partyLink(code)} testId="tv-party-link" buttonClass="tv-action" nav={nav} />
          </li>
        )}
      </ol>
      <div className="tv-qr">
        {code ? <QrCode value={partyLink(code)} label={t("party.qrLabel")} /> : <div className="spinner tv-qr-wait" />}
        <p>{t("party.qrHint")}</p>
      </div>
    </div>
  );
}

interface PageProps {
  party: PartyView | null;
  following: string | null;
  fullscreen: boolean;
  onFullscreen: (() => void) | null;
  error: { id: number; text: string } | null;
  joinWith?: string | null;
  codeEndsAt?: number | null;
  onStart: () => void;
  onJoin: (code: string) => void;
  onRemove: (id: string) => void;
  onAdmin: (id: string, admin: boolean) => void;
  onEnd: () => void;
  onLeave: () => void;
  onBack: () => void;
}

export function PartyPage(p: PageProps) {
  const t = useT();
  const friends = useFriends();
  const [joining, setJoining] = useState(Boolean(p.joinWith));
  const [inviting, setInviting] = useState(false);
  const leaveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (p.following) setJoining(false);
  }, [p.following]);

  if (p.following) {
    return (
      <Screen testId="tv-party-guest" onBack={() => leaveRef.current?.focus()} leaving={() => void (pressAgain("exit.leaveParty") && p.onLeave())}>
        <span className="tv-ready-icon">
          <CheckIcon />
        </span>
        <h1 className="tv-headline" data-testid="tv-following">
          {t("tv.following", { name: p.following })}
        </h1>
        <p className="tv-lead">{t("tv.followingLead")}</p>
        {p.party && <Members party={p.party} nav={PAGE_NAV} />}
        <div className="tv-actions">
          {p.onFullscreen && (
            <button className="tv-action" onClick={p.onFullscreen} data-testid="tv-fullscreen" data-nav>
              <FullscreenIcon /> {t(p.fullscreen ? "remote.exitFullscreen" : "remote.fullscreen")}
            </button>
          )}
          <button ref={leaveRef} className="tv-action" onClick={p.onLeave} data-testid="tv-disconnect" data-nav>
            {t("tv.stopFollowing")}
          </button>
        </div>
      </Screen>
    );
  }

  if (p.party?.role === "host") {
    const invite = p.party.code;
    if (inviting && invite) {
      return (
        <FriendPickerTv
          title={t("friends.inviteFriends")}
          lead={formatCode(invite.code)}
          said="friends.inviteSent"
          build={() => ({ kind: "party", code: invite.code, endsAt: p.codeEndsAt ?? Date.now() + invite.expiresInMs })}
          onClose={() => setInviting(false)}
        />
      );
    }
    return (
      <Screen key="host" testId="tv-party" compact focus onBack={p.onBack}>
        <h1 className="tv-headline tv-headline-small">{t("party.rail")}</h1>
        <Invite code={invite?.code} nav={PAGE_NAV} />
        <Members party={p.party} nav={PAGE_NAV} onRemove={p.onRemove} onAdmin={p.onAdmin} />
        {p.party.guests.length === 0 && <p className="tv-hint">{t("party.waiting")}</p>}
        <div className="tv-actions">
          {friends.on && invite && (
            <button className="tv-action" onClick={() => setInviting(true)} data-testid="tv-party-invite-friends" data-nav>
              <UsersIcon /> {t("friends.inviteFriends")}
            </button>
          )}
          <button className="tv-action" onClick={p.onEnd} data-testid="tv-party-end" data-nav>
            {t("party.end")}
          </button>
        </div>
        <BackButton onClick={p.onBack} testId="tv-back-to-library" label={t("tv.backToLibrary")} autoFocus />
      </Screen>
    );
  }

  if (joining) return <JoinPage error={p.error} {...(p.joinWith ? { initial: p.joinWith } : {})} onJoin={p.onJoin} onBack={() => setJoining(false)} />;

  return (
    <Screen key="start" testId="tv-party" focus onBack={p.onBack}>
      <h1 className="tv-headline">{t("party.rail")}</h1>
      <p className="tv-lead">{t("party.lead")}</p>
      <div className="tv-party-choices">
        <button className="tv-party-choice" onClick={p.onStart} data-testid="tv-party-start" data-nav>
          <UsersIcon />
          <b>{t("party.start")}</b>
          <small>{t("party.startHint")}</small>
        </button>
        <button className="tv-party-choice" onClick={() => setJoining(true)} data-testid="tv-party-join" data-nav>
          <UsersIcon />
          <b>{t("party.join")}</b>
          <small>{t("party.joinHint")}</small>
        </button>
      </div>
      <BackButton onClick={p.onBack} testId="tv-back-to-library" label={t("tv.backToLibrary")} />
    </Screen>
  );
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

function JoinPage({ error, initial, onJoin, onBack }: { error: PageProps["error"]; initial?: string; onJoin: (code: string) => void; onBack: () => void }) {
  const t = useT();
  const [digits, setDigits] = useState(initial ?? "");
  const latest = useRef(digits);
  latest.current = digits;
  const submit = useRef(onJoin);
  submit.current = onJoin;
  const [note, setNote] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [pasting] = useState(canPaste);
  useEffect(() => {
    if (initial?.length === 6) submit.current(initial);
  }, []);

  const put = (text: string) => {
    const code = text.replace(/\D/g, "").slice(0, 6);
    setNote(null);
    if (code === latest.current) return;
    latest.current = code;
    setDigits(code);
    if (code.length === 6) submit.current(code);
  };
  const add = (digit: string) => {
    if (latest.current.length < 6) put(latest.current + digit);
  };
  const remove = () => put(latest.current.slice(0, -1));
  const pasted = (text: string) => {
    const code = partyCodeIn(text);
    if (code) put(code);
    else setNote(t("party.pasteNone"));
  };

  useEffect(() => {
    if (!error) return;
    latest.current = "";
    setDigits("");
  }, [error?.id]);

  const putRef = useRef(put);
  putRef.current = put;
  const pastedRef = useRef(pasted);
  pastedRef.current = pasted;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !/^[0-9]$/.test(event.key) || isEditable(event.target)) return;
      event.preventDefault();
      if (latest.current.length < 6) putRef.current(latest.current + event.key);
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const page = document.querySelector('[data-testid="tv-party-join-page"]');
      if (target && target !== document.body && target !== document.documentElement && !page?.contains(target)) return;
      event.preventDefault();
      pastedRef.current(event.clipboardData?.getData("text") ?? "");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  const pasteNow = async () => {
    const text = await pasteText();
    if (text === null) setNote(t(window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ? "party.pasteRefusedTouch" : "party.pasteRefused"));
    else pasted(text);
  };

  const back = () => (latest.current ? remove() : onBack());
  const shown = error?.text ?? note;

  return (
    <Screen testId="tv-party-join-page" compact focus onBack={back} leaving={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("party.join")}</h1>
      <p className="tv-hint">{t("party.joinHint")}</p>
      <div className="tv-code-line">
        <div className="tv-code-entry" data-typing={typing ? "true" : undefined}>
          <p className="tv-code-boxes" data-testid="tv-party-digits" aria-live="polite">
            {Array.from({ length: 6 }, (_, i) => (
              <i key={i} data-filled={i < digits.length} data-caret={typing && i === digits.length ? "true" : undefined}>
                {digits[i] ?? ""}
              </i>
            ))}
          </p>
          <input
            className="tv-code-field"
            data-testid="tv-party-code-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-label={t("party.codeLabel")}
            value={digits}
            onChange={(event) => put(partyCodeIn(event.target.value) ?? event.target.value)}
            onSelect={(event) => {
              const field = event.currentTarget;
              const end = field.value.length;
              if (field.selectionStart !== end || field.selectionEnd !== end) field.setSelectionRange(end, end);
            }}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
          />
        </div>
        {pasting && (
          <button className="tv-action tv-code-paste" onClick={() => void pasteNow()} data-nav data-testid="tv-party-paste">
            <ClipboardIcon /> {t("party.paste")}
          </button>
        )}
      </div>
      <p className={`tv-party-error${shown ? " is-shown" : ""}${!error && note ? " is-note" : ""}`} role="alert" data-testid="tv-party-error">
        {shown ?? ""}
      </p>
      <div className="tv-pad" role="group" aria-label={t("party.keys")}>
        {DIGITS.map((digit) => (
          <button className="tv-key" key={digit} onClick={() => add(digit)} data-testid={`pad-${digit}`} data-nav {...(digit === "1" ? { "data-autofocus": true } : {})}>
            {digit}
          </button>
        ))}
        <button className="tv-key" onClick={remove} aria-label={t("tv.delete")} data-testid="pad-delete" data-nav>
          <BackspaceIcon />
        </button>
        <button className="tv-key" onClick={() => add("0")} data-testid="pad-0" data-nav>
          0
        </button>
        <button className="tv-key" onClick={onBack} aria-label={t("common.back")} data-testid="pad-back" data-nav>
          <CloseIcon />
        </button>
      </div>
      <BackButton onClick={onBack} testId="tv-party-join-back" />
    </Screen>
  );
}

function InvitePicker({ build, onClose }: { build: () => Message; onClose: () => void }) {
  const t = useT();
  const { all, takers, picked, busy, problem, toggle, send } = useFriendPicker({ build, said: "friends.inviteSent", onClose });
  const cannotSend = busy || picked.size === 0;

  if (takers.length === 0) {
    return (
      <div className="tv-party-pick" data-testid="tv-friend-picker">
        <p className="tv-hint" data-testid="tv-friend-picker-none">
          {all.length === 0 ? t("friends.noFriends") : t("friends.nobody")}
        </p>
        <button className="tv-opt" onClick={onClose} data-testid="tv-friend-cancel" data-autofocus {...PANEL_PICK_NAV}>
          <span>{t("common.done")}</span>
          <CheckIcon />
        </button>
      </div>
    );
  }
  return (
    <div className="tv-party-pick" data-testid="tv-friend-picker">
      <div className="tv-opts" role="group" aria-label={t("friends.inviteFriends")}>
        {takers.map((friend, index) => (
          <button
            key={friend.id}
            className="tv-opt"
            aria-pressed={picked.has(friend.id)}
            data-active={picked.has(friend.id)}
            onClick={() => toggle(friend.id)}
            data-testid="tv-friend-pick"
            data-friend={friend.id}
            {...(index === 0 ? { "data-autofocus": true } : {})}
            {...PANEL_PICK_NAV}
          >
            <span>{friend.name}</span>
            {picked.has(friend.id) ? <CheckIcon /> : <PlusIcon />}
          </button>
        ))}
      </div>
      {problem && (
        <p className="tv-hint tv-party-pick-problem" role="alert">
          {problem}
        </p>
      )}
      <button className="tv-opt" aria-disabled={cannotSend} onClick={() => !cannotSend && void send()} data-testid="tv-friend-send" {...PANEL_PICK_NAV}>
        <span>{t("friends.send")}</span>
      </button>
      <button className="tv-opt" onClick={onClose} data-testid="tv-friend-cancel" {...PANEL_PICK_NAV}>
        <span>{t("common.cancel")}</span>
      </button>
    </div>
  );
}

interface PanelProps {
  party: PartyView | null;
  following: string | null;
  rootRef: RefObject<HTMLDivElement | null>;
  inviting: boolean;
  codeEndsAt?: number | null;
  onInviting: (on: boolean) => void;
  onClose: () => void;
  onStart: () => void;
  onRemove: (id: string) => void;
  onAdmin: (id: string, admin: boolean) => void;
  onEnd: () => void;
  onLeave: () => void;
}

export function PartyPanel(p: PanelProps) {
  const t = useT();
  const friends = useFriends();
  const host = p.party?.role === "host";
  const code = p.party?.code;
  const canInvite = host && friends.on && Boolean(code);
  const picking = p.inviting && canInvite;

  const inviteRef = useRef<HTMLButtonElement>(null);
  const wasPicking = useRef(false);
  useEffect(() => {
    if (wasPicking.current && !picking) inviteRef.current?.focus();
    wasPicking.current = picking;
  }, [picking]);

  const had = useRef<Element | null>(null);
  useEffect(() => {
    const root = p.rootRef.current;
    if (!root) return;
    if (root.contains(document.activeElement)) had.current = document.activeElement;
    else if (!had.current?.isConnected) (root.querySelector<HTMLElement>("[data-autofocus]") ?? root.querySelector<HTMLElement>("[data-opt]"))?.focus();
  });

  return (
    <div className="tv-menu-backdrop" data-kind="party" onClick={p.onClose}>
      <div
        className="tv-menu"
        ref={p.rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("party.rail")}
        data-testid="tv-party-panel"
        data-kind="party"
        data-cols={host && !picking ? 2 : 1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tv-menu-top">
          <h2>{picking ? t("friends.inviteFriends") : t("party.rail")}</h2>
          <button className="tv-btn tv-btn-icon" data-menu-close onClick={p.onClose} aria-label={t("common.close")} title={t("common.close")}>
            <CloseIcon />
          </button>
        </div>

        {picking && code && (
          <InvitePicker build={() => ({ kind: "party", code: code.code, endsAt: p.codeEndsAt ?? Date.now() + code.expiresInMs })} onClose={() => p.onInviting(false)} />
        )}

        {!picking && !p.party && !p.following && (
          <div className="tv-party-start">
            <p>{t("party.overlayLead")}</p>
            <button className="tv-opt" onClick={p.onStart} data-testid="tv-party-start" {...PANEL_NAV}>
              <span>{t("party.start")}</span>
              <UsersIcon />
            </button>
          </div>
        )}

        {!picking && p.party && (
          <div className="tv-menu-cols">
            {host && (
              <div className="tv-menu-col tv-party-invite-col">
                <Invite code={p.party.code?.code} nav={PANEL_INVITE_NAV} />
              </div>
            )}
            <div className="tv-menu-col tv-party-side">
              <h3>{t("party.members")}</h3>
              <Members party={p.party} nav={PANEL_NAV} {...(host ? { onRemove: p.onRemove, onAdmin: p.onAdmin } : {})} />
              {host && p.party.guests.length === 0 && <p className="tv-hint">{t("party.waiting")}</p>}
              <button className="tv-opt" onClick={p.onClose} data-testid="tv-party-done" data-autofocus {...PANEL_NAV}>
                <span>{t("common.done")}</span>
                <CheckIcon />
              </button>
              {canInvite && (
                <button ref={inviteRef} className="tv-opt" onClick={() => p.onInviting(true)} data-testid="tv-party-invite-friends" {...PANEL_NAV}>
                  <span>{t("friends.inviteFriends")}</span>
                  <UsersIcon />
                </button>
              )}
              <button className="tv-opt" onClick={host ? p.onEnd : p.onLeave} data-testid={host ? "tv-party-end" : "tv-party-leave"} {...PANEL_NAV}>
                <span>{host ? t("party.end") : t("party.leave")}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
