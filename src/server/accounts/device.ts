/** What to call a device in the list of places somebody is signed in: "Chrome on Windows", "Safari on iPhone". */
export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  const system = /Tizen/.test(ua)
    ? "Samsung TV"
    : /Web0S|webOS/i.test(ua)
      ? "LG TV"
      : /Android/.test(ua)
        ? /TV|AFT|BRAVIA|Philips|Hisense/i.test(ua)
          ? "Android TV"
          : "Android"
        : /iPhone/.test(ua)
          ? "iPhone"
          : /iPad/.test(ua)
            ? "iPad"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Windows/.test(ua)
                ? "Windows"
                : /Mac OS X|Macintosh/.test(ua)
                  ? "Mac"
                  : /Linux|X11/.test(ua)
                    ? "Linux"
                    : "";
  return system ? `${browser} on ${system}` : browser;
}
