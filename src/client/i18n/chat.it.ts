import type { ChatDictionary } from "./chat.en";

/** Italiano: le stesse chiavi di chat.en.ts (lo controlla il compilatore); le forme del plurale sono `_one`, `_other`. */
export const chatIt: ChatDictionary = {
  /* l'ingresso */
  "chat.open": "Chat",
  "chat.title": "Chat con {name}",

  /* la conversazione */
  "chat.empty": "Ancora nessun messaggio. Saluta {name}.",
  "chat.privacy": "Solo testo semplice; i link non si possono toccare. Si conservano solo gli ultimi {messages} messaggi, per al massimo {days} giorni, e sono salvati sul server senza cifratura: non mandare niente di privato.",
  "chat.you": "Tu",
  "chat.messageLabel": "Messaggio",
  "chat.placeholder": "Scrivi un messaggio",
  "chat.compose": "Scrivi un messaggio",
  "chat.writeTitle": "Messaggio per {name}",
  "chat.send": "Invia",
  "chat.takeBack": "Ritira",
  "chat.takeBackLast": "Ritira l'ultimo messaggio",
  "chat.mute": "Silenzia",
  "chat.unmute": "Riattiva",
  "chat.muted": "Silenziata: non ricevi avvisi per i nuovi messaggi di {name}, e {name} non ne sa niente.",
  "chat.closed": "{name} non riceve messaggi.",
  "chat.mineOff": "I messaggi degli amici sono disattivati per te, quindi {name} non può risponderti. Attivali nelle impostazioni degli amici.",

  /* dire al team di una chat */
  "chat.report": "Segnala",
  "chat.reportTitle": "Segnala questa chat",
  "chat.reportLead": "Questi sono gli ultimi messaggi di questa chat. Se invii la segnalazione, il team di Kino legge esattamente questi, con il tuo nome e quello di {name}, e nient'altro. {name} non ne sa niente.",
  "chat.reportSend": "Invia al team di Kino",
  "chat.reportSent": "Inviato al team di Kino. Grazie.",
  "chat.reportChanged": "La chat è cambiata mentre guardavi. Controlla di nuovo i messaggi.",
  "chat.reportNone": "Non c'è ancora niente da segnalare.",

  /* cosa è andato storto */
  "chat.error.too_long": "È troppo lungo: al massimo {max} caratteri.",
  "chat.error.empty": "Scrivi prima qualcosa.",
  "chat.error.gone": "Quel messaggio non c'è più.",
  "chat.error.chat_off": "{name} non riceve messaggi.",
  "chat.error.rate_limited": "Stai mandando molti messaggi. Aspetta un attimo.",

  /* cosa aspetta */
  "chat.unread_one": "{count} nuovo messaggio da {name}",
  "chat.unread_other": "{count} nuovi messaggi da {name}",
  "chat.unreadShort_one": "{count} nuovo messaggio",
  "chat.unreadShort_other": "{count} nuovi messaggi",

  /* l'impostazione del profilo */
  "chat.settingsSwitch": "Gli amici possono scrivermi",
  "chat.settingsHint": "I messaggi sono testo semplice, salvato sul server senza cifratura. Si conservano gli ultimi {messages} con ogni amico, per al massimo {days} giorni.",
};
