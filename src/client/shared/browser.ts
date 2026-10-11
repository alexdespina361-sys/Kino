/**
 * Hisense's TV browser (the VIDAA system's, "Hi Browser"). The page already has its whole screen there, and a page that asks that
 * browser for a full screen can take it down, or have a player of the browser's own come up over the picture that takes the remote's
 * keys, so on it the page never asks. (A Hisense phone says it is mobile, and is left alone.)
 */
export const isHisense = (agent: string = navigator.userAgent): boolean =>
  /vidaa/i.test(agent) || (/hisense|hi ?browser/i.test(agent) && !/mobile/i.test(agent));
