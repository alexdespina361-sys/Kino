/** Throwaway credentials for the end-to-end tests. They only ever exist in the in-memory store the tests start. */
export const TEST_ACCOUNT = { email: "viewer@kino.test", password: "kino-test-pass-1" } as const;
export const TEST_ACCOUNT_B = { email: "guest@kino.test", password: "kino-other-pass-2" } as const;
