import { useEffect } from "react";
import { useAccount } from "../account/AccountProvider";
import { refreshUnread, useUnreadFeedback } from "./api";
import { openFeedback } from "./store";

/**
 * What a button that leads to the feedback needs: how many answers from the team wait for the viewer, and the way in. Whether any wait is asked
 * when the button comes on screen (and at most once in a few minutes), never on a timer: see `refreshUnread`.
 */
export function useFeedbackEntry(): { unread: number; open: () => void } {
  const { me } = useAccount();
  const signedIn = me !== null;
  const unread = useUnreadFeedback();
  useEffect(() => {
    void refreshUnread(signedIn);
  }, [signedIn]);
  return { unread, open: () => openFeedback() };
}
