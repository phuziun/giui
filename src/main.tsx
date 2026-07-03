import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Don't let the browser restore a previous scroll position on reload — the page
// should always open at the top (the hero). Without this, reloading after a
// scroll sometimes reopens the page scrolled down.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo(0, 0);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
