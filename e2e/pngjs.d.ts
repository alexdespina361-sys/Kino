// pngjs has no types of its own, and the tests read only what they need of it: the pixels of a picture.
declare module "pngjs" {
  export const PNG: {
    sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } };
  };
}
