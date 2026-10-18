import type { ChatDictionary } from "./chat.en";

/** Română: aceleași chei ca în chat.en.ts (compilatorul verifică); formele de plural sunt `_one`, `_few`, `_other`. "{days} de zile" e scris pentru 30 (cel puțin 20). */
export const chatRo: ChatDictionary = {
  /* intrarea */
  "chat.open": "Chat",
  "chat.title": "Chat cu {name}",

  /* conversația */
  "chat.empty": "Niciun mesaj încă. Spune-i salut lui {name}.",
  "chat.privacy": "Doar text simplu; linkurile nu se pot apăsa. Se păstrează doar ultimele {messages} de mesaje, cel mult {days} de zile, și sunt stocate pe server fără criptare: nu trimite nimic privat.",
  "chat.you": "Tu",
  "chat.messageLabel": "Mesaj",
  "chat.placeholder": "Scrie un mesaj",
  "chat.compose": "Scrie un mesaj",
  "chat.writeTitle": "Mesaj pentru {name}",
  "chat.send": "Trimite",
  "chat.takeBack": "Retrage",
  "chat.takeBackLast": "Retrage ultimul mesaj",
  "chat.mute": "Dă pe mut",
  "chat.unmute": "Scoate de pe mut",
  "chat.muted": "Pe mut: nu primești notificări despre mesajele noi de la {name}, iar {name} nu află asta.",
  "chat.closed": "{name} nu primește mesaje.",
  "chat.mineOff": "Mesajele de la prieteni sunt dezactivate pentru tine, așa că {name} nu îți poate răspunde. Activează-le din setările pentru prieteni.",

  /* a spune echipei despre o conversație */
  "chat.report": "Raportează",
  "chat.reportTitle": "Raportează conversația",
  "chat.reportLead": "Acestea sunt ultimele mesaje din conversație. Dacă trimiți raportul, echipa Kino citește exact aceste mesaje, cu numele tău și al lui {name}, și nimic altceva. {name} nu află.",
  "chat.reportSend": "Trimite echipei Kino",
  "chat.reportSent": "Trimis echipei Kino. Mulțumim.",
  "chat.reportChanged": "Conversația s-a schimbat cât timp te uitai. Verifică din nou mesajele.",
  "chat.reportNone": "Nu e nimic de raportat încă.",

  /* ce a mers prost */
  "chat.error.too_long": "E prea lung: cel mult {max} de caractere.",
  "chat.error.empty": "Scrie mai întâi ceva.",
  "chat.error.gone": "Mesajul nu mai e acolo.",
  "chat.error.chat_off": "{name} nu primește mesaje.",
  "chat.error.rate_limited": "Trimiți multe mesaje. Așteaptă un moment.",

  /* ce așteaptă */
  "chat.unread_one": "{count} mesaj nou de la {name}",
  "chat.unread_few": "{count} mesaje noi de la {name}",
  "chat.unread_other": "{count} de mesaje noi de la {name}",
  "chat.unreadShort_one": "{count} mesaj nou",
  "chat.unreadShort_few": "{count} mesaje noi",
  "chat.unreadShort_other": "{count} de mesaje noi",

  /* setarea profilului */
  "chat.settingsSwitch": "Prietenii îmi pot scrie mesaje",
  "chat.settingsHint": "Mesajele sunt text simplu, stocat pe server fără criptare. Se păstrează ultimele {messages} cu fiecare prieten, cel mult {days} de zile.",
};
