import { Component, type ReactNode } from "react";
import { t } from "../i18n";
import { reloadForScript, scriptIsMissing } from "./scriptRescue";

/**
 * Around the screen (the TV's player or the phone's remote, each a script of its own): when that script cannot be fetched the page used to go blank, with nothing on
 * it to press. Now it starts itself again once (see `reloadForScript`), and if that is not it, says so and offers the same by hand. Anything else that goes wrong in
 * drawing the screen gets the words and the button too, without the first reload.
 */
export class ScreenGate extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    if (scriptIsMissing(error)) reloadForScript();
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen-failed" role="alert" data-testid="screen-failed">
        <p>{t("common.screenFailed")}</p>
        <button type="button" autoFocus onClick={() => location.reload()}>
          {t("common.retry")}
        </button>
      </div>
    );
  }
}
