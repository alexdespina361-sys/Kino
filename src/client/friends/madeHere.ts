/**
 * The friends this screen made itself since it was opened (it typed their code, said yes to their request, or asked one who had asked first): that they
 * are friends is no news to it, so its bell does not list them as new (see `bellView`). Only for as long as the page is open: after a reload, one made
 * just before can be listed once, which is all it costs.
 */
const made = new Set<string>();

export const madeHere: ReadonlySet<string> = made;

export function rememberMadeHere(friendId: string) {
  made.add(friendId);
}
