/** Which folder the aligner's files are in (see public/subtitle-sync/1/README.md). A changed file gets a new folder, so these are kept by the browser for good. */
export const ASSET_VERSION = "1";
export const ASSET_BASE = `/subtitle-sync/${ASSET_VERSION}/`;

/** The speech recogniser's model: its size and checksum are checked by the worker while it loads. */
export const WHISTLE_MODEL = {
  file: "whistle.cact",
  size: 16_919_407,
  sha256: "b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb",
} as const;

export const assetUrl = (file: string): string => new URL(`${ASSET_BASE}${file}`, globalThis.location?.href ?? "http://localhost/").href;
