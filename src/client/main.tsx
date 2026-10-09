import { createRoot } from "react-dom/client";
import { Controller } from "./controller/Controller";
import { Tv } from "./tv/Tv";
import "./styles.css";

// One app, two screens: "/" is the phone controller, "/tv" is the TV receiver.
const isTv = location.pathname.replace(/\/+$/, "") === "/tv";

createRoot(document.getElementById("root")!).render(isTv ? <Tv /> : <Controller />);
