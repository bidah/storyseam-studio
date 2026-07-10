// TEMPORARY entry for editor-test.html — mounts the Editor tab without the
// login gate so it can be screenshotted headlessly. Safe to delete.
import React from "react";
import ReactDOM from "react-dom/client";
import { installProjectScope } from "./lib/projectFetch.js";
import "./index.css";
import Editor from "./components/Editor.jsx";

installProjectScope();

ReactDOM.createRoot(document.getElementById("root")).render(
  <div className="min-h-dvh bg-background p-6 text-foreground">
    <Editor reloadKey={0} />
  </div>
);
