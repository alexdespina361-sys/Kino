export type Weakness = "none" | "weak";

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

export function weakness(name: string, password: string): Weakness | null {
  if (password === "") return "none";
  const word = password.toLowerCase();
  if ([...word].length < GOOD_LENGTH) return "weak";
  if (word === name.trim().toLowerCase()) return "weak";
  if (new Set(word).size === 1) return "weak";
  if (FIRST_GUESSES.has(word)) return "weak";
  return null;
}
