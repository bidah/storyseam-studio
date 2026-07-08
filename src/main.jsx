import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
// Streamdown word-fade keyframes (drives the animated chat text stream).
import "streamdown/styles.css";
// Glowing border effect — used to glow the Script tab on a live agent edit.
import "glowing/dist/index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
