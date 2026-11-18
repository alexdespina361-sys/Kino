import { ChatMuteSchema, ChatReportPreviewSchema, ChatThreadSchema, type ChatReaction } from "../../shared";
import { ask, request } from "../account/api";

const base = (profileId: string, friendId: string) => `/api/profiles/${encodeURIComponent(profileId)}/friends/${encodeURIComponent(friendId)}/chat`;
const answering = (replyTo: number | undefined) => (replyTo === undefined ? {} : { replyTo });

export const chatApi = {
  read: (profileId: string, friendId: string, since?: number) => ask(ChatThreadSchema, "GET", `${base(profileId, friendId)}${since === undefined ? "" : `?since=${since}&reactions=1`}`),
  send: (profileId: string, friendId: string, text: string, replyTo?: number) => ask(ChatThreadSchema, "POST", base(profileId, friendId), { text, ...answering(replyTo) }),
  sendSticker: (profileId: string, friendId: string, id: string, replyTo?: number) => ask(ChatThreadSchema, "POST", `${base(profileId, friendId)}/sticker`, { id, ...answering(replyTo) }),
  takeBack: (profileId: string, friendId: string, id: number) => ask(ChatThreadSchema, "DELETE", `${base(profileId, friendId)}/${id}`),
  react: (profileId: string, friendId: string, id: number, reaction: ChatReaction | null) => ask(ChatThreadSchema, "PUT", `${base(profileId, friendId)}/${id}/reaction`, { reaction }),
  mute: (profileId: string, friendId: string, muted: boolean) => ask(ChatMuteSchema, "PUT", `${base(profileId, friendId)}/mute`, { muted }),
  reportPreview: (profileId: string, friendId: string) => ask(ChatReportPreviewSchema, "GET", `${base(profileId, friendId)}/report`),
  report: async (profileId: string, friendId: string, rev: number): Promise<void> => void (await request("POST", `${base(profileId, friendId)}/report`, { rev })),
};
