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

export const friendsApi = {
  state: (profileId: string) => ask(FriendsStateSchema, "GET", base(profileId)),
  kept: (profileId: string) => ask(KeptFriendsSchema, "GET", `${base(profileId)}/kept`),
  invite: (profileId: string) => ask(InvitedSchema, "POST", `${base(profileId)}/invites`, {}),
  revoke: async (profileId: string, code: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/invites/${part(code)}`)),
  peek: (profileId: string, code: string) => ask(InviteViewSchema, "GET", `${base(profileId)}/invites/${part(code)}`),
  accept: (profileId: string, code: string) => ask(AcceptedSchema, "POST", `${base(profileId)}/accept`, { code }),
  tag: (profileId: string, text: string) => ask(TagViewSchema, "GET", `${base(profileId)}/tags/${part(text)}`),
  askFriend: (profileId: string, tag: string) => ask(AskedSchema, "POST", `${base(profileId)}/requests`, { tag }),
  acceptRequest: (profileId: string, fromId: string) => ask(AcceptedSchema, "POST", `${base(profileId)}/requests/${part(fromId)}/accept`, {}),
  declineRequest: async (profileId: string, fromId: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/requests/${part(fromId)}`)),
  screen: (profileId: string) => ask(ScreenProofSchema, "POST", `/api/profiles/${encodeURIComponent(profileId)}/screen`, {}),
  remove: async (profileId: string, friendId: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/${part(friendId)}`)),
  lists: (profileId: string, friendId: string) => ask(FriendListsSchema, "GET", `${base(profileId)}/${part(friendId)}/lists`),
  ratings: (profileId: string, friendId: string) => ask(FriendRatingsSchema, "GET", `${base(profileId)}/${part(friendId)}/ratings`),
  send: (profileId: string, body: SendRequest) => ask(SentSchema, "POST", `${base(profileId)}/send`, body),
  answerPlan: async (profileId: string, itemId: string, yes: boolean): Promise<void> => void (await request("POST", `${base(profileId)}/plans/${part(itemId)}/${yes ? "accept" : "decline"}`, {})),
  read: async (profileId: string): Promise<void> => void (await request("POST", `${base(profileId)}/inbox/read`, {})),
  dismiss: async (profileId: string, itemId: string): Promise<void> => void (await request("DELETE", `${base(profileId)}/inbox/${part(itemId)}`)),
};
