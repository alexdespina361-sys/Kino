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

  /* the menu of a right click on the cat (it has "Pet" and "Come here" of the panel too), and the cat that was sent to sleep */
  "cat.menu.sleep": "Send to sleep",
  "cat.asleep": "The cat is asleep.",
  "cat.wake": "Wake the cat",

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
  "cat.settings.behaviour": "What it does",
  "cat.settings.look": "What it looks like",
  "cat.settings.quiet": "Quiet cat (it rests and does not wander)",
  "cat.settings.films": "Keep me company during films",
  "cat.settings.cat": "Which cat",
  "cat.look.ragdoll": "White and grey cat",
  "cat.look.ginger": "Ginger cat",
  "cat.look.ragdoll.help": "The detailed one: fluffy, blue-eyed, and drawn on your screen's graphics. A screen that cannot spare them gets it drawn simply, in the same colours.",
  "cat.look.ginger.help": "A cartoon cat, light to draw on any screen.",
  "cat.shown.solid": "Showing the detailed cat.",
  "cat.shown.slow": "This screen could not keep up with the detailed cat, so it is drawn simply.",
  "cat.shown.graphics": "This browser would not give the graphics the detailed cat needs, so it is drawn simply.",
  "cat.shown.file": "The detailed cat's file did not come through, so it is drawn simply.",
  "cat.shown.lost": "The browser took the detailed cat's graphics away, so it is drawn simply.",
  "cat.shown.retry": "Try the detailed cat again",
  "cat.settings.size": "Size",
  "cat.size.small": "Small",
  "cat.size.normal": "Normal",
  "cat.size.large": "Large",
  "cat.settings.help": "A cat that lives on the screen: it walks along the rows of titles, naps at the foot of the film and can be petted. With a mouse you can also pick it up and put it on another row, or right-click it to send it to sleep. It never plays anything by itself.",
  "cat.settings.credit": "The white and grey cat is based on the model \"Fluffy Blue-Eyed Cat\" by Meshy AI (CC BY 4.0, creativecommons.org/licenses/by/4.0), changed to fit. Its standing animation is adapted from the \"Fox\" animation by tomkranis, converted to glTF by AsoboStudio and scurest (CC BY 4.0), changed to fit.",
} as const;

export type CatDictionary = Record<keyof typeof catEn, string> & Record<string, string>;
