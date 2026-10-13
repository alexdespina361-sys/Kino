import {
  AcceptedSchema,
  AskedSchema,
  FriendListsSchema,
  FriendRatingsSchema,
  FriendsStateSchema,
  InvitedSchema,
  InviteViewSchema,
  KeptFriendsSchema,
  ScreenProofSchema,
  SentSchema,
  TagViewSchema,
  type SendRequest,
} from "../../shared";
import { ask, request } from "../account/api";

const base = (profileId: string) => `/api/profiles/${encodeURIComponent(profileId)}/friends`;
const part = (value: string) => encodeURIComponent(value);

/** What the server says about friends, one call for each thing a profile can do with them. */
export const friendsApi = {
  /** Everything the Friends page shows: friends, inbox, what they watched, the codes given out. */
  state: (profileId: string) => ask(FriendsStateSchema, "GET", base(profileId)),
  /** Who the friends are of a profile that has them turned off (the page above is shut to it): enough to end a friendship from the settings. */
  kept: (profileId: string) => ask(KeptFriendsSchema, "GET", `${base(profileId)}/kept`),
  /** A new code to give to a friend. */
  invite: (profileId: string) => ask(InvitedSchema, "POST", `${base(profileId)}/invites`, {}),
  revoke: async (profileId: string, code: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/invites/${part(code)}`)),
  /** Who is behind a code, before it is used. */
  peek: (profileId: string, code: string) => ask(InviteViewSchema, "GET", `${base(profileId)}/invites/${part(code)}`),
  accept: (profileId: string, code: string) => ask(AcceptedSchema, "POST", `${base(profileId)}/accept`, { code }),
  /** Who has this tag ("Sam#2"), before anybody is asked. */
  tag: (profileId: string, text: string) => ask(TagViewSchema, "GET", `${base(profileId)}/tags/${part(text)}`),
  /** Ask the profile with this tag to be friends: it waits for their yes (unless they had asked first). */
  askFriend: (profileId: string, tag: string) => ask(AskedSchema, "POST", `${base(profileId)}/requests`, { tag }),
  acceptRequest: (profileId: string, fromId: string) => ask(AcceptedSchema, "POST", `${base(profileId)}/requests/${part(fromId)}/accept`, {}),
  declineRequest: async (profileId: string, fromId: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/requests/${part(fromId)}`)),
  /** The proof a screen gives a watch party, to be known there as this profile (TV_PROFILE). */
  screen: (profileId: string) => ask(ScreenProofSchema, "POST", `/api/profiles/${encodeURIComponent(profileId)}/screen`, {}),
  remove: async (profileId: string, friendId: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/${part(friendId)}`)),
  lists: (profileId: string, friendId: string) => ask(FriendListsSchema, "GET", `${base(profileId)}/${part(friendId)}/lists`),
  ratings: (profileId: string, friendId: string) => ask(FriendRatingsSchema, "GET", `${base(profileId)}/${part(friendId)}/ratings`),
  send: (profileId: string, body: SendRequest) => ask(SentSchema, "POST", `${base(profileId)}/send`, body),
  read: async (profileId: string): Promise<void> => void (await request("POST", `${base(profileId)}/inbox/read`, {})),
  dismiss: async (profileId: string, itemId: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/inbox/${part(itemId)}`)),
};
