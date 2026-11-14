import "./shared/debug"; // first: with ?debug in the address it shows what the browser does, even when the rest of the app does not start
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AccountProvider } from "./account/AccountProvider";
import { bootCat } from "./cat/boot";
import { installDiagnostics } from "./feedback/diagnostics";
import { FeedbackGate } from "./feedback/FeedbackGate";
import { FriendsProvider } from "./friends/FriendsProvider";
import { languageReady } from "./i18n";
import { roleOfThisPage, thisIsHandHeld } from "./role";
import { installExitGuard } from "./shared/backButton";
import { ExitHint } from "./shared/ExitHint";
import { setUpFullscreen } from "./shared/fullscreen";
import { ScreenGate } from "./shared/ScreenGate";
import "./styles.css";
import "./polish/base.css";

// Each screen is a chunk of its own, so a phone does not download the TV's player and a TV does not download the remote.
const loadTv = () => import("./tv/Tv").then((module) => ({ default: module.Tv }));
const loadController = () => import("./controller/Controller").then((module) => ({ default: module.Controller }));
const Tv = lazy(loadTv);
const Controller = lazy(loadController);

// One app, two screens, chosen for this device: the TV player or the phone's remote (see role.ts). "/tv" is always the player.
const role = roleOfThisPage();
// Its chunk is asked for now, not when the page is first drawn: it comes down beside the words of the language (see `languageReady`), not after them.
void (role === "tv" ? loadTv() : loadController()).catch(() => undefined);
// A screen goes full screen at its first press; the remote leaves that to its button (it is where a code gets typed).
setUpFullscreen({ byItself: role === "tv" });
// On a phone or a tablet the system's Back would leave the site from its first page: it asks first (see shared/backButton.ts).
if (thisIsHandHeld()) installExitGuard();
// What the page can say about itself if somebody sends feedback is kept from the start (nothing leaves the page unless it is sent: see feedback/diagnostics.ts).
installDiagnostics();
// A cat on the TV's screen, for a device that asked for one and a host that offers it (nothing of it is downloaded otherwise: see cat/boot.ts).
bootCat(role);
// (Drawn once the words of this screen's language are here: English is in the page already, Romanian and Italian are a small file each.)
void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <AccountProvider device={role === "tv" ? "tv" : "remote"}>
      <FriendsProvider>
        <ScreenGate>
          <Suspense fallback={null}>{role === "tv" ? <Tv /> : <Controller />}</Suspense>
        </ScreenGate>
      </FriendsProvider>
      <ExitHint />
      <FeedbackGate />
    </AccountProvider>,
  ),
);
