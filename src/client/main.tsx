import { createRoot } from "react-dom/client";
import { Controller } from "./controller/Controller";
import { roleOfThisPage } from "./role";
import { Tv } from "./tv/Tv";
import "./styles.css";

// One app, two screens, chosen for this device: the TV player or the phone's remote (see role.ts). "/tv" is always the player.
createRoot(document.getElementById("root")!).render(roleOfThisPage() === "tv" ? <Tv /> : <Controller />);
