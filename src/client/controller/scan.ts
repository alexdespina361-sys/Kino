/**
 * What the TV's QR code says: a link to this app with the pairing code in it ("https://host/?code=123456").
 * Only the six digits are used, never the link itself, so a QR code from anywhere can at worst submit a code to our own server.
 * A bare six-digit number is accepted too, for anyone who photographs the code instead.
 */
export function codeFromScan(text: string): string | null {
  const value = text.trim();
  if (/^\d{6}$/.test(value)) return value;
  try {
    const code = new URL(value).searchParams.get("code");
    return code && /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}
