// Shot Studio desktop — main process entry.
//
// Two modes:
//   dev  (`--dev` / SHOT_STUDIO_DEV_URL): loads the Vite dev server (HMR); the
//        dev server does the proxying, exactly like the browser.
//   prod: serves the unchanged Vite build from the privileged app:// scheme;
//        the origin bridge (bridge.js) forwards backend paths to the deployed
//        Worker per the shared route table.
import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WORKER_ORIGIN } from "./routeTable.js";
import { registerAppScheme, registerBridge, APP_ORIGIN } from "./bridge.js";
import { loadWindowState, trackWindowState } from "./window-state.js";
import { installMenu } from "./menu.js";
import { installAuth } from "./auth.js";
import { installVault } from "./vault.js";
import { installMedia } from "./media.js";
import { installNotify } from "./notify.js";
import { installUpdates } from "./updates.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const WORKER_ORIGIN = process.env.SHOT_STUDIO_WORKER || DEFAULT_WORKER_ORIGIN;
const DEV_URL =
  process.env.SHOT_STUDIO_DEV_URL ||
  (process.argv.includes("--dev") ? "http://localhost:3333" : null);
const APP_URL = DEV_URL || APP_ORIGIN + "/studio";
// The Vite build: bundled as extraResources in the packaged app; the repo's
// dist/ when running from the checkout (`npm run build` first).
const DIST_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "dist")
  : path.join(here, "..", "..", "dist");

// Single instance (TOO-23): a second launch focuses the running window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  registerAppScheme();

  let mainWindow = null;
  const getMainWindow = () => mainWindow;
  let retryTimer = null;

  // A URL belongs "inside" the app if it's the app origin or the dev server.
  const isAppUrl = (url) =>
    url.startsWith(APP_ORIGIN) || (DEV_URL && url.startsWith(DEV_URL));

  // Is the backend (or in dev, the Vite server) reachable? Decides between
  // loading the studio and the offline/retry page — never a blank window.
  async function backendReachable() {
    const probe = DEV_URL || WORKER_ORIGIN + "/healthz";
    try {
      const res = await net.fetch(probe, { cache: "no-store" });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async function loadApp(win) {
    clearTimeout(retryTimer);
    if (await backendReachable()) {
      try {
        await win.loadURL(APP_URL);
        return;
      } catch {
        /* fall through to offline */
      }
    }
    if (win.isDestroyed()) return;
    await win.loadFile(path.join(here, "..", "pages", "offline.html"));
    // Keep probing in the background; the moment the backend is back, load.
    retryTimer = setTimeout(() => loadApp(win), 3000);
  }

  const media = installMedia({ getMainWindow });

  function createWindow() {
    const state = loadWindowState();
    mainWindow = new BrowserWindow({
      ...state,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: "#09090b",
      // Standard macOS title bar ON PURPOSE: the web UI owns every pixel of
      // the content area (no drag regions), so the window needs the native
      // bar to be moveable.
      title: "Shot Studio",
      webPreferences: {
        preload: path.join(here, "..", "preload", "index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    trackWindowState(mainWindow);
    // Keep the native bar reading "Shot Studio" — the SPA's <title> is the
    // lowercase package name.
    mainWindow.on("page-title-updated", (e) => e.preventDefault());
    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    // External links (TOO-23): window.open / target=_blank leaves for the
    // system browser; nothing external ever renders inside the shell. In-app
    // OAuth goes through the explicit oauth:start IPC, not window.open.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (!isAppUrl(url)) {
        shell.openExternal(url);
        return { action: "deny" };
      }
      return { action: "allow" };
    });
    // Top-level navigation away from the app (e.g. a plain external <a href>)
    // also goes to the system browser.
    mainWindow.webContents.on("will-navigate", (e, url) => {
      if (!isAppUrl(url) && !url.startsWith("file://")) {
        e.preventDefault();
        shell.openExternal(url);
      }
    });
    // Renderer crashed / killed → recover instead of showing a dead window.
    mainWindow.webContents.on("render-process-gone", () => loadApp(mainWindow));
    // Dev server not up yet (or died) → offline page + auto-retry.
    mainWindow.webContents.on("did-fail-load", (_e, code, _desc, url) => {
      // -3 = ERR_ABORTED fires on normal SPA replacement loads; ignore.
      if (code !== -3 && url && isAppUrl(url)) loadApp(mainWindow);
    });

    media.attachContextMenu(mainWindow);
    loadApp(mainWindow);
  }

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    registerBridge({ distDir: DIST_DIR, workerOrigin: WORKER_ORIGIN });
    installMenu();
    installAuth({
      getMainWindow,
      doneOrigins: [WORKER_ORIGIN, DEV_URL].filter(Boolean),
    });
    installVault();
    installNotify({ getMainWindow });
    installUpdates({ getMainWindow, feedUrl: WORKER_ORIGIN + "/desktop/updates" });
    ipcMain.on("app:retry", () => {
      if (mainWindow) loadApp(mainWindow);
    });
    createWindow();
    media.installDownloadDialog(mainWindow.webContents.session);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // macOS convention: keep running with no windows; Cmd+Q quits.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
