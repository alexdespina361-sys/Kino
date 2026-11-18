import { useEffect } from "react";
import { useAccount } from "../account/AccountProvider";
import { refreshUnread, useUnreadFeedback } from "./api";
import { openFeedback } from "./store";

export function useFeedbackEntry(): { unread: number; open: () => void } {
  const { me } = useAccount();
  const signedIn = me !== null;
  const unread = useUnreadFeedback();
  useEffect(() => {
    void refreshUnread(signedIn);
  }, [signedIn]);
  return { unread, open: () => openFeedback() };
}
