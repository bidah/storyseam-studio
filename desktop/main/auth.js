// In-app Higgsfield OAuth (TOO-21). The renderer asks Better Auth (through the
// bridge) for the authorize URL with disableRedirect, then hands it here. We
// open it in a dedicated child window that SHARES the app's session, so when
// the OAuth callback lands on the Worker's existing redirect URI the session
// cookie is set straight into the app's cookie jar (persisted → login survives
// restarts). We detect the post-callback redirect to the Worker's "/" (Better
// Auth's callbackURL), close the child, and the renderer refreshes its session.
// No new OAuth client, no external browser.
import { BrowserWindow, ipcMain } from "electron";

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

// doneOrigins: where the post-callback redirect can land. In prod that's the
// Worker origin (Better Auth resolves callbackURL "/" against itself); in dev
// the Vite proxy claims x-app-origin=localhost:3333, so Better Auth builds the
// redirect_uri + callbackURL on the DEV origin instead — accept both.
export function installAuth({ getMainWindow, doneOrigins }) {
  ipcMain.handle("oauth:start", async (event, authorizeUrl) => {
    if (typeof authorizeUrl !== "string" || !/^https:\/\//.test(authorizeUrl)) {
      throw new Error("oauth:start expects an https authorize URL");
    }
    return openAuthWindow(authorizeUrl, getMainWindow(), doneOrigins);
  });
}

function openAuthWindow(authorizeUrl, parent, doneOrigins) {
  return new Promise((resolve) => {
    const child = new BrowserWindow({
      parent: parent || undefined,
      width: 520,
      height: 720,
      title: "Sign in with Higgsfield",
      autoHideMenuBar: true,
      webPreferences: {
        // Same (default) session as the app on purpose — the callback's
        // Set-Cookie must land in the jar the bridge forwards with. No preload,
        // no node: this window shows third-party web content.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.isDestroyed()) child.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => settle({ ok: false, reason: "timeout" }), AUTH_TIMEOUT_MS);

    // The flow is done when the child is being sent to one of the app's own
    // origins anywhere OUTSIDE the auth API (Better Auth's callbackURL is "/"):
    // the callback response that triggers that redirect has already set the
    // session cookie. Checking will-redirect catches it before the SPA loads.
    const isDone = (url) =>
      doneOrigins.some(
        (o) => url.startsWith(o) && !url.startsWith(o + "/api/auth/"),
      );
    const check = (url) => {
      if (isDone(url)) settle({ ok: true });
    };
    child.webContents.on("will-redirect", (_e, url) => check(url));
    child.webContents.on("did-navigate", (_e, url) => check(url));
    child.on("closed", () => settle({ ok: false, reason: "closed" }));

    child.loadURL(authorizeUrl);
  });
}
