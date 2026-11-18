import { Fragment, type ReactNode } from "react";
import { t, useLanguage, type Key, type Params } from ".";

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
