import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AccountProvider } from "./account/AccountProvider";
import { roleOfThisPage } from "./role";
import "./styles.css";

// Each screen is a chunk of its own, so a phone does not download the TV's player and a TV does not download the remote.
const Tv = lazy(() => import("./tv/Tv").then((module) => ({ default: module.Tv })));
const Controller = lazy(() => import("./controller/Controller").then((module) => ({ default: module.Controller })));

// One app, two screens, chosen for this device: the TV player or the phone's remote (see role.ts). "/tv" is always the player.
const role = roleOfThisPage();
createRoot(document.getElementById("root")!).render(
  <AccountProvider device={role === "tv" ? "tv" : "remote"}>
    <Suspense fallback={null}>{role === "tv" ? <Tv /> : <Controller />}</Suspense>
  </AccountProvider>,
);
