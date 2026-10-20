/**
 * The words of the cat companion (client/cat), in English. Kept apart from en.ts so that the cat is one piece; en.ts spreads them in, and ro.ts and
 * it.ts do the same with cat.ro.ts and cat.it.ts (the compiler and i18n.test.ts check that they have every key, and the same placeholders).
 */
export const catEn = {
  /* the button in the library's corner, and the panel it opens */
  "cat.chip": "Cat",
  "cat.panel": "Cat companion",
  "cat.come": "Come here",
  "cat.pet": "Pet",
  "cat.sit": "Sit",
  "cat.sleep": "Sleep",
  "cat.play": "Play",
  "cat.away": "Send away",
  "cat.find": "Find me something",
  "cat.close": "Close",
  "cat.back": "Back",

  /* "find me something": what the viewer is in the mood for, then what the cat found on the page */
  "cat.findAsk": "What are you in the mood for?",
  "cat.mood.funny": "Something funny",
  "cat.mood.scary": "Something scary",
  "cat.mood.exciting": "Something exciting",
  "cat.mood.romantic": "Romance",
  "cat.mood.family": "For the family",
  "cat.mood.scifi": "Sci-fi and fantasy",
  "cat.mood.classic": "A classic",
  "cat.mood.new": "Something new",
  "cat.mood.any": "Surprise me",
  "cat.pick": "How about “{title}”?",
  "cat.pickYear": "How about “{title}” ({year})?",
  "cat.pickWhere": "From “{shelf}”",
  "cat.open": "Open it",
  "cat.another": "Another one",
  "cat.nothing": "I can't find anything like that on this page. Try another mood, or another page.",

  /* the settings page */
  "cat.settings.title": "Cat companion",
  "cat.settings.on": "A cat on this screen",
  "cat.settings.quiet": "Quiet cat (it rests and does not wander)",
  "cat.settings.films": "Keep me company during films",
  "cat.settings.help": "A cat that lives on the screen: it walks along the rows of titles, naps in a corner of the film and can be petted. It never plays anything by itself.",
} as const;

export type CatDictionary = Record<keyof typeof catEn, string> & Record<string, string>;
