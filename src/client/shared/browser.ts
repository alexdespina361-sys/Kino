export const isHisense = (agent: string = navigator.userAgent): boolean =>
  /vidaa/i.test(agent) || (/hisense|hi ?browser/i.test(agent) && !/mobile/i.test(agent));
