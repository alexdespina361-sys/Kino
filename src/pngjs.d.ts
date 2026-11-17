// pngjs has no types of its own. What this repository uses of it: the end-to-end tests read the pixels of a picture, and the server unpacks a personal
// sticker the page sent and makes a PNG of its own from the pixels (server/accounts/stickerImage.ts).
declare module "pngjs" {
  export interface PngReadOptions {
    checkCRC?: boolean;
  }
  export interface PngWriteOptions {
    colorType?: 0 | 2 | 4 | 6;
    inputColorType?: 0 | 2 | 4 | 6;
    inputHasAlpha?: boolean;
    bitDepth?: 8 | 16;
    deflateLevel?: number;
  }
  export class PNG {
    constructor(options: { width: number; height: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer, options?: PngReadOptions): { width: number; height: number; data: Buffer };
      write(png: PNG, options?: PngWriteOptions): Buffer;
    };
  }
}
