// Preload: the ONLY surface the renderer gets. Context isolation is on and
// node integration off; everything below is a narrow, validated IPC bridge.
// The web build never sees this — src/lib/desktop.js treats a missing
// `window.desktop` as "running on the web".
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,

  // TOO-21 — in-app OAuth: open the authorize URL in a child window sharing
  // the app session; resolves { ok } once the callback redirect lands.
  oauth: {
    start: (url) => ipcRenderer.invoke("oauth:start", url),
  },

  // TOO-22 — safeStorage-backed key vault (BYOK provider keys).
  vault: {
    get: (name) => ipcRenderer.invoke("vault:get", name),
    set: (name, value) => ipcRenderer.invoke("vault:set", name, value),
  },

  // TOO-24 — native Save As + drag-out of media.
  media: {
    saveAs: (url) => ipcRenderer.invoke("media:save-as", url),
    startDrag: (url) => ipcRenderer.send("media:start-drag", url),
  },

  // TOO-25 — system notifications while unfocused; main pushes deep links back.
  notify: (payload) => ipcRenderer.send("notify", payload),
  onNavigate: (cb) => {
    ipcRenderer.on("navigate", (_e, path) => cb(path));
  },

  // TOO-27 — auto-update state + install affordance.
  updates: {
    onState: (cb) => {
      ipcRenderer.on("updates:state", (_e, state) => cb(state));
    },
    install: () => ipcRenderer.send("updates:install"),
  },

  // Offline page → try loading the app again.
  retry: () => ipcRenderer.send("app:retry"),
});
