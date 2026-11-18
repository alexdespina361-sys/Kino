import { Component, type ReactNode } from "react";
import { t } from "../i18n";
import { reloadForScript, scriptIsMissing } from "./scriptRescue";

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
