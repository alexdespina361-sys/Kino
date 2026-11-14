/*
 * What the log says about a request. Fastify's own line gives the whole address asked for and the address it came from: here the first is a link that
 * plays a film, the code Google sends a sign-in back with, the words somebody searched for, the code of a party or of a friend, and the second is the
 * visitor. A log is read by whoever keeps the machine and is kept for weeks, so it says which route was asked, with which questions (their names, and
 * the few values that say nothing about anybody), and not by whom. A request that was refused (403, 429) is the one case in which the address is
 * written: it is how a limit that somebody keeps running into is told from one that is wrong (see `refusals` in app.ts).
 */

/** The questions whose value says nothing about a visitor and helps to read the log. */
const PLAIN = new Set(["format", "season", "episode", "page", "cursor", "kind", "section", "type", "role", "lang", "row"]);

/** The address asked for, as the log may have it: the path, each question's name, and its value only where it is one of `PLAIN` (`/api/proxy` keeps the host of what it was asked to carry). */
export function addressForLog(address: string): string {
  const at = address.indexOf("?");
  const path = (at < 0 ? address : address.slice(0, at)).slice(0, 200);
  if (at < 0) return path;
  const parts: string[] = [];
  for (const [name, value] of new URLSearchParams(address.slice(at + 1))) {
    if (parts.length >= 12) break;
    const key = name.slice(0, 40);
    if (PLAIN.has(name) && /^[\w.-]{0,24}$/.test(value)) parts.push(`${key}=${value}`);
    else if (name === "url" && path === "/api/proxy") parts.push(`${key}=${hostOf(value)}`);
    else parts.push(`${key}=_`);
  }
  return `${path}?${parts.join("&")}`;
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname.slice(0, 100) || "_";
  } catch {
    return "_";
  }
}

interface Asked {
  method?: string;
  url?: string;
  host?: string;
  routeOptions?: { url?: string };
}

/**
 * Fastify's `req` in a log line. The route as it is declared (`/api/profiles/:id/…`: the profile is not named) where the request found one, else the
 * path as it was written (what a scanner asks for is worth seeing), and the questions as `addressForLog` gives them. No address of the visitor, no port.
 */
export function requestForLog(request: Asked): { method?: string; url: string; host?: string } {
  const asked = request.url ?? "";
  const at = asked.indexOf("?");
  const route = request.routeOptions?.url;
  const address = addressForLog(route && route !== "*" && !route.endsWith("/*") ? `${route}${at < 0 ? "" : asked.slice(at)}` : asked);
  return { method: request.method, url: address, ...(request.host ? { host: request.host.slice(0, 100) } : {}) };
}

/**
 * Whether an address that found no route may be answered with the page (one page serves every screen, so an address of the site's own that the server
 * does not know is the page's to make sense of). A file (`/x.php`, `/.env`), a folder whose name starts with a dot, and the places a scanner looks for
 * somebody else's software are not pages of this site: they are answered 404, which is what tells a scanner there is nothing here.
 */
export function looksLikePage(address: string): boolean {
  const path = address.split("?", 1)[0] ?? "";
  if (path.includes(".") || path.includes("%2e") || path.includes("%2E")) return false;
  return !/^\/+(wp-|wordpress|cgi-bin|phpmyadmin|xmlrpc)/i.test(path);
}
