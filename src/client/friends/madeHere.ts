const made = new Set<string>();

export const madeHere: ReadonlySet<string> = made;

export function rememberMadeHere(friendId: string) {
  made.add(friendId);
}
