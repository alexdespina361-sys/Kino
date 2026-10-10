import { Fragment, type ReactNode } from "react";
import { t, useLanguage, type Key, type Params } from ".";

/**
 * A sentence with something in it that is more than text ("Open <b>tv.example.com</b> on it"): each `{name}` in the sentence
 * is replaced by the node of that name, wherever the language puts it. Other `{words}` are filled from `params` as usual.
 */
export function Rich({ k, params, parts }: { k: Key; params?: Params; parts: Record<string, ReactNode> }) {
  useLanguage();
  const marked = Object.fromEntries(Object.keys(parts).map((name) => [name, `{${name}}`]));
  const text = t(k, { ...params, ...marked });
  return (
    <>
      {text.split(/(\{\w+\})/).map((piece, index) => {
        const name = /^\{(\w+)\}$/.exec(piece)?.[1];
        return name !== undefined && name in parts ? <Fragment key={index}>{parts[name]}</Fragment> : piece;
      })}
    </>
  );
}
