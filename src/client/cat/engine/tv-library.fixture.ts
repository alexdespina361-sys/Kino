import type { World } from "../types";

/**
 * The page the cat read on the TV's library (`/tv`, the library of the end-to-end tests, 1280x720, the first card focused, nothing moved), as the cat's own
 * `?cat=debug` handle gives it: three places to stand (two rows of posters and the floor of the screen), the zones it keeps out of, and the names under the
 * cards of the row at the foot of the screen. A real page, with the layout the real page has: what a test of the cat's manners is tried on.
 */
export const tvLibrary: World = {
  viewport: { x: 0, y: 0, w: 1280, h: 720 },
  bodyLength: 74,
  surfaces: [
    { id: "row1", kind: "shelfTop", y: 345.4, x0: 0, x1: 1280, weight: 1 },
    { id: "row2", kind: "shelfTop", y: 562.6, x0: 0, x1: 1280, weight: 1 },
    { id: "floor", kind: "fallbackFloor", y: 711.4, x0: 0, x1: 1280, weight: 0.4 }
  ],
  keepOut: [
    { x: -1.9, y: -1.9, w: 1283.8, h: 87 },
    { x: -1.9, y: -1.9, w: 96, h: 723.8 },
    { x: 87.7, y: 81.3, w: 592.7, h: 221.4 },
    { x: 1209, y: 399.8, w: 55, h: 55 },
    { x: 1209, y: 590.3, w: 55, h: 55 },
    { x: 1209, y: 803.1, w: 55, h: 55 },
    { x: 1209, y: 1016, w: 55, h: 55 },
    { x: 1209, y: 1176.3, w: 55, h: 55 },
    { x: 1209, y: 1389.1, w: 55, h: 55 },
    { x: 1209, y: 1602, w: 55, h: 55 },
    { x: 87.7, y: 306.5, w: 167.6, h: 31.8 },
    { x: 87.7, y: 523.9, w: 162.1, h: 31.8 },
    { x: 87.7, y: 736.8, w: 146.6, h: 31.8 },
    { x: 87.7, y: 949.6, w: 198.4, h: 31.8 },
    { x: 87.7, y: 1109.9, w: 171.7, h: 31.8 },
    { x: 87.7, y: 1322.8, w: 144.7, h: 31.8 },
    { x: 87.7, y: 1535.6, w: 133.7, h: 31.8 },
    { x: 87.7, y: 81.3, w: 148.3, h: 29.8 },
    { x: 79.8, y: 335.3, w: 174.4, h: 185.3 }
  ],
  targets: [
    {
      id: "m0",
      rect: { x: 84.9, y: 340.4, w: 164.2, h: 175 },
      surfaceId: "row1"
    },
    {
      id: "m1",
      rect: { x: 261.1, y: 345.4, w: 154.9, h: 165.1 },
      surfaceId: "row1"
    },
    {
      id: "m2",
      rect: { x: 432.6, y: 345.4, w: 154.9, h: 165.1 },
      surfaceId: "row1"
    },
    {
      id: "m3",
      rect: { x: 604.1, y: 345.4, w: 154.9, h: 165.1 },
      surfaceId: "row1"
    },
    {
      id: "m4",
      rect: { x: 775.6, y: 345.4, w: 154.9, h: 165.1 },
      surfaceId: "row1"
    },
    {
      id: "m5",
      rect: { x: 947.1, y: 345.4, w: 154.9, h: 165.1 },
      surfaceId: "row1"
    },
    {
      id: "m6",
      rect: { x: 1118.6, y: 345.4, w: 154.9, h: 165.1 },
      surfaceId: "row1"
    },
    {
      id: "m3",
      rect: { x: 89.6, y: 562.8, w: 192, h: 160.6 },
      surfaceId: "row2"
    },
    {
      id: "m4",
      rect: { x: 298.2, y: 562.8, w: 192, h: 160.6 },
      surfaceId: "row2"
    },
    {
      id: "m5",
      rect: { x: 506.8, y: 562.8, w: 192, h: 160.6 },
      surfaceId: "row2"
    },
    {
      id: "m6",
      rect: { x: 715.5, y: 562.8, w: 192, h: 160.6 },
      surfaceId: "row2"
    },
    {
      id: "m7",
      rect: { x: 924.1, y: 562.8, w: 192, h: 160.6 },
      surfaceId: "row2"
    },
    {
      id: "m8",
      rect: { x: 1132.7, y: 562.8, w: 192, h: 160.6 },
      surfaceId: "row2"
    }
  ],
  mode: "browse",
  player: "none",
  controlsUp: false,
  quiet: false,
  reducedMotion: false,
  focus: { x: 84.9, y: 340.4, w: 164.2, h: 175 },
  soft: [
    { x: 88.8, y: 673.5, w: 127.8, h: 23.5 },
    { x: 88.8, y: 700.6, w: 37.4, h: 23.5 },
    { x: 297.5, y: 673.5, w: 156.4, h: 23.5 },
    { x: 297.5, y: 700.6, w: 37.4, h: 23.5 },
    { x: 506.1, y: 673.5, w: 138.2, h: 23.5 },
    { x: 506.1, y: 700.6, w: 37.4, h: 23.5 },
    { x: 714.7, y: 673.5, w: 135.1, h: 23.5 },
    { x: 714.7, y: 700.6, w: 37.4, h: 23.5 },
    { x: 923.3, y: 673.5, w: 87.7, h: 23.5 },
    { x: 923.3, y: 700.6, w: 37.4, h: 23.5 },
    { x: 1132, y: 673.5, w: 167, h: 23.5 },
    { x: 1132, y: 700.6, w: 37.4, h: 23.5 }
  ]
};
