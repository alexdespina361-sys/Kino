import { type Accent, type Settings, type UiLanguage } from "../../shared";
import { setLanguage } from "../i18n";
import { profileStore, useProfileData } from "./store";

export function chooseLanguage(language: UiLanguage): void {
  setLanguage(language);
  profileStore.setSetting("lang", language);
}

export const chooseAccent = (accent: Accent): void => profileStore.setSetting("accent", accent);

export function useSettings(): { settings: Settings; set: typeof profileStore.setSetting } {
  const { settings } = useProfileData();
  return { settings, set: profileStore.setSetting.bind(profileStore) };
}
