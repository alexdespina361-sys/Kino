const KEEP_IN_THE_PAGE: Record<string, string> = {
  controlslist: "nodownload nofullscreen noremoteplayback",
  "webkit-playsinline": "",
  "x5-playsinline": "",
  "x5-video-player-type": "h5-page",
  "t7-video-player-type": "inline",
  "x-webkit-airplay": "deny",
};

type WebKitVideo = HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitExitFullscreen?: () => void };

export function keepNativePlayerOut(video: HTMLVideoElement): () => void {
  for (const [name, value] of Object.entries(KEEP_IN_THE_PAGE)) video.setAttribute(name, value);
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.controls = false;

  const noControls = new MutationObserver(() => {
    if (video.controls) video.controls = false;
  });
  noControls.observe(video, { attributes: true, attributeFilter: ["controls"] });
  const leaveVideoFullscreen = () => {
    if (document.fullscreenElement === video) document.exitFullscreen().catch(() => {});
    const legacy = video as WebKitVideo;
    if (legacy.webkitDisplayingFullscreen) legacy.webkitExitFullscreen?.();
  };
  const noMenu = (event: Event) => event.preventDefault();
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
