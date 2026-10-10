import { type Accent, type Settings, type UiLanguage } from "../../shared";
import { setLanguage } from "../i18n";
import { profileStore, useProfileData } from "./store";

/** The language of the site, for this device and for the profile (which brings it to every screen it signs in on). */
export function chooseLanguage(language: UiLanguage): void {
  setLanguage(language);
  profileStore.setSetting("lang", language);
}

export const chooseAccent = (accent: Accent): void => profileStore.setSetting("accent", accent);

/** What the profile in use chose, and a way to change one thing at a time. */
export function useSettings(): { settings: Settings; set: typeof profileStore.setSetting } {
  const { settings } = useProfileData();
  return { settings, set: profileStore.setSetting.bind(profileStore) };
}
