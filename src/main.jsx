import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router.jsx";
import { installProjectScope } from "./lib/projectFetch.js";
import { initDesktop } from "./lib/desktop-bootstrap.js";
import { I18nProvider } from "./lib/i18n.jsx";
import "./index.css";

// Inject the active project id into every same-origin request. Must run before
// the app makes any fetch/EventSource call.
installProjectScope();
// Streamdown word-fade keyframes (drives the animated chat text stream).
import "streamdown/styles.css";
// Glowing border effect — used to glow the Script tab on a live agent edit.
import "glowing/dist/index.css";

// There is no deployment-wide flue client any more: a client addresses ONE
// conversation URL, so it is built where the conversation id is known
// (src/components/AgentProvider.jsx) and `FlueProvider` is gone with it. The
// transport is unchanged — same-origin `/eve/*`, proxied to the flue worker,
// which mints the per-user identity and prepends `${userId}~` to the instance id
// (the Better Auth session cookie rides along via the projectFetch shim, which
// sets `credentials: "include"` on same-origin requests).

// Desktop (Electron) glue: hydrates the BYOK keys from the safeStorage vault
// before the first render (the login gate reads them synchronously) and wires
// notifications / drag-out / update toasts. Resolves immediately on the web.
initDesktop(router).then(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </React.StrictMode>
  );
});
