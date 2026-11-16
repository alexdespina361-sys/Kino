/*
 * How many tiles a grid of the big screen's page is across. The page is drawn for a 16 by 9 screen 100 of its units wide (tv.css, `--em`), and its grids
 * have as many tiles across as fit that: eight posters, four categories, five wide tiles, five posters beside the search's keys. A window wider than 16 by 9
 * (or, on a computer, a monitor wider than 1920 by 1080, where the page stops growing: `data-fit="desk"`) has room for more across, and gets them.
 */

/** On a computer the page stops growing with the window at this size of its unit, a 1920 by 1080 screen's (tv.css, `data-fit="desk"`: the same number there). */
export const DESK_EM_PX = 19.2;

/**
 * How wide a tile of each kind of grid is with the room beside it, in the page's units: a poster (polish/tv-posters.css: 9.4 and the gap of 1.3), a category (19 and 1.6),
 * a wide tile (tv.css: 15 and 1.6), a show's episode on its page (tv.css `.tv-detail-list`: two of about 44 share the page between its margins).
 */
export const PITCH_EM = { poster: 10.7, category: 20.6, wide: 16.6, episode: 45 } as const;

/** How many units wide the page is: 100 on a screen of 16 by 9 or narrower, more in a wider window, and on a computer's monitor past 1920 by 1080. */
export const pageWidth = (width: number, height: number, desk: boolean): number => {
  const unit = Math.max(Math.min(width / 100, height * 0.017778, desk ? DESK_EM_PX : Infinity), 9);
  return width / unit;
};

/** As many tiles across as the page was drawn with (`drawn`), and one more for each tile's room (`pitch`) the page is wider than 100 units. */
export const columnsFor = (width: number, drawn: number, pitch: number): number => (width > 100.5 ? drawn + Math.floor((width - 100) / pitch) : drawn);
