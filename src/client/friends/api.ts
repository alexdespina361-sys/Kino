import {
  AcceptedSchema,
  FriendListsSchema,
  FriendRatingsSchema,
  FriendsStateSchema,
  InvitedSchema,
  InviteViewSchema,
  SentSchema,
  type SendRequest,
} from "../../shared";
import { ask, request } from "../account/api";

const base = (profileId: string) => `/api/profiles/${encodeURIComponent(profileId)}/friends`;
const part = (value: string) => encodeURIComponent(value);

/** What the server says about friends, one call for each thing a profile can do with them. */
export const friendsApi = {
  /** Everything the Friends page shows: friends, inbox, what they watched, the codes given out. */
  state: (profileId: string) => ask(FriendsStateSchema, "GET", base(profileId)),
  /** A new code to give to a friend. */
  invite: (profileId: string) => ask(InvitedSchema, "POST", `${base(profileId)}/invites`, {}),
  revoke: async (profileId: string, code: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/invites/${part(code)}`)),
  /** Who is behind a code, before it is used. */
  peek: (profileId: string, code: string) => ask(InviteViewSchema, "GET", `${base(profileId)}/invites/${part(code)}`),
  accept: (profileId: string, code: string) => ask(AcceptedSchema, "POST", `${base(profileId)}/accept`, { code }),
  remove: async (profileId: string, friendId: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/${part(friendId)}`)),
  lists: (profileId: string, friendId: string) => ask(FriendListsSchema, "GET", `${base(profileId)}/${part(friendId)}/lists`),
  ratings: (profileId: string, friendId: string) => ask(FriendRatingsSchema, "GET", `${base(profileId)}/${part(friendId)}/ratings`),
  send: (profileId: string, body: SendRequest) => ask(SentSchema, "POST", `${base(profileId)}/send`, body),
  read: async (profileId: string): Promise<void> => void (await request("POST", `${base(profileId)}/inbox/read`, {})),
  dismiss: async (profileId: string, itemId: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/inbox/${part(itemId)}`)),
};
