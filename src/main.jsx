import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router.jsx";
import { installProjectScope } from "./lib/projectFetch.js";
import "./index.css";

// Inject the active project id into every same-origin request. Must run before
// the app makes any fetch/EventSource call.
installProjectScope();
// Streamdown word-fade keyframes (drives the animated chat text stream).
import "streamdown/styles.css";
// Glowing border effect — used to glow the Script tab on a live agent edit.
import "glowing/dist/index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
