import "./shared/debug"; // first: with ?debug in the address it shows what the browser does, even when the rest of the app does not start
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AccountProvider } from "./account/AccountProvider";
import { bootCat } from "./cat/boot";
import { installDiagnostics } from "./feedback/diagnostics";
import { FeedbackGate } from "./feedback/FeedbackGate";
import { FriendsProvider } from "./friends/FriendsProvider";
import { languageReady } from "./i18n";
import { roleOfThisPage, thisIsDesk, thisIsHandHeld } from "./role";
import { installExitGuard } from "./shared/backButton";
import { ExitHint } from "./shared/ExitHint";
import { setUpFullscreen } from "./shared/fullscreen";
import { ScreenGate } from "./shared/ScreenGate";
import { noteStrayAddress } from "./shared/strayAddress";
import "./styles.css";
import "./polish/base.css";

// Each screen is a chunk of its own, so a phone does not download the TV's player and a TV does not download the remote.
const loadTv = () => import("./tv/Tv").then((module) => ({ default: module.Tv }));
const loadController = () => import("./controller/Controller").then((module) => ({ default: module.Controller }));
const Tv = lazy(loadTv);
const Controller = lazy(loadController);

// One app, two screens, chosen for this device: the TV player or the phone's remote (see role.ts). "/tv" is always the player.
const role = roleOfThisPage();
// An address that is no page of the site opens as "/" does, and says so (see shared/strayAddress.ts).
noteStrayAddress();
// A computer gets the big screen's page at a computer's size (see `isDesk`).
if (thisIsDesk()) document.documentElement.dataset.fit = "desk";
// Its chunk is asked for now, not when the page is first drawn: it comes down beside the words of the language (see `languageReady`), not after them.
void (role === "tv" ? loadTv() : loadController()).catch(() => undefined);
// A TV goes full screen at its first press (its welcome asks for that press). The remote leaves that to its button (it is where a code gets typed), and so does
// a computer's or a phone's screen: there the welcome only greets, and the corner's button goes full screen (the judge, 16 Nov: a gate on every visit, and a
// PC or a phone pulled into full screen by its first click).
setUpFullscreen({ byItself: role === "tv" && !thisIsDesk() && !thisIsHandHeld() });
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
