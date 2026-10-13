/**
 * What a new password is worth, said before an account is made: "none" for no password at all (anyone who types the name is in), "weak" for one
 * that is quick to guess (short, the name itself, one character over and over, or one of the first things anybody tries), nothing for the rest.
 * A nudge and not a rule: the server takes any password, and the person decides.
 */
export type Weakness = "none" | "weak";

/** Shorter than this is quick to guess. */
export const GOOD_LENGTH = 6;

const FIRST_GUESSES = new Set([
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "987654321",
  "654321",
  "password",
  "passw0rd",
  "parola",
  "parola123",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "abc123",
  "abcdef",
  "abcdefg",
  "iloveyou",
  "letmein",
  "welcome",
  "admin",
  "admin123",
  "kino",
  "kino123",
]);

/** `name` is the name the account is made with, as it was typed. */
export function weakness(name: string, password: string): Weakness | null {
  if (password === "") return "none";
  const word = password.toLowerCase();
  if ([...word].length < GOOD_LENGTH) return "weak";
  if (word === name.trim().toLowerCase()) return "weak";
  if (new Set(word).size === 1) return "weak";
  if (FIRST_GUESSES.has(word)) return "weak";
  return null;
}
