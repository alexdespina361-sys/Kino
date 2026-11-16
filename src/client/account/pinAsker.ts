/**
 * Which of the phone's pages asked for the PIN of a child's profile last: that one shows the PIN's sheet, in place of what it shows (the account can be open twice, the
 * "You" tab under the account opened over a page, and a TV's sign-in can be approved from a page of its own). The TV has one place for it (`TvAccount`).
 */
let asker: object | null = null;

export const pinAsker = {
  /** `who` is about to ask (`childLock.grownUp`). */
  set(who: object): void {
    asker = who;
  },
  /** Whether `who` asked last. */
  is(who: object): boolean {
    return asker === who;
  },
};
