export const isOwnPage = (pathname: string): boolean => {
  const path = pathname.replace(/\/+$/, "");
  return path === "" || path === "/tv";
};

let stray = false;

export function noteStrayAddress(): void {
  if (typeof location === "undefined" || typeof history === "undefined" || isOwnPage(location.pathname)) return;
  stray = true;
  history.replaceState(history.state, "", `/${location.search}${location.hash}`);
}

export const strayAddress = (): boolean => stray;

export function forgetStrayAddress(): void {
  stray = false;
}

export function takeStrayAddress(): boolean {
  const was = stray;
  stray = false;
  return was;
}
