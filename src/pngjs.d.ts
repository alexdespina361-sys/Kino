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
