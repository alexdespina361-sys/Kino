import type { Friend, FriendsState } from "../../shared";

const quiet = (friend: Friend): Friend => {
  const copy = { ...friend };
  delete copy.online;
  return copy;
};

/**
 * What the server last said of the friends, but with nobody online: "online" is a fact of the last minute and a half, so a screen that
 * has not been answered for that long stops saying it (everything else it was told is still good enough to show). The same object when
 * nobody was.
 */
export function withoutOnline(state: FriendsState): FriendsState {
  return state.friends.some((friend) => friend.online) ? { ...state, friends: state.friends.map(quiet) } : state;
}
