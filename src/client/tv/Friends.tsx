import { useEffect, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { friendChoices, friendLink, friendSwitchWrites, parseTag, reachable, sunsetSwitches, tagLabel, type FriendSetting, type Message, type OpenInvite, type Person, type PlanItem, type SunsetSwitch } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { describeError } from "../account/errors";
import { useSettings } from "../account/settings";
import { clockTime, dayChip, formatDay } from "../account/time";
import { CHAT_FACTS } from "../chat/state";
import { nameOf } from "../friends/entries";
import { useFriends, useQuickLooks } from "../friends/FriendsProvider";
import { bellRows, type BellRow } from "../friends/pages";
import { PLAN_DAYS, PLAN_HOURS, defaultPlan, planLines, planMoment, planOffered, planStatus, whenLabel } from "../friends/plans";
import { useAnswerRequests, useTagAsk } from "../friends/useRequests";
import { useBell } from "../friends/useBell";
import { ShownTitle } from "../shared/Shown";
import { BELL_TITLES, entryOfNotice, noticeLine, useTitleNotices } from "../titleNotices/notices";
import { useCleared } from "../friends/useCleared";
import { useClearChat } from "../chat/useClearChat";
import { withoutChat } from "../chat/apart";
import { usePeek } from "../friends/usePeek";
import { useLanguage, useT, type Key } from "../i18n";
import { CopyCode } from "../shared/CopyLink";
import { BellIcon, CheckIcon, ClockIcon, CloseIcon, PlayIcon, PlusIcon, SearchIcon, UsersIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { QrCode } from "../shared/QrCode";
import { BACK_MS, stillScreen, useSwipeAway } from "../shared/swipe";
import { BackButton, Screen } from "./Idle";
import type { Entry } from "./pages";
import "./friends.css";

export function useFriendPicker({ build, said, onClose }: { build: () => Message; said: "friends.sent" | "friends.inviteSent"; onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const all = friends.state?.friends ?? [];
  const takers = reachable(all);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(takers.length === 1 ? [takers[0]!.id] : []));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = (id: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await friends.send([...picked], build());
      const names = (ids: readonly string[]) => ids.map((id) => nameOf(all, id)).filter(Boolean).join(", ");
      const told: string[] = [];
      if (answer.sent.length > 0) told.push(t(said, { names: names(answer.sent) }));
      if (answer.declined.length > 0) told.push(t(answer.declined.length > 1 ? "friends.declinedMany" : "friends.declined", { names: names(answer.declined) }));
      if (told.length > 0) account.say(told.join(". "));
      onClose();
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return { all, takers, picked, busy, problem, toggle, send };
}

export function FriendPickerTv({ title, lead, build, said, onClose }: { title: string; lead: string; build: () => Message; said: "friends.sent" | "friends.inviteSent"; onClose: () => void }) {
  const t = useT();
  const { all, takers, picked, busy, problem, toggle, send } = useFriendPicker({ build, said, onClose });

  return (
    <Screen testId="tv-friend-picker" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{title}</h1>
      <p className="tv-lead">{lead}</p>
      {takers.length === 0 ? (
        <>
          <p className="tv-hint" data-testid="tv-friend-picker-none">
            {all.length === 0 ? t("friends.noFriends") : t("friends.nobody")}
          </p>
          <div className="tv-actions">
            <button className="tv-action tv-action-primary" onClick={onClose} data-nav data-autofocus data-testid="tv-friend-cancel">
              {t("common.done")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="tv-list-picks" role="group" aria-label={title}>
            {takers.map((friend) => (
              <button key={friend.id} className="tv-action" aria-pressed={picked.has(friend.id)} onClick={() => toggle(friend.id)} data-nav data-testid="tv-friend-pick" data-friend={friend.id}>
                {picked.has(friend.id) ? <CheckIcon /> : <PlusIcon />} {friend.name}
              </button>
            ))}
          </div>
          {problem && (
            <p className="tv-lead tv-signin-status is-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="tv-actions">
            <button className="tv-action tv-action-primary" disabled={busy || picked.size === 0} onClick={() => void send()} data-nav data-testid="tv-friend-send">
              {t("friends.send")}
            </button>
            <button className="tv-action" onClick={onClose} data-nav data-testid="tv-friend-cancel">
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}
    </Screen>
  );
}

const PAGE_NAV = { "data-nav": true };

function GiveCode({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const t = useT();
  const language = useLanguage();
  const friends = useFriends();
  const [problem, setProblem] = useState<string | null>(null);
  const asked = useRef(false);
  const shown = useRef(false);
  const takingBack = useRef(false);
  const codeText = useRef<HTMLParagraphElement>(null);
  const friendsThen = useRef(0);
  const friendCount = friends.state?.friends.length ?? 0;
  const invite = (friends.state?.invites ?? []).reduce<OpenInvite | undefined>((newest, each) => (!newest || each.expiresAt > newest.expiresAt ? each : newest), undefined);
  useQuickLooks(invite !== undefined);

  useEffect(() => {
    if (shown.current && !takingBack.current && friendCount > friendsThen.current) {
      onDone();
    } else if (invite) {
      if (!shown.current) friendsThen.current = friendCount;
      shown.current = true;
    } else if (shown.current && !takingBack.current) {
      shown.current = false;
      asked.current = false;
    }
  }, [invite?.code]);
  useEffect(() => {
    if (invite || asked.current || !friends.state) return;
    asked.current = true;
    friends.invite().catch((error: unknown) => setProblem(describeError(error)));
  }, [invite, friends.state]);

  return (
    <Screen key="give" testId="tv-friend-give-page" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("friends.makeCode")}</h1>
      {invite ? (
        <div className="tv-pair tv-party-invite">
          <div className="tv-friend-code">
            <p className="tv-code tv-link-code copy-code-text" ref={codeText} data-testid="tv-friend-code">
              {typedLinkCode(invite.code)}
            </p>
            <CopyCode code={typedLinkCode(invite.code)} shown={codeText} testId="tv-friend-code-copy" buttonClass="tv-action" nav={PAGE_NAV} />
            <p className="tv-hint">{t("friends.codeHelp", { day: formatDay(invite.expiresAt, language) })}</p>
          </div>
          <div className="tv-qr">
            <QrCode value={friendLink(invite.code, location.origin)} label={t("friends.qrLabel")} />
            <p>{t("friends.qrHint")}</p>
          </div>
        </div>
      ) : problem ? (
        <p className="tv-lead tv-signin-status is-problem" role="alert">
          {problem}
        </p>
      ) : (
        <p className="tv-lead" role="status">
          <span className="spinner" /> {t("common.loading")}
        </p>
      )}
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" onClick={onBack} data-nav data-autofocus data-testid="tv-friend-give-done">
          {t("common.done")}
        </button>
        {invite && (
          <button
            className="tv-action"
            onClick={() => {
              takingBack.current = true;
              void friends.revoke(invite.code).then(onBack, () => (takingBack.current = false));
            }}
            data-nav
            data-testid="tv-friend-revoke"
          >
            {t("friends.takeBack")}
          </button>
        )}
      </div>
    </Screen>
  );
}

function TypedCode({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const { seen, problem: found } = usePeek(code);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = refused ?? found;

  const add = async () => {
    setBusy(true);
    setRefused(null);
    try {
      const friend = await friends.accept(code);
      account.say(t("friends.added", { name: friend.name }));
      onDone();
    } catch (error) {
      setRefused(describeError(error));
      setBusy(false);
    }
  };

  if (problem) {
    return (
      <p className="tv-lead tv-signin-status is-problem" role="alert" data-testid="tv-friend-code-error">
        {problem}
      </p>
    );
  }
  if (!seen) {
    return (
      <p className="tv-lead" role="status">
        <span className="spinner" /> {t("friends.linkLooking")}
      </p>
    );
  }
  return (
    <div className="tv-friend-found" data-testid="tv-friend-found">
      <Avatar id={seen.from.avatar} className="tv-friend-avatar" />
      <p className="tv-friend-ask">
        <b data-testid="tv-friend-code-name">{seen.from.name}</b>
        <span>{t("friends.addAsk")}</span>
      </p>
      <button className="tv-action tv-action-primary" disabled={busy} onClick={() => void add()} data-nav data-testid="tv-friend-code-add">
        {t("friends.addButton")}
      </button>
    </div>
  );
}

function TypeCode({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const code = linkCodeOf(typed);
  return (
    <Screen key="type" testId="tv-friend-type-page" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("friends.typeTitle")}</h1>
      <form className="auth-form auth-tv" onSubmit={(event) => event.preventDefault()} noValidate>
        <label className="auth-field">
          <span>{t("friends.codeLabel")}</span>
          <input
            className="tv-link-input"
            data-testid="tv-friend-code-input"
            data-nav
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={9}
            placeholder="ABCD-2345"
            value={typed}
            onChange={(event) => setTyped(typedLinkCode(event.target.value))}
          />
        </label>
      </form>
      {code && <TypedCode key={code} code={code} onDone={onDone} />}
      <BackButton onClick={onBack} testId="tv-friend-type-back" />
    </Screen>
  );
}

function TaggedFriend({ text, onDone }: { text: string; onDone: () => void }) {
  const t = useT();
  const { seen, problem, waiting, busy, send } = useTagAsk(text, onDone);
  if (problem) {
    return (
      <p className="tv-lead tv-signin-status is-problem" role="alert" data-testid="tv-friend-tag-error">
        {problem}
      </p>
    );
  }
  if (!seen) {
    return (
      <p className="tv-lead" role="status">
        <span className="spinner" /> {t("friends.linkLooking")}
      </p>
    );
  }
  return (
    <div className="tv-friend-found" data-testid="tv-friend-tag-found">
      <Avatar id={seen.avatar} className="tv-friend-avatar" />
      <p className="tv-friend-ask">
        <b data-testid="tv-friend-tag-name">{tagLabel(seen.name, seen.tag)}</b>
        <span>{t("friends.tagAsk")}</span>
      </p>
      <button className="tv-action tv-action-primary" disabled={busy || waiting} onClick={() => void send()} data-nav data-testid="tv-friend-tag-send">
        {waiting ? t("friends.requestPending") : t("friends.requestButton")}
      </button>
    </div>
  );
}

function TypeTag({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [looked, setLooked] = useState("");
  const wanted = parseTag(typed);
  const find = () => wanted && setLooked(typed.trim());
  return (
    <Screen key="tag" testId="tv-friend-tag-page" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("friends.tagTitle")}</h1>
      <form
        className="auth-form auth-tv"
        onSubmit={(event) => {
          event.preventDefault();
          find();
        }}
        noValidate
      >
        <label className="auth-field">
          <span>{t("friends.tagLabel")}</span>
          <input
            className="tv-tag-input"
            data-testid="tv-friend-tag-input"
            data-nav
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={30}
            placeholder={t("friends.tagPlaceholder")}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setLooked("");
            }}
          />
        </label>
      </form>
      {looked && <TaggedFriend key={looked} text={looked} onDone={onDone} />}
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" disabled={!wanted} onClick={find} data-nav data-testid="tv-friend-tag-find">
          {t("friends.tagFind")}
        </button>
      </div>
      <BackButton onClick={onBack} testId="tv-friend-tag-back" />
    </Screen>
  );
}

export function AddFriendTv({ onClose }: { onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const [mode, setMode] = useState<"choose" | "give" | "type" | "tag">("choose");
  if (mode === "give") return <GiveCode onBack={() => setMode("choose")} onDone={onClose} />;
  if (mode === "type") return <TypeCode onBack={() => setMode("choose")} onDone={onClose} />;
  if (mode === "tag") return <TypeTag onBack={() => setMode("choose")} onDone={onClose} />;
  const mine = account.profile?.tag !== undefined ? tagLabel(account.profile.name, account.profile.tag) : undefined;
  return (
    <Screen key="choose" testId="tv-add-friend" focus onBack={onClose}>
      <h1 className="tv-headline">{t("friends.add")}</h1>
      <div className="tv-party-choices tv-friend-choices">
        <button className="tv-party-choice" onClick={() => setMode("give")} data-nav data-testid="tv-friend-give">
          <UsersIcon />
          <b>{t("friends.makeCode")}</b>
          <small>{t("friends.giveHint")}</small>
        </button>
        <button className="tv-party-choice" onClick={() => setMode("type")} data-nav data-testid="tv-friend-type">
          <UsersIcon />
          <b>{t("friends.typeTitle")}</b>
          <small>{t("friends.typeHint")}</small>
        </button>
        <button className="tv-party-choice" onClick={() => setMode("tag")} data-nav data-testid="tv-friend-tag">
          <SearchIcon />
          <b>{t("friends.tagTitle")}</b>
          <small>{t("friends.tagHint")}</small>
        </button>
      </div>
      {mine && (
        <p className="tv-hint" data-testid="tv-your-tag">
          {t("friends.yourTag")}: <b>{mine}</b>
        </p>
      )}
      <BackButton onClick={onClose} testId="tv-friend-add-back" />
    </Screen>
  );
}

export function FriendRequestTv({ person, onClose }: { person: Person; onClose: () => void }) {
  const t = useT();
  const answer = useAnswerRequests();
  const [busy, setBusy] = useState(false);
  const respond = async (work: Promise<void>) => {
    setBusy(true);
    await work;
    onClose();
  };
  return (
    <Screen testId="tv-friend-request" compact focus onBack={onClose}>
      <div className="tv-friend-found">
        <Avatar id={person.avatar} className="tv-friend-avatar" />
        <p className="tv-friend-ask">
          <b data-testid="tv-friend-request-name">{tagLabel(person.name, person.tag)}</b>
          <span>{t("friends.requestWants")}</span>
        </p>
      </div>
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" disabled={busy} onClick={() => void respond(answer.accept(person))} data-nav data-autofocus data-testid="tv-friend-request-accept">
          {t("friends.accept")}
        </button>
        <button className="tv-action" disabled={busy} onClick={() => void respond(answer.decline(person))} data-nav data-testid="tv-friend-request-decline">
          {t("friends.decline")}
        </button>
      </div>
      <BackButton onClick={onClose} testId="tv-friend-request-back" />
    </Screen>
  );
}

export function PlanTv({ id, onStartParty, onClose }: { id: string; onStartParty: (friendId: string) => void; onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const [busy, setBusy] = useState(false);
  const item = friends.state?.inbox.find((each): each is PlanItem => each.id === id && each.kind === "plan");
  const now = Date.now();
  const status = item ? planStatus(item, now) : "lapsed";
  useEffect(() => {
    if (friends.state && status === "lapsed") onClose();
  }, [friends.state, status]);
  if (!item || status === "lapsed") return null;
  const lines = planLines(item, nameOf(friends.state?.friends ?? [], item.from), now);

  const answer = async (yes: boolean) => {
    setBusy(true);
    try {
      await friends.answerPlan(item.id, yes);
      onClose();
    } catch (error) {
      account.say(describeError(error));
      void friends.refresh();
      setBusy(false);
    }
  };

  return (
    <Screen testId="tv-plan" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small" data-testid="tv-plan-heading">
        {lines.heading}
      </h1>
      <p className="tv-lead" data-testid="tv-plan-detail">
        {lines.detail}
      </p>
      <div className="tv-actions">
        {status === "asks" ? (
          <>
            <button className="tv-action tv-action-primary" disabled={busy} onClick={() => void answer(true)} data-nav data-autofocus data-testid="tv-plan-accept">
              {t("friends.accept")}
            </button>
            <button className="tv-action" disabled={busy} onClick={() => void answer(false)} data-nav data-testid="tv-plan-decline">
              {t("friends.decline")}
            </button>
          </>
        ) : (
          <>
            {status === "due" && (
              <button className="tv-action tv-action-primary" onClick={() => onStartParty(item.from)} data-nav data-autofocus data-testid="tv-plan-start">
                {t("friends.startParty")}
              </button>
            )}
            <button className={status === "due" ? "tv-action" : "tv-action tv-action-primary"} onClick={onClose} data-nav {...(status === "due" ? {} : { "data-autofocus": true })} data-testid="tv-plan-ok">
              {t("common.done")}
            </button>
            <button
              className="tv-action"
              onClick={() => {
                void friends.dismiss(item.id).catch(() => undefined);
                onClose();
              }}
              data-nav
              data-testid="tv-plan-dismiss"
            >
              {t("friends.dismiss")}
            </button>
          </>
        )}
      </div>
      <BackButton onClick={onClose} testId="tv-plan-back" />
    </Screen>
  );
}

export function PlanPickerTv({ friendId, onClose }: { friendId: string; onClose: () => void }) {
  const t = useT();
  const language = useLanguage();
  const account = useAccount();
  const friends = useFriends();
  const name = nameOf(friends.state?.friends ?? [], friendId);
  const [opened] = useState(() => Date.now());
  const [chosen, setChosen] = useState(() => defaultPlan(opened));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const offered = (day: number, hour: number) => planOffered(planMoment(opened, day, hour), Date.now());
  const pickDay = (day: number) => setChosen((now) => ({ day, hour: offered(day, now.hour) ? now.hour : (PLAN_HOURS.find((hour) => offered(day, hour)) ?? now.hour) }));
  const when = planMoment(opened, chosen.day, chosen.hour);

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await friends.send([friendId], { kind: "plan", when });
      if (answer.sent.length === 0) {
        setProblem(t("friends.declined", { names: name }));
        void friends.refresh();
        setBusy(false);
        return;
      }
      account.say(t("friends.planSent", { name }));
      onClose();
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return (
    <Screen testId="tv-plan-picker" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("friends.planTitle", { name })}</h1>
      <div className="tv-plan-picks" role="radiogroup" aria-label={t("friends.planDay")} data-testid="tv-plan-days">
        {Array.from({ length: PLAN_DAYS }, (_, day) => (
          <button
            key={day}
            className="tv-action"
            role="radio"
            aria-checked={chosen.day === day}
            disabled={!PLAN_HOURS.some((hour) => offered(day, hour))}
            onClick={() => pickDay(day)}
            data-nav
            {...(chosen.day === day ? { "data-autofocus": true } : {})}
            data-testid="tv-plan-day"
            data-day={day}
          >
            {dayChip(planMoment(opened, day, 12), opened, language)}
          </button>
        ))}
      </div>
      <div className="tv-plan-picks" role="radiogroup" aria-label={t("friends.planTime")} data-testid="tv-plan-hours">
        {PLAN_HOURS.map((hour) => (
          <button key={hour} className="tv-action" role="radio" aria-checked={chosen.hour === hour} disabled={!offered(chosen.day, hour)} onClick={() => setChosen({ ...chosen, hour })} data-nav data-testid="tv-plan-hour" data-hour={hour}>
            {clockTime(planMoment(opened, chosen.day, hour), language)}
          </button>
        ))}
      </div>
      <p className="tv-lead tv-plan-summary" data-testid="tv-plan-summary">
        <ClockIcon /> {whenLabel(when, Date.now())}
      </p>
      {problem && (
        <p className="tv-lead tv-signin-status is-problem" role="alert" data-testid="tv-plan-error">
          {problem}
        </p>
      )}
      <p className="tv-hint tv-plan-notice" data-testid="tv-plan-notice">
        {t("friends.planNotice", { name })}
      </p>
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" disabled={busy || !offered(chosen.day, chosen.hour)} onClick={() => void send()} data-nav data-testid="tv-plan-send">
          {t("friends.planSend")}
        </button>
        <button className="tv-action" onClick={onClose} data-nav data-testid="tv-plan-cancel">
          {t("common.cancel")}
        </button>
      </div>
    </Screen>
  );
}

const LEAVE_MS = 380;

const keyLit = (element: Element): boolean => {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
};

function BellLine({
  row,
  at,
  onPress,
  onClear,
  testId = "tv-bell-item",
}: {
  row: BellRow;
  at: number;
  onPress: (entry: Entry) => void;
  onClear?: ((button: HTMLElement | null) => void) | undefined;
  testId?: string;
}) {
  const t = useT();
  const { entry } = row;
  const card = useRef<HTMLLIElement>(null);
  const [lit, setLit] = useState<"line" | "clear" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const clearedAt = useRef(-Infinity);
  const leave = (button: HTMLElement | null) => {
    if (!onClear || Date.now() - clearedAt.current < LEAVE_MS + BACK_MS) return;
    clearedAt.current = Date.now();
    const element = card.current;
    if (!element || stillScreen()) return onClear(button);
    element.style.setProperty("--h", `${element.offsetHeight}px`);
    setLeaving(true);
    window.setTimeout(() => onClear(button), LEAVE_MS);
  };
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), LEAVE_MS + BACK_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const { style: swiped, ...swipe } = useSwipeAway(onClear ? () => leave(null) : undefined);
  const light = (part: "line" | "clear") => (event: FocusEvent<HTMLElement>) => setLit(keyLit(event.currentTarget) ? part : null);
  const unlight = () => setLit(null);
  return (
    <li ref={card} className="tv-bell-row" data-lit={lit ?? undefined} data-leaving={leaving ? "true" : undefined} data-clears={onClear ? "true" : undefined} style={{ ...swiped, "--i": at } as CSSProperties} {...swipe}>
      <button className="tv-bell-line" onClick={() => onPress(entry)} onFocus={light("line")} onBlur={unlight} data-nav data-testid={testId} data-entry={entry.id}>
        <span className="tv-bell-icon">{row.avatar ? <Avatar id={row.avatar} className="tv-bell-avatar" /> : entry.plan ? <ClockIcon /> : entry.party || entry.wants || entry.ask ? <UsersIcon /> : <PlayIcon />}</span>
        <span className="tv-bell-text">
          <b>{row.notice ? <ShownTitle of={entry} /> : row.heading}</b>
          {row.detail && <small>{row.detail}</small>}
        </span>
      </button>
      {onClear && (
        <button
          className="tv-bell-clear"
          onClick={(event) => leave(event.currentTarget)}
          onFocus={light("clear")}
          onBlur={unlight}
          data-nav
          aria-label={`${t("friends.dismiss")}: ${row.heading}`}
          title={t("friends.dismiss")}
          data-testid="tv-bell-clear"
        >
          <CloseIcon />
        </button>
      )}
    </li>
  );
}

export function NotificationsTv({ onPress, onFriends, onClose, chatsApart = false }: { onPress: (entry: Entry) => void; onFriends: () => void; onClose: () => void; chatsApart?: boolean }) {
  const t = useT();
  const friends = useFriends();
  const { markSeen, seen } = useBell();
  const [seenBefore] = useState(seen);
  const { cleared, clear } = useCleared();
  const clearChat = useClearChat();
  const { waiting, joined, lately, more } = bellRows(chatsApart && friends.state ? withoutChat(friends.state) : friends.state, Date.now(), cleared, seenBefore);
  const titles = useTitleNotices();
  const fresh = titles.items.slice(0, BELL_TITLES).map((notice): BellRow => ({ entry: entryOfNotice(notice), heading: notice.title, detail: noticeLine(notice), notice: notice.id }));
  const page = useRef<HTMLDivElement>(null);
  const clearLine = (row: BellRow, button: HTMLElement | null) => {
    const active = document.activeElement;
    if (button && (active === button || !active || active === document.body)) {
      const crosses = [...(page.current?.querySelectorAll<HTMLElement>("[data-testid=tv-bell-clear]") ?? [])].filter((each) => each === button || !each.closest('[data-leaving="true"]'));
      const at = crosses.indexOf(button);
      const left = crosses.filter((each) => each !== button);
      if (at >= 0) (left[Math.min(at, left.length - 1)] ?? page.current?.parentElement?.querySelector<HTMLElement>("[data-testid=tv-bell-friends]"))?.focus();
    }
    if (row.notice) titles.dismiss(row.notice);
    else if (row.activity) clear([row.activity]);
    else if (row.entry.inboxId) void friends.dismiss(row.entry.inboxId).catch(() => undefined);
    else if (row.entry.chat) clearChat(row.entry.chat);
  };

  useEffect(() => {
    void friends.refresh();
    markSeen();
  }, []);
  useEffect(() => {
    if (friends.unread > 0) void friends.markRead().catch(() => undefined);
  }, [friends.unread]);
  useEffect(() => {
    if (titles.unread > 0) titles.seen();
  }, [titles.unread]);

  return (
    <Screen testId="tv-bell-page" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("bell.title")}</h1>
      {!friends.state && friends.on ? (
        <p className="tv-lead" role="status">
          <span className="spinner" /> {friends.status === "offline" ? t("friends.offline") : t("common.loading")}
        </p>
      ) : waiting.length === 0 && fresh.length === 0 && joined.length === 0 && lately.length === 0 ? (
        <div className="tv-bell-empty" data-testid="tv-bell-empty">
          <span className="tv-bell-empty-icon" aria-hidden="true">
            <BellIcon />
          </span>
          <p className="tv-bell-empty-title">{t("bell.emptyTitle")}</p>
          <p className="tv-bell-empty-text">{t("bell.empty")}</p>
        </div>
      ) : (
        <div className="tv-bell-lists" ref={page}>
          {waiting.length > 0 && (
            <section>
              <h2 className="tv-bell-heading">{t("bell.waiting")}</h2>
              <ul className="tv-bell-list" data-testid="tv-bell-waiting">
                {waiting.map((row, at) => (
                  <BellLine key={row.entry.id} row={row} at={at} onPress={onPress} onClear={row.entry.inboxId || row.entry.chat ? (button) => clearLine(row, button) : undefined} />
                ))}
              </ul>
              {more > 0 && (
                <p className="tv-hint" data-testid="tv-bell-more">
                  {t("bell.more", { count: more })}
                </p>
              )}
            </section>
          )}
          {fresh.length > 0 && (
            <section>
              <h2 className="tv-bell-heading">{t("bell.newTitles")}</h2>
              <ul className="tv-bell-list" data-testid="tv-bell-titles">
                {fresh.map((row, at) => (
                  <BellLine key={row.entry.id} row={row} at={waiting.length + at} onPress={onPress} onClear={(button) => clearLine(row, button)} testId="tv-bell-title" />
                ))}
              </ul>
            </section>
          )}
          {joined.length > 0 && (
            <section>
              <h2 className="tv-bell-heading">{t("bell.joined")}</h2>
              <ul className="tv-bell-list" data-testid="tv-bell-joined">
                {joined.map((row, at) => (
                  <BellLine key={row.entry.id} row={row} at={waiting.length + at} onPress={onPress} testId="tv-bell-joined-item" />
                ))}
              </ul>
            </section>
          )}
          {lately.length > 0 && (
            <section>
              <h2 className="tv-bell-heading">{t("friends.activity")}</h2>
              <ul className="tv-bell-list" data-testid="tv-bell-lately">
                {lately.map((row, at) => (
                  <BellLine key={row.entry.id} row={row} at={waiting.length + joined.length + at} onPress={onPress} onClear={(button) => clearLine(row, button)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {friends.on && (
        <div className="tv-actions">
          <button className="tv-action tv-action-primary" onClick={onFriends} data-nav data-testid="tv-bell-friends">
            {t("bell.openFriends")}
          </button>
        </div>
      )}
      <BackButton onClick={onClose} testId="tv-bell-back" />
    </Screen>
  );
}

export function UnfriendTv({ id, name, onCancel, onGone }: { id: string; name: string; onCancel: () => void; onGone: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await friends.remove(id);
      account.say(t("friends.removed", { name }));
      onGone();
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return (
    <Screen testId="tv-friend-unfriend" compact focus onBack={onCancel}>
      <h1 className="tv-headline tv-headline-small">{t("friends.removeTitle", { name })}</h1>
      <p className="tv-lead tv-friend-help">{t("friends.removeHelp")}</p>
      {problem && (
        <p className="tv-lead tv-signin-status is-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" onClick={onCancel} data-nav data-autofocus data-testid="tv-friend-unfriend-cancel">
          {t("common.cancel")}
        </button>
        <button className="tv-action tv-action-danger" disabled={busy} onClick={() => void remove()} data-nav data-testid="tv-friend-unfriend-yes">
          {t("friends.removeYes")}
        </button>
      </div>
    </Screen>
  );
}

const SUNSET_ROWS: ReadonlyArray<{ key: Exclude<SunsetSwitch, "newsPopups">; label: Key; testId: string }> = [
  { key: "friendsLists", label: "friends.switchLists", testId: "tv-friends-lists" },
  { key: "friendsRatings", label: "friends.switchRatings", testId: "tv-friends-ratings" },
  { key: "friendsInbox", label: "friends.switchInbox", testId: "tv-friends-inbox" },
  { key: "friendsPresence", label: "friends.switchPresence", testId: "tv-friends-presence" },
  { key: "friendsMessages", label: "chat.settingsSwitch", testId: "tv-friends-messages" },
];

export function FriendSettingsTv({ onClose }: { onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const { settings, set } = useSettings();
  const choices = friendChoices(settings);
  const [sunset] = useState(() => sunsetSwitches(settings));
  const row = (key: FriendSetting, label: Key, testId: string) => (
    <button
      key={key}
      className="tv-switch-row"
      role="switch"
      aria-checked={choices[key]}
      onClick={() => {
        for (const [name, value] of friendSwitchWrites(settings, key, !choices[key])) set(name, value);
        account.syncNow();
      }}
      data-nav
      data-testid={testId}
    >
      <span>{t(label)}</span>
      <span className="tv-switch" aria-hidden="true" />
    </button>
  );
  return (
    <Screen testId="tv-friend-settings" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("friends.settings")}</h1>
      <p className="tv-hint tv-friend-help">{t("friends.settingsHelp")}</p>
      <div className="tv-friend-switches">
        {row("friendsGive", "friends.switchGive", "tv-friends-give")}
        {SUNSET_ROWS.filter(({ key }) => sunset.includes(key)).map(({ key, label, testId }) => row(key, label, testId))}
        {sunset.includes("newsPopups") && (
          <button
            className="tv-switch-row"
            role="switch"
            aria-checked={settings.newsPopups !== false}
            onClick={() => set("newsPopups", settings.newsPopups === false ? undefined : false)}
            data-nav
            data-testid="tv-friends-popups"
          >
            <span>{t("friends.popups")}</span>
            <span className="tv-switch" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="tv-hint tv-friend-help" data-testid="tv-friends-give-hint">
        {t("friends.switchGiveHint")}
      </p>
      <p className="tv-hint tv-friend-help" data-testid="tv-friends-messages-hint">
        {t("chat.settingsHint", CHAT_FACTS)}
      </p>
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" onClick={onClose} data-nav data-testid="tv-friend-settings-done">
          {t("common.done")}
        </button>
      </div>
    </Screen>
  );
}
