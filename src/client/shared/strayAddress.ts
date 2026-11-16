/**
 * An address the site has no page for (`/does-not-exist`). The server answers it with the page all the same, and a 404 (src/server/app.ts), and the page
 * opens as it would at "/", says so in a line, and puts "/" in the address (with what followed the path: `?party=` and the rest still work). It used to
 * open Home without a word (the judge, 16 Nov).
 */

/** The site's pages: "/" (whichever screen this device is) and "/tv" (the screen that plays), with or without a last slash. */
export const isOwnPage = (pathname: string): boolean => {
  const path = pathname.replace(/\/+$/, "");
  return path === "" || path === "/tv";
};

let stray = false;

/** At the start of a page load: an address that is none of the site's pages is noted, and the address becomes "/". */
export function noteStrayAddress(): void {
  if (typeof location === "undefined" || typeof history === "undefined" || isOwnPage(location.pathname)) return;
  stray = true;
  history.replaceState(history.state, "", `/${location.search}${location.hash}`);
}

/** Whether this page load came from such an address, until that has been said (`forgetStrayAddress`): a page drawn again does not say it again. */
export const strayAddress = (): boolean => stray;

/** It has been said. */
export function forgetStrayAddress(): void {
  stray = false;
}

/** Whether this page load came from such an address, and it has been said from now on (for a caller that keeps the line itself, as the library does). */
export function takeStrayAddress(): boolean {
  const was = stray;
  stray = false;
  return was;
}
