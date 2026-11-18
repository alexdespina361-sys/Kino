import { useShown, type Named } from "./names";

/** A title's name in the viewer's language (see `names.ts`): its English one until the other is known, and where there is no other. */
export function ShownTitle({ of }: { of: Named }) {
  return <>{useShown(of).title}</>;
}
