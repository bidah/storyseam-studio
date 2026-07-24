import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";
import { FlueProvider } from "@flue/react";
import { createFlueClient } from "@flue/sdk";
import { router } from "./router.jsx";
import { installProjectScope } from "./lib/projectFetch.js";
import { initDesktop } from "./lib/desktop-bootstrap.js";
import "./index.css";

// Inject the active project id into every same-origin request. Must run before
// the app makes any fetch/EventSource call.
installProjectScope();
// Streamdown word-fade keyframes (drives the animated chat text stream).
import "streamdown/styles.css";
// Glowing border effect — used to glow the Script tab on a live agent edit.
import "glowing/dist/index.css";

// The flue SDK client for the studio agent. Same-origin: the shot-studio-uploads
// worker proxies `/eve/*` to the flue worker and injects the per-user identity
// (the Better Auth session cookie rides along via the projectFetch shim, which
// sets `credentials: "include"` on same-origin requests). No client-side token
// or headers — the worker mints the identity and prepends `${userId}~` to the
// conversation instance id.
const flueClient = createFlueClient({ baseUrl: "/eve" });

// Desktop (Electron) glue: hydrates the BYOK keys from the safeStorage vault
// before the first render (the login gate reads them synchronously) and wires
// notifications / drag-out / update toasts. Resolves immediately on the web.
initDesktop(router).then(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <FlueProvider client={flueClient}>
        <RouterProvider router={router} />
      </FlueProvider>
    </React.StrictMode>
  );
});
