const PLAIN = new Set(["format", "season", "episode", "page", "cursor", "kind", "section", "type", "role", "device", "lang", "row"]);

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

export function requestForLog(request: Asked): { method?: string; url: string; host?: string } {
  const asked = request.url ?? "";
  const at = asked.indexOf("?");
  const route = request.routeOptions?.url;
  const address = addressForLog(route && route !== "*" && !route.endsWith("/*") ? `${route}${at < 0 ? "" : asked.slice(at)}` : asked);
  return { method: request.method, url: address, ...(request.host ? { host: request.host.slice(0, 100) } : {}) };
}

export function isOwnPage(address: string): boolean {
  const path = (address.split("?", 1)[0] ?? "").replace(/\/+$/, "");
  return path === "" || path === "/tv";
}

export function looksLikePage(address: string): boolean {
  const path = address.split("?", 1)[0] ?? "";
  if (path.includes(".") || path.includes("%2e") || path.includes("%2E")) return false;
  return !/^\/+(wp-|wordpress|cgi-bin|phpmyadmin|xmlrpc)/i.test(path);
}
