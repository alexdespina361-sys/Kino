let asker: object | null = null;

export const pinAsker = {
  set(who: object): void {
    asker = who;
  },
  is(who: object): boolean {
    return asker === who;
  },
};
