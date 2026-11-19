export const plainWord = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();

export const wordTyped = (typed: string, word: string): boolean => plainWord(typed) === plainWord(word);
