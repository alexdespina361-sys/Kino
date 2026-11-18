import "./shared/debug";
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AccountProvider } from "./account/AccountProvider";
import { askEarly } from "./app/GetTheApp";
import { installDiagnostics } from "./feedback/diagnostics";
import { FeedbackGate } from "./feedback/FeedbackGate";
import { FriendsProvider } from "./friends/FriendsProvider";
import { languageReady } from "./i18n";
import { roleOfThisPage, thisIsDesk, thisIsHandHeld } from "./role";
import { installExitGuard } from "./shared/backButton";
import { askLibraryEarly } from "./shared/earlyLibrary";
import { ExitHint } from "./shared/ExitHint";
import { setUpFullscreen } from "./shared/fullscreen";
import { ScreenGate } from "./shared/ScreenGate";
import { noteStrayAddress } from "./shared/strayAddress";
import { watchForUpdates } from "./shared/update";
import { installUpdateKeys, UpdateHint } from "./shared/UpdateHint";
import "./styles.css";
import "./polish/base.css";

const loadTv = () => import("./tv/Tv").then((module) => ({ default: module.Tv }));
const loadController = () => import("./controller/Controller").then((module) => ({ default: module.Controller }));
const Tv = lazy(loadTv);
const Controller = lazy(loadController);

document.documentElement.setAttribute("data-kino-started", "1");
installUpdateKeys();
const role = roleOfThisPage();
noteStrayAddress();
if (thisIsDesk()) document.documentElement.dataset.fit = "desk";
void (role === "tv" ? loadTv() : loadController()).catch(() => undefined);
if (role === "tv") askLibraryEarly();
setUpFullscreen({ byItself: role === "tv" && !thisIsDesk() && !thisIsHandHeld() });
if (thisIsHandHeld()) installExitGuard();
installDiagnostics();
watchForUpdates();
askEarly();
void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <AccountProvider device={role === "tv" ? "tv" : "remote"}>
      <FriendsProvider>
        <ScreenGate>
          <Suspense fallback={null}>{role === "tv" ? <Tv /> : <Controller />}</Suspense>
        </ScreenGate>
      </FriendsProvider>
      <ExitHint />
      <UpdateHint />
      <FeedbackGate />
    </AccountProvider>,
  ),
);
