// Runs only on Kino. The extension can prepare a supported video URL; it accepts no arbitrary fetch commands.
const announce = () => document.documentElement?.setAttribute("data-kino-direct", "1");
announce();
document.addEventListener("DOMContentLoaded", announce, { once: true });
window.addEventListener("message", (event) => {
  const request = event.data;
  if (event.source !== window || event.origin !== location.origin || request?.channel !== "kino-direct" || request.type !== "prepare" ||
      typeof request.id !== "string" || request.id.length > 100 || typeof request.url !== "string" || request.url.length > 4096) return;
  chrome.runtime.sendMessage({ channel: "kino-direct", type: "prepare", url: request.url }, (answer) => {
    const error = chrome.runtime.lastError?.message;
    window.postMessage({ channel: "kino-direct", type: "prepared", id: request.id,
      ...(error ? { error: "Reload Kino after reloading the extension" } : answer || { error: "No extension response" }),
    }, location.origin);
  });
});
