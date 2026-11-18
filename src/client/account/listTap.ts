import { DEFAULT_LIST, listKey, type ListInfo } from "../../shared";

export type ListTap = "add" | "remove" | "pick";

export function listTap(lists: readonly Pick<ListInfo, "id">[], saved: ReadonlySet<string>, url: string): ListTap {
  const has = (id: string) => saved.has(listKey(url, id));
  if (lists.some((info) => info.id !== DEFAULT_LIST && has(info.id))) return "pick";
  return has(DEFAULT_LIST) ? "remove" : "add";
}
