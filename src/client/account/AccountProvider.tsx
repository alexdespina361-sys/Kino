import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AvatarId, DeviceKind, Me, Profile, Registration } from "../../shared";
import { readStorage, writeStorage } from "../shared/format";
import { setLanguage, t } from "../i18n";
import { ApiError, api, beaconSync } from "./api";
import { applyAccent } from "./theme";
import "./account.css";
import { GUEST } from "./profileStore";
import { profileStore, useProfileData } from "./store";

/** Which profile this screen uses (each screen remembers its own: the family TV and a phone are rarely the same person). */
export const PROFILE_KEY = "kino.profile";

/** Progress is sent a few seconds after it changes, so a film being watched is one small message every so often, not one per tick. */
const SYNC_AFTER_CHANGE_MS = 8_000;
const SYNC_EVERY_MS = 45_000;
const RETRY_MS = 20_000;
/** Signing out waits this long at most to send what has not been sent. */
const FINAL_SYNC_MS = 2_500;

export interface AccountContextValue {
  /** `unavailable`: this server has no accounts, so everything stays on the device. */
  status: "loading" | "unavailable" | "ready";
  me: Me | null;
  registration: Registration;
  /** The profile in use. Null for a guest, and for someone signed in who has not picked yet. */
  profile: Profile | null;
  /** Signed in, but has to pick who is watching. */
  choosing: boolean;
  /** Said once in a while ("Added what you watched here to Alex"), for the screen to show as a toast. */
  message: { id: number; text: string } | null;

  signIn(email: string, password: string): Promise<Me>;
  signUp(email: string, password: string): Promise<Me>;
  signOut(): Promise<void>;
  /** A sign-in that already happened on the server (a TV signed in from a phone). */
  signedInAs(me: Me): void;
  choose(profileId: string | null): void;
  addProfile(name: string, avatar?: AvatarId): Promise<Profile | undefined>;
  updateProfile(id: string, patch: { name?: string; avatar?: AvatarId }): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  /** Start an exchange with the server now (the screen is about to stop, or has just paused). */
  syncNow(): void;
  refresh(): Promise<void>;
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
  const [profileId, setProfileId] = useState<string | null>(() => readStorage(PROFILE_KEY) ?? null);
  const [message, setMessage] = useState<AccountContextValue["message"]>(null);

  const meRef = useRef(me);
  meRef.current = me;
  // A single profile is simply used (this is also true for the render before the effect below remembers it).
  const profile = me?.profiles.find((candidate) => candidate.id === profileId) ?? (me?.profiles.length === 1 ? me.profiles[0] : undefined) ?? null;

  const say = useCallback((text: string) => setMessage((current) => ({ id: (current?.id ?? 0) + 1, text })), []);
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
      setMe(state.me);
      setStatus("ready");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.code === "bad_response")) return setStatus("unavailable");
      setStatus((now) => (now === "loading" ? "ready" : now)); // not reachable just now: carry on as a guest, and look again
      setTimeout(() => void load(), RETRY_MS);
    }
  }, []);
  useEffect(() => void load(), [load]);

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

  // The language and colour a profile chose follow it onto every screen it uses.
  const { settings } = useProfileData();
  useEffect(() => {
    if (settings.lang) setLanguage(settings.lang, false);
  }, [settings.lang]);
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
            // Signed out somewhere else: this screen is a guest again.
            setMe(null);
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
      if (request.progress?.length || request.watched?.length || request.list?.length || request.settings?.length) beaconSync(id, request);
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
  }, [syncing, status, load]);

  /* ------------------------------ actions ------------------------------ */

  const value = useMemo<AccountContextValue>(
    () => ({
      status,
      me,
      registration,
      profile,
      choosing: me !== null && profile === null,
      message,

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
      async signOut() {
        // What has not been sent yet is sent first, or it would be lost with this screen's copy.
        await Promise.race([syncRef.current(), new Promise((resolve) => setTimeout(resolve, FINAL_SYNC_MS))]);
        const leaving = meRef.current;
        try {
          await api.logout();
        } catch {
          /* the cookie may already be gone */
        }
        profileStore.openScope(GUEST);
        for (const other of leaving?.profiles ?? []) profileStore.forget(other.id);
        setProfileId(null);
        setMe(null);
      },
      signedInAs(signedIn) {
        setMe(signedIn);
      },
      choose(id) {
        setProfileId(id);
      },
      async addProfile(name, avatar) {
        const before = new Set(meRef.current?.profiles.map((candidate) => candidate.id));
        const updated = await api.addProfile(name, avatar);
        setMe(updated);
        return updated.profiles.find((candidate) => !before.has(candidate.id));
      },
      async updateProfile(id, patch) {
        setMe(await api.updateProfile(id, patch));
      },
      async deleteProfile(id) {
        setMe(await api.deleteProfile(id));
        profileStore.forget(id);
      },
      syncNow() {
        void syncRef.current();
      },
      async refresh() {
        await load();
      },
    }),
    [status, me, registration, profile, message, device, load],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
