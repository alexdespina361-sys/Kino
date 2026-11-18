import { linkCodeOf } from "../shared/launch";

export function linkFromScan(text: string): string | null {
  const value = text.trim();
  const bare = linkCodeOf(value);
  if (bare && /^[A-Za-z0-9-]+$/.test(value)) return bare;
  try {
    return linkCodeOf(new URL(value).searchParams.get("link")) ?? null;
  } catch {
    return null;
  }
}

export function codeFromScan(text: string, names: readonly string[] = ["code", "control"]): string | null {
  const value = text.trim();
  if (/^\d{6}$/.test(value)) return value;
  try {
    const params = new URL(value).searchParams;
    const code = names.map((name) => params.get(name)).find((found) => found !== null && /^\d{6}$/.test(found));
    return code ?? null;
  } catch {
    return null;
  }
}
