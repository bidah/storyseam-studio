// Render-complete system notifications (TOO-25). The RENDERER watches the
// existing /api/data/events live-sync firehose (it already has the project
// scoping and reconnect logic) and asks us to notify only while the window is
// unfocused; clicking the notification focuses the app and deep-links the tab.
// No new backend events, no Worker changes.
import { Notification, ipcMain } from "electron";

export function installNotify({ getMainWindow }) {
  ipcMain.on("notify", (_e, payload) => {
    const win = getMainWindow();
    // The in-app UI already shows completion while focused.
    if (!win || win.isDestroyed() || win.isFocused()) return;
    if (!Notification.isSupported()) return;
    const { title, body, navigateTo } = payload || {};
    const n = new Notification({
      title: String(title || "Shot Studio"),
      body: String(body || ""),
      silent: false,
    });
    n.on("click", () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (navigateTo) win.webContents.send("navigate", String(navigateTo));
    });
    n.show();
  });
}
