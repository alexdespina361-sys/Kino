/**
 * The words of the chat between two friends (client/chat), in English. They are kept apart from en.ts so that the chat is one piece; en.ts
 * spreads them in, and ro.ts and it.ts do the same with chat.ro.ts and chat.it.ts (the compiler and i18n.test.ts check that they have every
 * key, and the same placeholders). `{messages}` and `{days}` are the limits of shared/chat.ts, so the line is never out of date.
 */
export const chatEn = {
  /* the entry: a chip on the TV's friend page, a button on the phone's */
  "chat.open": "Chat",
  "chat.title": "Chat with {name}",

  /* the thread */
  "chat.empty": "No messages yet. Say hello to {name}.",
  "chat.privacy": "Plain text only; links can't be pressed. Only the last {messages} messages are kept, for {days} days at most, and they are stored on the server without encryption: don't send anything private.",
  "chat.you": "You",
  "chat.messageLabel": "Message",
  "chat.placeholder": "Write a message",
  "chat.compose": "Write a message",
  "chat.writeTitle": "Message to {name}",
  "chat.send": "Send",
  "chat.takeBack": "Take back",
  "chat.takeBackLast": "Take back last message",
  "chat.mute": "Mute",
  "chat.unmute": "Unmute",
  "chat.muted": "Muted: you aren't told about new messages from {name}. {name} isn't told.",
  "chat.closed": "{name} isn't taking messages.",
  "chat.mineOff": "Messages from friends are turned off for you, so {name} can't answer. Turn them on in the Friends settings.",

  /* telling the team about a chat: it shows what will be sent, and sends it only when the one who reports says yes */
  "chat.report": "Report",
  "chat.reportTitle": "Report this chat",
  "chat.reportLead": "These are the last messages of this chat. If you send the report, the Kino team reads exactly these, with your name and {name}'s, and nothing else. {name} isn't told.",
  "chat.reportSend": "Send to the Kino team",
  "chat.reportSent": "Sent to the Kino team. Thank you.",
  "chat.reportChanged": "The chat changed while you were looking. Check the messages again.",
  "chat.reportNone": "There is nothing to report yet.",

  /* what went wrong (the network and the account ones are the website's own: error.offline, error.not_friends, error.friends_off) */
  "chat.error.too_long": "That is too long: up to {max} characters.",
  "chat.error.empty": "Write something first.",
  "chat.error.gone": "That message is already gone.",
  "chat.error.chat_off": "{name} isn't taking messages.",
  "chat.error.rate_limited": "You're sending a lot of messages. Wait a moment.",

  /* what is waiting: on the friends page, and in the bell */
  "chat.unread_one": "{count} new message from {name}",
  "chat.unread_other": "{count} new messages from {name}",
  "chat.unreadShort_one": "{count} new message",
  "chat.unreadShort_other": "{count} new messages",

  /* the profile's setting */
  "chat.settingsSwitch": "Friends can message me",
  "chat.settingsHint": "Messages are plain text, stored on the server without encryption. The last {messages} with each friend are kept, for {days} days at most.",
} as const;

export type ChatDictionary = Record<keyof typeof chatEn, string> & Record<string, string>;
