// Auto-update via the R2-hosted feed (TOO-27). electron-updater checks the
// generic feed the Worker serves from R2 (/desktop/updates/latest-mac.yml),
// downloads in the background, and installs on quit. Every failure path is
// swallowed after logging — an update problem must never block using the app.
import { app, ipcMain } from "electron";
import updater from "electron-updater";

const { autoUpdater } = updater;

export function installUpdates({ getMainWindow, feedUrl }) {
  if (!app.isPackaged) return; // dev builds have no update identity

  autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (state, info) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("updates:state", { state, version: info?.version || null });
    }
  };

  autoUpdater.on("checking-for-update", () => send("checking"));
  autoUpdater.on("update-available", (info) => send("downloading", info));
  autoUpdater.on("update-not-available", () => send("current"));
  autoUpdater.on("update-downloaded", (info) => send("ready", info));
  autoUpdater.on("error", (err) => {
    console.error("[desktop] auto-update error (ignored):", err?.message || err);
    send("error");
  });

  ipcMain.on("updates:install", () => {
    try {
      autoUpdater.quitAndInstall();
    } catch (err) {
      console.error("[desktop] quitAndInstall failed:", err?.message || err);
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[desktop] update check failed (ignored):", err?.message || err);
  });
}
