/**
 * The words of the phone's shell (client/controller/shell), in English: the bar of destinations at the bottom, the mini remote above it, a search that lists
 * something before anything is typed, the empty "My lists". They are kept apart from en.ts so that the shell is one piece; en.ts spreads them in, and ro.ts
 * and it.ts do the same with shell.ro.ts and shell.it.ts (the compiler and i18n.test.ts check that they have every key, and the same placeholders).
 * docs/phone-layout/PLAN.md has the reasons for each.
 */
export const shellEn = {
  /* the bar at the bottom: four places, always there */
  "tabs.label": "Main navigation",
  "tabs.home": "Home",
  "tabs.search": "Search",
  "tabs.list": "My lists",
  "tabs.you": "You",

  /* a list worth tapping before anything is typed */
  "search.popular": "Popular right now",

  /* My lists, with nothing in it */
  "lists.emptyTitle": "Nothing saved yet",
  "lists.browse": "Find something to watch",
} as const;

export type ShellDictionary = Record<keyof typeof shellEn, string> & Record<string, string>;
