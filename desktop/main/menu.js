// Native macOS menu bar (TOO-23): standard roles so edit shortcuts (⌘C/⌘V/⌘Z…)
// reach TipTap and text fields, plus zoom/fullscreen/window management.
import { Menu, app, shell } from "electron";

export function installMenu() {
  const template = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [{ role: "close" }],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Shot Studio on the web",
          click: () =>
            shell.openExternal(
              process.env.SHOT_STUDIO_WORKER ||
                "https://shot-studio-uploads.rodrigofigueroa-name.workers.dev",
            ),
        },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
