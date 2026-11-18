import { Component, lazy, Suspense, type ReactNode } from "react";
import { useAccount } from "../account/AccountProvider";
import { t } from "../i18n";
import { closeFeedback, useFeedbackUi } from "./store";

const Host = lazy(() => import("./FeedbackHost").then((module) => ({ default: module.FeedbackHost })));

function Loading() {
  return (
    <div role="status" aria-label={t("common.loading")} data-feedback-skip style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", background: "rgba(0, 0, 0, 0.55)", color: "#fff", fontSize: "2rem" }}>
      <span className="spinner" />
    </div>
  );
}

class Failed extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onFail();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function FeedbackGate() {
  const ui = useFeedbackUi();
  const account = useAccount();
  if (!ui.open) return null;
  return (
    <Failed
      key={ui.session}
      onFail={() => {
        closeFeedback();
        account.say(t("feedback.loadFailed"));
      }}
    >
      <Suspense fallback={<Loading />}>
        <Host options={ui.options} onClose={closeFeedback} />
      </Suspense>
    </Failed>
  );
}
