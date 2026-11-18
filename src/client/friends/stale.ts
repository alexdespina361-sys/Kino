import type { Friend, FriendsState } from "../../shared";

const quiet = (friend: Friend): Friend => {
  const copy = { ...friend };
  delete copy.online;
  return copy;
};

export function withoutOnline(state: FriendsState): FriendsState {
  return state.friends.some((friend) => friend.online) ? { ...state, friends: state.friends.map(quiet) } : state;
}
