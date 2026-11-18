import { useShown, type Named } from "./names";

export function ShownTitle({ of }: { of: Named }) {
  return <>{useShown(of).title}</>;
}
