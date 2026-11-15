import { DEFAULT_LIST, listKey, type ListInfo } from "../../shared";

/**
 * What one tap on a title's "+" does: `add` it to the main list (the first, Favourites, which is always there), `remove` it from the main list,
 * or `pick` (the title is in another list too, and one tap cannot say which of them is meant: the picker shows them all). A title goes into
 * another list from the button "Other lists" of its page, which opens the same picker.
 */
export type ListTap = "add" | "remove" | "pick";

export function listTap(lists: readonly Pick<ListInfo, "id">[], saved: ReadonlySet<string>, url: string): ListTap {
  const has = (id: string) => saved.has(listKey(url, id));
  if (lists.some((info) => info.id !== DEFAULT_LIST && has(info.id))) return "pick";
  return has(DEFAULT_LIST) ? "remove" : "add";
}
