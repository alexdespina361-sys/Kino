import { useState } from "react";
import { sameTag, tagLabel, type PartyProfile, type Person, type TagView } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { describeError } from "../account/errors";
import { useT } from "../i18n";
import { useFriends } from "./FriendsProvider";
import { useTagPeek } from "./usePeek";

/** Whether this profile has asked that person already and has not had an answer. */
export const asked = (sent: ReadonlyArray<{ to: Person }> | undefined, who: Pick<TagView, "name" | "tag">): boolean => (sent ?? []).some((each) => sameTag(each.to, who));

/**
 * Asking the profile with a tag to be friends, and saying what came of it in a line: that the request is waiting for a yes, or that the two
 * are friends now (they had asked first). Fails with the reason the server gave.
 */
function useAsker(): (who: Pick<TagView, "name" | "tag">) => Promise<void> {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  return async (who) => {
    const label = tagLabel(who.name, who.tag);
    const outcome = await friends.askByTag(label);
    account.say(outcome.status === "friends" ? t("friends.added", { name: outcome.friend?.name ?? who.name }) : t("friends.requestSent", { name: label }));
  };
}

/**
 * Finding the profile with a tag, the way a screen does it: who it is is looked up first (`seen`, or why there is nobody), then `send` asks.
 * `onDone` is called when it has gone.
 */
export function useTagAsk(text: string, onDone: () => void) {
  const friends = useFriends();
  const ask = useAsker();
  const { seen, problem: found } = useTagPeek(text);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!seen) return;
    setBusy(true);
    setRefused(null);
    try {
      await ask(seen);
      onDone();
    } catch (error) {
      setRefused(describeError(error));
      setBusy(false);
    }
  };

  return { seen, problem: refused ?? found, waiting: seen !== null && asked(friends.state?.sent, seen), busy, send };
}

/**
 * What a guest of a watch party who is signed in as a profile can be asked: nothing for this profile itself, for a friend already, or when
 * friends are off here; "add" for anybody else, and "asked" while there is no answer to the request made.
 */
export function useAddable(profile: PartyProfile | undefined): "add" | "asked" | null {
  const account = useAccount();
  const friends = useFriends();
  const state = friends.state;
  if (!profile || !friends.on || !state) return null;
  if (account.profile && sameTag(profile, account.profile)) return null;
  if (state.friends.some((friend) => sameTag(friend, profile))) return null;
  return asked(state.sent, profile) ? "asked" : "add";
}

/** The button of a party's list of guests: asks the profile on that screen to be friends, and says what came of it. */
export function useAddFromParty(): (profile: PartyProfile) => Promise<void> {
  const account = useAccount();
  const ask = useAsker();
  return async (profile) => {
    try {
      await ask(profile);
    } catch (error) {
      account.say(describeError(error));
    }
  };
}

/** Saying yes or no to a request to be friends, with a line for what came of it. */
export function useAnswerRequests() {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  return {
    accept: async (from: Person): Promise<void> => {
      try {
        const friend = await friends.acceptRequest(from.id);
        account.say(t("friends.added", { name: friend.name }));
      } catch (error) {
        account.say(describeError(error));
      }
    },
    decline: async (from: Person): Promise<void> => {
      try {
        await friends.declineRequest(from.id);
      } catch (error) {
        account.say(describeError(error));
      }
    },
  };
}
