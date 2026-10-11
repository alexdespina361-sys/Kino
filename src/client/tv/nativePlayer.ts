/**
 * The page plays the video and draws every control over it. Some TV browsers have a player of their own that they put over, or in
 * place of, any video (a bar, a full screen, picture-in-picture, a cast button), and while it is up the remote's keys go to it and never
 * reach the page. A page can't switch such a player off. It can tell the browser, in every way a browser listens to, that this video
 * wants none of it, and put right whatever the browser adds to the video anyway.
 */

/** Hints for the players of different engines: Chromium's own controls, older WebKit's, and the engines (X5, UC) that take a video over unless told to keep it in the page. */
const KEEP_IN_THE_PAGE: Record<string, string> = {
  controlslist: "nodownload nofullscreen noremoteplayback",
  "webkit-playsinline": "",
  "x5-playsinline": "",
  "x5-video-player-type": "h5-page",
  "t7-video-player-type": "inline",
  "x-webkit-airplay": "deny",
};

type WebKitVideo = HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitExitFullscreen?: () => void };

/** Tells this video to stay a plain picture, for as long as the page lives. Returns the undo. */
export function keepNativePlayerOut(video: HTMLVideoElement): () => void {
  for (const [name, value] of Object.entries(KEEP_IN_THE_PAGE)) video.setAttribute(name, value);
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.controls = false;

  // Controls that something else switches on are switched off again; so is a full screen of the video alone (the page's own is of the whole page).
  const noControls = new MutationObserver(() => {
    if (video.controls) video.controls = false;
  });
  noControls.observe(video, { attributes: true, attributeFilter: ["controls"] });
  const leaveVideoFullscreen = () => {
    if (document.fullscreenElement === video) document.exitFullscreen().catch(() => {});
    const legacy = video as WebKitVideo;
    if (legacy.webkitDisplayingFullscreen) legacy.webkitExitFullscreen?.();
  };
  const noMenu = (event: Event) => event.preventDefault(); // ("Show controls", "Picture in picture"... of a long press)
  video.addEventListener("webkitbeginfullscreen", leaveVideoFullscreen);
  video.addEventListener("contextmenu", noMenu);
  document.addEventListener("fullscreenchange", leaveVideoFullscreen);

  return () => {
    noControls.disconnect();
    video.removeEventListener("webkitbeginfullscreen", leaveVideoFullscreen);
    video.removeEventListener("contextmenu", noMenu);
    document.removeEventListener("fullscreenchange", leaveVideoFullscreen);
  };
}
