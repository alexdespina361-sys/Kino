export const shellEn = {
  "tabs.label": "Main navigation",
  "tabs.home": "Home",
  "tabs.search": "Search",
  "tabs.list": "My Lists",
  "tabs.you": "You",

  "remote.open": "Open the remote",

  "lists.emptyTitle": "Nothing saved yet",
  "lists.browse": "Find something to watch",

  "rows.seeAll": "See all",
} as const;

export type ShellDictionary = Record<keyof typeof shellEn, string> & Record<string, string>;
