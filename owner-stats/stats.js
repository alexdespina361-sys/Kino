// The owner's page (docs/stats.md, "The owner's page"). It asks one address of the site, GET /api/owner/stats, with a key that reads counts and
// nothing else, and writes what comes back as text (never as markup). The key is kept in this browser and sent to the site that was typed, nowhere else.
(function () {
  "use strict";

  var EVERY_MS = 30000;
  var KEPT = "kino.owner-stats";
  var $ = function (id) {
    return document.getElementById(id);
  };
  var text = function (id, value) {
    $(id).textContent = value;
  };
  var number = function (value) {
    return typeof value === "number" && isFinite(value) ? value.toLocaleString("en-GB") : "0";
  };
  var kept = {
    read: function () {
      try {
        var value = JSON.parse(localStorage.getItem(KEPT) || "null");
        return value && typeof value.site === "string" && typeof value.key === "string" ? value : null;
      } catch (error) {
        return null;
      }
    },
    write: function (value) {
      try {
        localStorage.setItem(KEPT, JSON.stringify(value));
      } catch (error) {
        /* (a browser that keeps nothing: the key is asked for again next time) */
      }
    },
    forget: function () {
      try {
        localStorage.removeItem(KEPT);
      } catch (error) {
        /* nothing to forget */
      }
    },
  };

  /** The site's own address from what was typed: https (or this machine, for a try-out), nothing after the name. */
  function siteOf(typed) {
    try {
      var url = new URL(String(typed).trim());
      var local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      return url.protocol === "https:" || (url.protocol === "http:" && local) ? url.origin : null;
    } catch (error) {
      return null;
    }
  }

  var minutesAs = function (minutes) {
    var whole = Math.max(0, Math.round(minutes || 0));
    return whole < 60 ? whole + " min" : Math.floor(whole / 60) + " h " + (whole % 60) + " min";
  };
  var three = function (windows, as) {
    var show = as || number;
    return windows ? "7 days " + show(windows.week) + " · 30 days " + show(windows.month) : "";
  };
  var ago = function (at, now) {
    var minutes = Math.max(0, Math.round((now - at) / 60000));
    if (minutes < 60) return minutes + " min ago";
    if (minutes < 48 * 60) return Math.round(minutes / 60) + " h ago";
    return Math.round(minutes / 1440) + " days ago";
  };
  var hourOf = function (ms) {
    return new Date(ms).toISOString().slice(11, 16) + " UTC";
  };
  var empty = function (node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  };
  var make = function (tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  function show(view) {
    var now = view.now || {};
    text("now-people", number(now.people));
    text("now-who", number(now.signedIn) + " signed in · " + number(now.guests) + " guests (asked something in the last 5 minutes)");
    text("now-screens", now.tvs === undefined ? "" : number(now.tvs) + " screens and " + number(now.phones) + " phones connected");

    var accounts = view.accounts;
    text("acc-total", accounts ? number(accounts.total) : "–");
    text("acc-made", accounts ? "New: today " + number(accounts.made.today) + " · " + three(accounts.made) : "The accounts are not counted on this server.");
    text("acc-used", accounts ? "Used: today " + number(accounts.used.today) + " · " + three(accounts.used) : "");
    text(
      "acc-more",
      accounts ? number(accounts.profiles) + " profiles · room for " + number(accounts.limit) + " · sign-ups " + accounts.signUps + " · " + number(accounts.pushDevices) + " phones with notifications" : "",
    );

    var visits = view.visits;
    text("vis-today", visits ? number(visits.visitors.today) : "–");
    text("vis-more", visits ? "today · " + three(visits.visitors) + (visits.since ? " · counted since " + visits.since : "") : "Visitors are not counted on this server.");
    text("vis-loads", visits ? "Page loads: today " + number(visits.loads.today) + " · " + three(visits.loads) : "");

    var watched = view.watched && view.watched.minutes;
    text("min-today", watched ? minutesAs(watched.today) : "–");
    text("min-more", watched ? "today · " + three(watched, minutesAs) : "");

    var feedback = view.feedback;
    text("fb-open", feedback ? number(feedback.open) : "–");
    text("fb-more", feedback ? "open · " + number(feedback.fresh) + " nobody has touched · " + number(feedback.total) + " in all" : "");
    text("fb-received", feedback ? "Received: today " + number(feedback.received.today) + " · " + three(feedback.received) : "");

    var list = $("reports");
    empty(list);
    var latest = (feedback && feedback.latest) || [];
    if (latest.length === 0) list.appendChild(make("li")).appendChild(make("span", "none", "No reports."));
    latest.forEach(function (report) {
      var line = make("li");
      line.appendChild(make("span", "tag" + (report.status === "new" ? " is-new" : ""), String(report.status).replace("_", " ")));
      line.appendChild(make("span", "", report.heading || "(no heading)"));
      line.appendChild(make("span", "when", report.kind + " · " + report.area + " · " + ago(report.at, view.at)));
      list.appendChild(line);
    });

    var hours = view.answers || [];
    var most = hours.reduce(function (top, hour) {
      return Math.max(top, hour.requests);
    }, 1);
    var sum = hours.reduce(
      function (total, hour) {
        return { requests: total.requests + hour.requests, refused: total.refused + hour.refused, limited: total.limited + hour.limited, failed: total.failed + hour.failed };
      },
      { requests: 0, refused: 0, limited: 0, failed: 0 },
    );
    text(
      "answers-sum",
      hours.length
        ? number(sum.requests) + " answers · " + number(sum.refused) + " turned away · " + number(sum.limited) + " told to wait · " + number(sum.failed) + " server failures (kept in memory: a restart begins again)"
        : "Not counted on this server.",
    );
    var bars = $("bars");
    empty(bars);
    hours.forEach(function (hour) {
      var bar = make("div", "bar");
      bar.title = hourOf(hour.hour) + ": " + hour.requests + " answers, " + hour.refused + " turned away, " + hour.limited + " told to wait, " + hour.failed + " failed";
      var rest = Math.max(0, hour.requests - hour.refused - hour.limited - hour.failed);
      [
        ["ok", rest],
        ["refused", hour.refused],
        ["limited", hour.limited],
        ["failed", hour.failed],
      ].forEach(function (part) {
        if (part[1] <= 0) return;
        var piece = make("i", part[0]);
        piece.style.height = Math.max(2, (part[1] / most) * 100) + "%";
        bar.appendChild(piece);
      });
      bars.appendChild(bar);
    });

    var alerts = $("alerts");
    empty(alerts);
    var odd = view.odd || [];
    var words = { refused: "turned away", limited: "told to wait", failed: "server failures" };
    odd.forEach(function (each) {
      alerts.appendChild(make("p", "", "The hour from " + hourOf(each.hour) + ": " + number(each.count) + " " + words[each.what] + " (a usual hour has " + number(each.usual) + "). Worth a look at the server's journal."));
    });
    alerts.hidden = odd.length === 0;

    var days = $("days");
    empty(days);
    (view.days || [])
      .slice()
      .reverse()
      .forEach(function (day) {
        var row = make("tr");
        [day.day, day.visitors, day.loads, day.newAccounts, day.accounts, day.minutes].forEach(function (value, index) {
          row.appendChild(make("td", "", index === 0 ? String(value) : value === undefined ? "–" : number(value)));
        });
        days.appendChild(row);
      });
  }

  var timer = 0;
  var asking = false;
  var say = function (words, wrong) {
    var state = $("state");
    state.textContent = words;
    state.className = "state" + (wrong ? " is-wrong" : "");
  };

  /** Asks once. Answers what to do next: `shown`, `wait` (try again later) or `out` (the key is no good here: back to the door). */
  function ask(site, key) {
    return fetch(site + "/api/owner/stats?days=30", { headers: { Authorization: "Bearer " + key }, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" }).then(
      function (response) {
        if (response.status === 401) return { next: "out", words: "The site does not know this key." };
        if (response.status === 404) return { next: "out", words: "The site has no owner's page (no key is set on the server, or it is too short)." };
        if (response.status === 429) return { next: "wait", words: "Too many wrong keys from this address: the site asks to wait a quarter of an hour." };
        if (!response.ok) return { next: "wait", words: "The site answered " + response.status + "." };
        return response.json().then(function (view) {
          show(view);
          return { next: "shown", words: "As of " + new Date(view.at).toLocaleTimeString() + " · asked again every 30 seconds" };
        });
      },
      function () {
        return { next: "wait", words: "The site could not be reached from this page (no connection, or this page's address is not the one the server names in OWNER_STATS_ORIGIN)." };
      },
    );
  }

  function open(site, key, fromDoor) {
    window.clearTimeout(timer);
    if (asking) return;
    asking = true;
    ask(site, key).then(function (answer) {
      asking = false;
      if (answer.next === "out" || (fromDoor && answer.next !== "shown")) {
        if (answer.next === "out") kept.forget();
        $("board").hidden = true;
        $("forget").hidden = true;
        $("door").hidden = false;
        text("wrong", answer.words);
        say("");
        return;
      }
      if (answer.next === "shown") {
        kept.write({ site: site, key: key });
        $("door").hidden = true;
        $("board").hidden = false;
        $("forget").hidden = false;
        text("wrong", "");
      }
      say(answer.words, answer.next !== "shown");
      timer = window.setTimeout(function () {
        if (document.visibilityState === "hidden") return; // (asked again when the page is looked at)
        open(site, key, false);
      }, EVERY_MS);
    });
  }

  $("door").addEventListener("submit", function (event) {
    event.preventDefault();
    var site = siteOf($("site").value);
    var key = $("key").value.trim();
    if (!site) return text("wrong", "The site is an https address, like https://kino4tv.com.");
    if (key.length < 24) return text("wrong", "The key has 24 characters at least.");
    text("wrong", "Asking…");
    $("key").value = "";
    open(site, key, true);
  });
  $("forget").addEventListener("click", function () {
    window.clearTimeout(timer);
    kept.forget();
    $("board").hidden = true;
    $("forget").hidden = true;
    $("door").hidden = false;
    say("The key is forgotten on this device.");
  });
  document.addEventListener("visibilitychange", function () {
    var had = kept.read();
    if (document.visibilityState === "visible" && had && !$("board").hidden) open(had.site, had.key, false);
  });

  var had = kept.read();
  if (had && siteOf(had.site)) {
    $("site").value = had.site;
    $("door").hidden = true;
    say("Asking…");
    open(had.site, had.key, true);
  }
})();
