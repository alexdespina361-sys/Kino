import { ChatMuteSchema, ChatReportPreviewSchema, ChatThreadSchema } from "../../shared/chat";
import { ask, request } from "../account/api";

const base = (profileId: string, friendId: string) => `/api/profiles/${encodeURIComponent(profileId)}/friends/${encodeURIComponent(friendId)}/chat`;

/** What the server says about the chat of a profile with one of its friends (routes: server/accounts/chatRoutes.ts). */
export const chatApi = {
  /** The chat. With the revision the page has, the answer has no messages when nothing changed. Asking is having seen it. */
  read: (profileId: string, friendId: string, since?: number) => ask(ChatThreadSchema, "GET", `${base(profileId, friendId)}${since === undefined ? "" : `?since=${since}`}`),
  /** Write to the friend: the answer is the chat, with the message in it. */
  send: (profileId: string, friendId: string, text: string) => ask(ChatThreadSchema, "POST", base(profileId, friendId), { text }),
  /** Take back one of one's own messages: gone for both. The answer is the chat. */
  takeBack: (profileId: string, friendId: string, id: number) => ask(ChatThreadSchema, "DELETE", `${base(profileId, friendId)}/${id}`),
  /** Stop hearing of the friend's messages (the friend is not told), or hear again. */
  mute: (profileId: string, friendId: string, muted: boolean) => ask(ChatMuteSchema, "PUT", `${base(profileId, friendId)}/mute`, { muted }),
  /** What a report would hold: the last messages, and the revision they are at. */
  reportPreview: (profileId: string, friendId: string) => ask(ChatReportPreviewSchema, "GET", `${base(profileId, friendId)}/report`),
  /** Send those messages to the team. `rev` is the revision the page showed: a chat that has changed since is refused ("changed"). */
  report: async (profileId: string, friendId: string, rev: number): Promise<void> => void (await request("POST", `${base(profileId, friendId)}/report`, { rev })),
};
