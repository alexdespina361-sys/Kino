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

export const PROFILE_KEY = "kino.profile";
export const ME_KEY = "kino.me";

function rememberedMe(): Me | null {
  try {
    const parsed = MeSchema.safeParse(JSON.parse(readStorage(ME_KEY) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const SYNC_AFTER_CHANGE_MS = 8_000;
const SYNC_EVERY_MS = 45_000;
const RETRY_MS = 20_000;
const FINAL_SYNC_MS = 2_500;

export type NewsLevel = "urgent" | "info";

const UNLOCK_MS = 10 * 60_000;

export interface ChildLock {
  locked: boolean;
  asking: boolean;
  grownUp(action: () => void): void;
  unlock(pin: string): Promise<PinAnswer>;
  forgot(password: string): Promise<PinAnswer>;
  cancel(): void;
  relock(): void;
}

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
  status: "loading" | "unavailable" | "ready";
  me: Me | null;
  registration: Registration;
  google: boolean;
  withGoogle(purpose: GooglePurpose): void;
  profile: Profile | null;
  choosing: boolean;
  message: { id: number; text: string; news?: NewsLevel } | null;
  say(text: string, news?: NewsLevel): void;

  signIn(email: string, password: string): Promise<Me>;
  signUp(email: string, password: string, name?: string): Promise<Me>;
  signOut(options?: { deleted?: boolean }): Promise<void>;
  signedInAs(me: Me): void;
  choose(profileId: string | null): void;
  addProfile(name: string, avatar?: AvatarId): Promise<Profile | undefined>;
  updateProfile(id: string, patch: { name?: string; avatar?: AvatarId; setup?: "done" }): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  syncNow(): void;
  refresh(): Promise<void>;
  childLock: ChildLock;
  changeChildPin(change: ChildPinChange): Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount needs an <AccountProvider>");
  return value;
}

export function AccountProvider({ device, children }: { device: DeviceKind; children: ReactNode }) {
  const [status, setStatus] = useState<AccountContextValue["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [registration, setRegistration] = useState<Registration>("open");
  const [google, setGoogle] = useState(false);
  const [fromGoogle] = useState(takeGoogleOutcome);
  const [profileId, setProfileId] = useState<string | null>(() => readStorage(PROFILE_KEY) ?? null);
  const [message, setMessage] = useState<AccountContextValue["message"]>(null);

  const meRef = useRef(me);
  meRef.current = me;
  const profile = me?.profiles.find((candidate) => candidate.id === profileId) ?? (me?.profiles.length === 1 ? me.profiles[0] : undefined) ?? null;

  const popupsRef = useRef(true);
  const say = useCallback((text: string, news?: NewsLevel) => {
    if (news && !popupsRef.current) return;
    setMessage((current) => ({ id: (current?.id ?? 0) + 1, text, ...(news ? { news } : {}) }));
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [message]);

  const load = useCallback(async () => {
    try {
      const state = await api.session();
      setRegistration(state.registration);
      setGoogle(state.google === true);
      setMe(state.me);
      setStatus("ready");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.code === "bad_response")) return setStatus("unavailable");
      setMe((now) => now ?? rememberedMe());
      setStatus((now) => (now === "loading" ? "ready" : now));
      setTimeout(() => void load(), RETRY_MS);
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (status === "ready") writeStorage(ME_KEY, me ? JSON.stringify(me) : null);
  }, [me, status]);

  useEffect(() => {
    if (!me) return;
    if (profileId && me.profiles.some((candidate) => candidate.id === profileId)) return;
    const only = me.profiles.length === 1 ? me.profiles[0] : undefined;
    setProfileId(only?.id ?? null);
  }, [me, profileId]);
  useEffect(() => {
    writeStorage(PROFILE_KEY, profileId);
  }, [profileId]);

  const scope = me && profile ? profile.id : GUEST;
  useEffect(() => {
    if (status === "loading") return;
    profileStore.openScope(scope);
    if (scope !== GUEST && profileStore.adoptGuest()) say(t("account.adopted", { name: profile?.name ?? "" }));
  }, [scope, status, say, profile?.name]);

  const { settings, scope: openScope, waiting } = useProfileData();
  popupsRef.current = settings.newsPopups !== false;
  useEffect(() => {
    setLanguage(settings.lang ?? screenLanguage(), false);
  }, [settings.lang]);
  useKinoAppNotifications(status === "ready" && me && profile ? profile.id : null, settings.lang ?? screenLanguage());
  useEffect(() => {
    applyAccent(settings.accent);
  }, [settings.accent]);

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

  const lockedNow = useCallback((who: Me | null = meRef.current): boolean => {
    const current = profileRef.current;
    if (!who?.account.childPin || !current || !(childRef.current || unsureRef.current)) return false;
    const unlocked = unlockedRef.current;
    return !(unlocked && unlocked.id === current.id && Date.now() - unlocked.at < UNLOCK_MS);
  }, []);

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
        void load();
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
        meRef.current = updated;
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
    [locked, asking, grownUp, unlock, forgot, cancelPin, relock, unlockedFor, child, unsure],
  );

  const signOut = useCallback(
    async (options?: { deleted?: boolean }) => {
      if (!options?.deleted && lockedNow()) return;
      const leaving = meRef.current;
      if (!options?.deleted) {
        await Promise.race([syncRef.current(), new Promise((resolve) => setTimeout(resolve, FINAL_SYNC_MS))]);
        try {
          await api.logout();
        } catch {
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
        if (purpose !== "pin" && lockedNow()) return;
        if (purpose === "delete") deleteAfterGoogle.ask();
        if (purpose === "pin") pinAfterGoogle.ask();
        location.assign(googleStartUrl(device, purpose, location.pathname));
      },
      async signIn(email, password) {
        const signedIn = await api.login(email, password, device);
        setMe(signedIn);
        return signedIn;
      },
      async signUp(email, password, name) {
        const created = await api.register(email, password, device, name);
        setMe(created);
        return created;
      },
      signOut,
      signedInAs(signedIn) {
        setMe(signedIn);
      },
      choose(id) {
        if (id !== profileRef.current?.id && lockedNow()) return;
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
        setMe(await api.changeChildPin(change));
      },
    }),
    [status, me, registration, google, profile, message, say, signOut, device, load, childLock, lockedNow],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
