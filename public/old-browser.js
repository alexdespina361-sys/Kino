/*
 * When Kino does not start at all - a browser too old for it (no modules, or syntax it cannot read: the build is for Chrome 94, Safari 16,
 * Firefox 104, Edge 107), or the app's file did not arrive - the page would stay black. This says so instead, with a button to try again.
 *
 * The app marks the page as started as the first thing it runs (`data-kino-started`, src/client/main.tsx): a browser that could read it has
 * set that before the page's `load`. Nothing is decided from what the app draws (a TV's player can take its time). Written in old JavaScript
 * on purpose (no let, no arrow functions), and a file of its own, as the site's pages allow no script written into them.
 */
(function () {
  var shown = false;

  function started() {
    return document.documentElement.getAttribute("data-kino-started") === "1";
  }

  function words() {
    var language = String(navigator.language || navigator.userLanguage || "en").toLowerCase();
    if (language.indexOf("ro") === 0)
      return {
        title: "Kino nu a putut porni",
        body: "Verifică legătura la internet și încearcă din nou. Dacă se repetă, browserul acesta este prea vechi pentru Kino: e nevoie de Chrome 94, Safari 16, Firefox 104, Edge 107 sau mai nou.",
        again: "Încearcă din nou",
      };
    if (language.indexOf("it") === 0)
      return {
        title: "Kino non è riuscito ad avviarsi",
        body: "Controlla la connessione e riprova. Se succede di nuovo, questo browser è troppo vecchio per Kino: serve Chrome 94, Safari 16, Firefox 104, Edge 107 o più recente.",
        again: "Riprova",
      };
    return {
      title: "Kino could not start",
      body: "Check the connection and try again. If it happens again, this browser is too old for Kino: it needs Chrome 94, Safari 16, Firefox 104, Edge 107 or newer.",
      again: "Try again",
    };
  }

  function show() {
    if (shown || started() || !document.body) return;
    shown = true;
    var text = words();
    var box = document.createElement("div");
    box.id = "kino-old-browser";
    box.setAttribute("role", "alert");
    var s = box.style;
    s.position = "fixed";
    s.left = s.top = s.right = s.bottom = "0";
    s.zIndex = "2147483647";
    s.background = "#0b0b0c";
    s.color = "#f2f2f3";
    s.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    s.textAlign = "center";
    s.padding = "10vh 6vw";
    s.overflow = "auto";

    var title = document.createElement("h1");
    title.appendChild(document.createTextNode(text.title));
    title.style.fontSize = "2em";
    title.style.margin = "0 0 0.6em";

    var body = document.createElement("p");
    body.appendChild(document.createTextNode(text.body));
    body.style.fontSize = "1.25em";
    body.style.lineHeight = "1.5";
    body.style.maxWidth = "38em";
    body.style.margin = "0 auto 1.6em";

    var again = document.createElement("button");
    again.type = "button";
    again.appendChild(document.createTextNode(text.again));
    var b = again.style;
    b.fontSize = "1.25em";
    b.padding = "0.7em 1.6em";
    b.border = "0";
    b.borderRadius = "999px";
    b.background = "#e50914";
    b.color = "#fff";
    b.cursor = "pointer";
    again.onclick = function () {
      location.reload();
    };

    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(again);
    document.body.appendChild(box);
    // A TV's remote has no pointer: its OK key presses what has the focus.
    try {
      again.focus();
    } catch (error) {}
  }

  function later(ms) {
    setTimeout(show, ms);
  }

  // The app's own file runs before `load` (a module is run before the page counts as loaded); a moment more for a slow TV.
  if (window.addEventListener) {
    window.addEventListener("load", function () {
      later(3000);
    });
  } else if (window.attachEvent) {
    window.attachEvent("onload", function () {
      later(3000);
    });
  }
  // And if `load` never comes (something of the page that does not finish arriving).
  later(60000);
})();
