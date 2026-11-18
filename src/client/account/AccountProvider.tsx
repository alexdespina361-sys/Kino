import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { COLLECTIONS, MeSchema, type AvatarId, type ChildPinChange, type DeviceKind, type GoogleOutcome, type Me, type Profile, type Registration } from "../../shared";
import { useKinoAppNotifications } from "../app/kinoApp";
import { readStorage, writeStorage } from "../shared/format";
import { screenLanguage, setLanguage, t, type Key } from "../i18n";
import { ApiError, api, beaconSync } from "./api";
import { describeError } from "./errors";
import { deleteAfterGoogle, googleStartUrl, pinAfterGoogle, takeGoogleOutcome, type GooglePurpose } from "./google";
import { pinAnswer, type PinAnswer } from "./pin";
import { applyAccent } from "./theme";
import "./account.css";
import { GUEST } from "./profileStore";
import { profileStore, useProfileData } from "./store";

/** Which profile this screen uses (each screen remembers its own: the family TV and a phone are rarely the same person). */
export const PROFILE_KEY = "kino.profile";
/** Who the server last said was signed in on this screen, for the moments it cannot be asked (see `rememberedMe`). */
export const ME_KEY = "kino.me";

/**
 * A screen that was signed in stays that person while the server cannot be reached as the page opens (a network that is not up
 * yet, a host that is restarting), instead of turning into a guest's until it can. The server's next answer is the truth, and
 * replaces this: a 401 on the next exchange, or "nobody" from the next look, signs the screen out as before.
 */
function rememberedMe(): Me | null {
  try {
    const parsed = MeSchema.safeParse(JSON.parse(readStorage(ME_KEY) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Progress is sent a few seconds after it changes, so a film being watched is one small message every so often, not one per tick. */
const SYNC_AFTER_CHANGE_MS = 8_000;
const SYNC_EVERY_MS = 45_000;
const RETRY_MS = 20_000;
/** Signing out waits this long at most to send what has not been sent. */
const FINAL_SYNC_MS = 2_500;

/** How much a piece of news from friends matters to a viewer who is in the middle of a film: an invitation to something under way, or anything else (which can wait in the bell). */
export type NewsLevel = "urgent" | "info";

/** A PIN given on a child's profile lets it be left for this long at most (and only until the profile changes, or the account's pages close: `relock`). */
const UNLOCK_MS = 10 * 60_000;

/**
 * The PIN of a child's profile (the owner, 16 Nov 2026; see `CHILD_PIN_LENGTH` in shared/account.ts): while this screen's profile is a child's and the account has a
 * PIN, the profile is not left until the PIN is given. The screens ask for it (`grownUp`) and show the page for it while `asking`; what they would call here to leave
 * (`choose`, `signOut`, the profiles' changes, Google) refuses while it is `locked`, so a way out a screen forgot to ask on is a dead button, not a way out.
 */
export interface ChildLock {
  /** The profile is a child's (or its settings are not known yet), the account has a PIN, and the PIN has not been given since the profile was chosen. */
  locked: boolean;
  /** A PIN is being asked for: the TV shows its page for it, the phone its sheet. */
  asking: boolean;
  /** Do `action` now if the profile may be left, else once the PIN is given (and never if it is not). */
  grownUp(action: () => void): void;
  /** The PIN, typed where it was asked: right, and what was waiting is done. */
  unlock(pin: string): Promise<PinAnswer>;
  /** The PIN forgotten: the account's password takes it off, and what was waiting is done. (An account made with Google confirms with Google: `withGoogle("pin")`.) */
  forgot(password: string): Promise<PinAnswer>;
  /** Not now: what was waiting is dropped. */
  cancel(): void;
  /** Ask again from now on (the account's pages were closed). */
  relock(): void;
}

/** What the page says when the browser comes back from Google (a sign-in that worked says nothing, and a confirmation is the deleting's own business). */
const GOOGLE_SAYS: Record<Exclude<GoogleOutcome, "reauth">, Key> = {
  denied: "google.denied",
  failed: "google.failed",
  closed: "error.registration_closed",
  busy: "error.rate_limited",
  taken: "google.taken",
  unavailable: "google.unavailable",
  linked: "google.linked",
};

export interface AccountContextValue {
  /** `unavailable`: this server has no accounts, so everything stays on the device. */
  status: "loading" | "unavailable" | "ready";
  me: Me | null;
  registration: Registration;
  /** Whether this server signs in with Google at this address. */
  google: boolean;
  /**
   * Off to Google, and the page with it: to sign in (or make an account), to connect Google to the account signed in, or to confirm who is here and then delete
   * the account (it is deleted when the browser comes back with Google's yes). How it ended is said when the page is back.
   */
  withGoogle(purpose: GooglePurpose): void;
  /** The profile in use. Null for a guest, and for someone signed in who has not picked yet. */
  profile: Profile | null;
  /** Signed in, but has to pick who is watching. */
  choosing: boolean;
  /**
   * Said once in a while ("Added what you watched here to Alex"), for the screen to show as a toast. `news` is set on what friends are up to:
   * it is a thing the screen may keep to itself while a film plays ("urgent": an invitation is let through, small), and a thing this profile can turn off.
   */
  message: { id: number; text: string; news?: NewsLevel } | null;
  /** Say something in that same line: what the viewer did (a title was sent), or, with `news`, what friends are up to (dropped when the profile has turned that off). */
  say(text: string, news?: NewsLevel): void;

  signIn(email: string, password: string): Promise<Me>;
  signUp(email: string, password: string): Promise<Me>;
  /** `deleted`: the account has just been deleted on the server, which has ended its sessions too (so there is nothing to send what is left to, and nobody to sign out). */
  signOut(options?: { deleted?: boolean }): Promise<void>;
  /** A sign-in that already happened on the server (a TV signed in from a phone). */
  signedInAs(me: Me): void;
  choose(profileId: string | null): void;
  addProfile(name: string, avatar?: AvatarId): Promise<Profile | undefined>;
  updateProfile(id: string, patch: { name?: string; avatar?: AvatarId; setup?: "done" }): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  /** Start an exchange with the server now (the screen is about to stop, or has just paused). */
  syncNow(): void;
  refresh(): Promise<void>;
  childLock: ChildLock;
  /** Set the PIN of a child's profile, change it, or take it off. A refusal is thrown (an `ApiError`: `wrong_pin`, `invalid_credentials`, `pin_required`...). */
  changeChildPin(change: ChildPinChange): Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount needs an <AccountProvider>");
  return value;
}

/** Who is signed in on this screen, which profile is in use, and the exchange of its data with the server. */
export function AccountProvider({ device, children }: { device: DeviceKind; children: ReactNode }) {
  const [status, setStatus] = useState<AccountContextValue["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [registration, setRegistration] = useState<Registration>("open");
  const [google, setGoogle] = useState(false);
  // (Read once, as the page opens: the word the server sent the browser back from Google with, if it did.)
  const [fromGoogle] = useState(takeGoogleOutcome);
  const [profileId, setProfileId] = useState<string | null>(() => readStorage(PROFILE_KEY) ?? null);
  const [message, setMessage] = useState<AccountContextValue["message"]>(null);

  const meRef = useRef(me);
  meRef.current = me;
  // A single profile is simply used (this is also true for the render before the effect below remembers it).
  const profile = me?.profiles.find((candidate) => candidate.id === profileId) ?? (me?.profiles.length === 1 ? me.profiles[0] : undefined) ?? null;

  // (What `say` reads of the profile's settings is what they are now, not when it was handed out.)
  const popupsRef = useRef(true);
  const say = useCallback((text: string, news?: NewsLevel) => {
    if (news && !popupsRef.current) return; // the profile has turned friends' news off: it waits in the bell
    setMessage((current) => ({ id: (current?.id ?? 0) + 1, text, ...(news ? { news } : {}) }));
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [message]);

  /* ------------------------------ who is signed in ------------------------------ */

  const load = useCallback(async () => {
    try {
      const state = await api.session();
      setRegistration(state.registration);
      setGoogle(state.google === true);
      setMe(state.me);
      setStatus("ready");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.code === "bad_response")) return setStatus("unavailable");
      // Not reachable just now: carry on as whoever was signed in last time (a guest, if nobody), and look again.
      setMe((now) => now ?? rememberedMe());
      setStatus((now) => (now === "loading" ? "ready" : now));
      setTimeout(() => void load(), RETRY_MS);
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (status === "ready") writeStorage(ME_KEY, me ? JSON.stringify(me) : null);
  }, [me, status]);

  // A single profile is simply used; with several, the one this screen used last, else the screen asks.
  useEffect(() => {
    if (!me) return;
    if (profileId && me.profiles.some((candidate) => candidate.id === profileId)) return;
    const only = me.profiles.length === 1 ? me.profiles[0] : undefined;
    setProfileId(only?.id ?? null);
  }, [me, profileId]);
  useEffect(() => {
    writeStorage(PROFILE_KEY, profileId);
  }, [profileId]);

  /* ------------------------------ the profile's data ------------------------------ */

  const scope = me && profile ? profile.id : GUEST;
  useEffect(() => {
    if (status === "loading") return;
    profileStore.openScope(scope);
    if (scope !== GUEST && profileStore.adoptGuest()) say(t("account.adopted", { name: profile?.name ?? "" }));
  }, [scope, status, say, profile?.name]);

  // The language and colour a profile chose follow it onto every screen it uses. One that chose no language leaves the screen in its own (not in the language of the profile
  // or the guest before it, which a shared TV would otherwise keep until the page was loaded again).
  const { settings, scope: openScope, waiting } = useProfileData();
  popupsRef.current = settings.newsPopups !== false;
  useEffect(() => {
    setLanguage(settings.lang ?? screenLanguage(), false);
  }, [settings.lang]);
  // In the Android app, the phone is told of this profile's friends (client/app/kinoApp.ts), in the profile's words.
  useKinoAppNotifications(status === "ready" && me && profile ? profile.id : null, settings.lang ?? screenLanguage());
  useEffect(() => {
    applyAccent(settings.accent);
  }, [settings.accent]);

  /* ------------------------------ staying in step ------------------------------ */

  const syncRef = useRef<() => Promise<void>>(async () => {});
  const syncing = me && profile ? profile.id : undefined;
  useEffect(() => {
    if (!syncing || status !== "ready") {
      syncRef.current = async () => {};
      return;
    }
    const id = syncing;
    let stopped = false;
    let running: Promise<void> | undefined;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const exchange = async () => {
      do {
        again = false;
        const { request, sent } = profileStore.pending();
        const response = await api.sync(id, request);
        if (stopped) return;
        profileStore.accept(response, sent);
      } while (again);
    };
    const run = (): Promise<void> => {
      if (running) {
        again = true;
        return running;
      }
      running = exchange()
        .catch((error: unknown) => {
          if (stopped) return;
          if (error instanceof ApiError && error.status === 401) {
            // Signed out somewhere else: this screen is a guest again, and says why.
            setMe(null);
            say(t("error.signed_out"));
          } else if (error instanceof ApiError && error.status === 404) {
            void load();
          } else {
            timer = setTimeout(() => void run(), RETRY_MS);
          }
        })
        .finally(() => {
          running = undefined;
        });
      return running;
    };
    syncRef.current = run;

    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, SYNC_AFTER_CHANGE_MS);
    };
    const unsubscribe = profileStore.subscribe(soon);
    const every = setInterval(() => void run(), SYNC_EVERY_MS);
    const wake = () => {
      if (document.visibilityState === "visible") void run();
    };
    const leave = () => {
      profileStore.flush();
      const { request } = profileStore.pending();
      if (COLLECTIONS.some((name) => request[name]?.length)) beaconSync(id, request);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pagehide", leave);
    void run();

    return () => {
      stopped = true;
      syncRef.current = async () => {};
      unsubscribe();
      clearInterval(every);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pagehide", leave);
    };
  }, [syncing, status, load, say]);

  /* ------------------------------ the PIN of a child's profile ------------------------------ */

  // (See `ChildLock`.) A profile whose settings are not known yet (new to this screen, or the server not asked yet) is held as a child's until they are: on an account with
  // a PIN, a screen kept from the server (no network, its exchange blocked) does not let a child's profile go once a few seconds have passed. (The screens' rows hold
  // only for HOLD_MS: see `useProfileHold`.)
  const child = settings.child === true;
  const unsure = me !== null && profile !== null && (status === "loading" || openScope !== profile.id || waiting);
  const childRef = useRef(child);
  childRef.current = child;
  const unsureRef = useRef(unsure);
  unsureRef.current = unsure;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const unlockedRef = useRef<{ id: string; at: number } | null>(null);
  const [unlockedFor, setUnlockedFor] = useState<string | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const [asking, setAsking] = useState(false);

  /** Whether leaving the profile waits for the PIN now (`who`: the account as just told, before the page has it). */
  const lockedNow = useCallback((who: Me | null = meRef.current): boolean => {
    const current = profileRef.current;
    if (!who?.account.childPin || !current || !(childRef.current || unsureRef.current)) return false;
    const unlocked = unlockedRef.current;
    return !(unlocked && unlocked.id === current.id && Date.now() - unlocked.at < UNLOCK_MS);
  }, []);

  // Another profile: whatever was given for the one before counts no more, and nothing waits.
  useEffect(() => {
    unlockedRef.current = null;
    setUnlockedFor(null);
    pendingRef.current = null;
    setAsking(false);
  }, [profile?.id]);

  const askPin = useCallback((action: () => void) => {
    pendingRef.current = action;
    setAsking(true);
  }, []);
  /** The PIN was given (or there is none any more): the profile may be left until it changes, and what waited is done. */
  const letGo = useCallback(() => {
    const current = profileRef.current;
    unlockedRef.current = current ? { id: current.id, at: Date.now() } : null;
    setUnlockedFor(current?.id ?? null);
    const action = pendingRef.current;
    pendingRef.current = null;
    setAsking(false);
    action?.();
  }, []);

  const grownUp = useCallback(
    (action: () => void) => {
      if (lockedNow()) return askPin(action);
      // A screen that has been on for a while may not know that a PIN was set on another one since: a child's profile asks the server once before it is left, and is not
      // left when the server cannot be asked (it may have a PIN this screen has not heard of).
      if (meRef.current && profileRef.current && childRef.current && !meRef.current.account.childPin) {
        void api.session().then(
          (state) => {
            setMe(state.me);
            if (lockedNow(state.me)) askPin(action);
            else action();
          },
          () => say(t("pin.offline")),
        );
        return;
      }
      action();
    },
    [lockedNow, askPin, say],
  );

  const unlock = useCallback(
    async (pin: string): Promise<PinAnswer> => {
      try {
        await api.checkChildPin(pin);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "no_pin")) return pinAnswer(error);
        void load(); // (taken off on another screen: there is nothing to ask, and this screen finds out)
      }
      letGo();
      return { ok: true };
    },
    [load, letGo],
  );

  const forgot = useCallback(
    async (password: string): Promise<PinAnswer> => {
      try {
        const updated = await api.changeChildPin({ next: null, password });
        meRef.current = updated; // (what waits is done at once, before the page has the account as it is now)
        setMe(updated);
      } catch (error) {
        return pinAnswer(error);
      }
      say(t("pin.removed"));
      letGo();
      return { ok: true };
    },
    [say, letGo],
  );

  const cancelPin = useCallback(() => {
    pendingRef.current = null;
    setAsking(false);
  }, []);
  const relock = useCallback(() => {
    unlockedRef.current = null;
    setUnlockedFor(null);
  }, []);

  const locked = lockedNow(me);
  const childLock = useMemo<ChildLock>(
    () => ({ locked, asking, grownUp, unlock, forgot, cancel: cancelPin, relock }),
    // (`unlockedFor`, `child` and `unsure` change what `locked` is: it is worked out from them, through the refs above.)
    [locked, asking, grownUp, unlock, forgot, cancelPin, relock, unlockedFor, child, unsure],
  );

  /* ------------------------------ actions ------------------------------ */

  const signOut = useCallback(
    async (options?: { deleted?: boolean }) => {
      if (!options?.deleted && lockedNow()) return; // (a child's profile is not left without the PIN: see `ChildLock`)
      const leaving = meRef.current;
      // (An account that was just deleted has no session left: a last exchange would only be told so, and take it for a sign-out elsewhere.)
      if (!options?.deleted) {
        // What has not been sent yet is sent first, or it would be lost with this screen's copy.
        await Promise.race([syncRef.current(), new Promise((resolve) => setTimeout(resolve, FINAL_SYNC_MS))]);
        try {
          await api.logout();
        } catch {
          // The server did not hear it (no network, a host that is waking up), and it ends a session that is not there as well as one that is: so the session is still
          // alive. A screen that looked signed out would bring the person back at its next load, on a TV the next person to sit down. Stay as we are, and say so.
          say(t("account.signOutFailed"));
          return;
        }
      }
      profileStore.openScope(GUEST);
      for (const other of leaving?.profiles ?? []) profileStore.forget(other.id);
      setProfileId(null);
      setMe(null);
      if (options?.deleted) say(t("account.deleted"));
    },
    [say, lockedNow],
  );

  // Back from Google: how it went is said once, as soon as the screen knows who is here. A confirmation that the person went to Google for, to delete the account, deletes it
  // (the server deletes only for a session that Google has just confirmed; the word in the address alone deletes nothing); one to take off a forgotten PIN takes it off.
  const backFromGoogle = useRef(fromGoogle);
  useEffect(() => {
    if (status !== "ready") return;
    const outcome = backFromGoogle.current;
    backFromGoogle.current = null;
    const deleting = deleteAfterGoogle.take();
    const unpinning = pinAfterGoogle.take();
    if (!outcome) return;
    if (outcome !== "reauth") return say(t(GOOGLE_SAYS[outcome]));
    if (deleting) void api.deleteAccount("").then(() => signOut({ deleted: true }), (error: unknown) => say(describeError(error)));
    else if (unpinning)
      void api.changeChildPin({ next: null }).then(
        (updated) => {
          setMe(updated);
          say(t("pin.removed"));
        },
        (error: unknown) => say(describeError(error)),
      );
  }, [status, say, signOut]);

  const value = useMemo<AccountContextValue>(
    () => ({
      status,
      me,
      registration,
      google,
      profile,
      choosing: me !== null && profile === null,
      message,
      say,

      withGoogle(purpose) {
        if (purpose !== "pin" && lockedNow()) return; // (taking off a forgotten PIN is the one way to Google a locked child's profile has)
        if (purpose === "delete") deleteAfterGoogle.ask();
        if (purpose === "pin") pinAfterGoogle.ask();
        location.assign(googleStartUrl(device, purpose, location.pathname));
      },
      async signIn(email, password) {
        const signedIn = await api.login(email, password, device);
        setMe(signedIn);
        return signedIn;
      },
      async signUp(email, password) {
        const created = await api.register(email, password, device);
        setMe(created);
        return created;
      },
      signOut,
      signedInAs(signedIn) {
        setMe(signedIn);
      },
      choose(id) {
        if (id !== profileRef.current?.id && lockedNow()) return; // (see `ChildLock`)
        setProfileId(id);
      },
      async addProfile(name, avatar) {
        if (lockedNow()) return undefined;
        const before = new Set(meRef.current?.profiles.map((candidate) => candidate.id));
        const updated = await api.addProfile(name, avatar);
        setMe(updated);
        return updated.profiles.find((candidate) => !before.has(candidate.id));
      },
      async updateProfile(id, patch) {
        if (lockedNow()) return;
        setMe(await api.updateProfile(id, patch));
      },
      async deleteProfile(id) {
        if (lockedNow()) return;
        setMe(await api.deleteProfile(id));
        profileStore.forget(id);
      },
      syncNow() {
        void syncRef.current();
      },
      async refresh() {
        await load();
      },
      childLock,
      async changeChildPin(change) {
        // (A PIN is set from a grown-up's profile: on a child's, a child could lock the family's screens with one nobody else knows. Changing or taking off one that
        // is there takes it, or the password, anywhere.)
        if (change.next !== null && !meRef.current?.account.childPin && (childRef.current || unsureRef.current)) throw new ApiError(403, "child_profile");
        setMe(await api.changeChildPin(change));
      },
    }),
    [status, me, registration, google, profile, message, say, signOut, device, load, childLock, lockedNow],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
