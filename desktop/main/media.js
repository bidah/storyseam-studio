// Native media affordances (TOO-24): Save As… on any media element via the
// native context menu, drag-out of media as real files, and native save
// dialogs for in-app downloads (episode exports). Downloads go through
// net.fetch against the app:// origin, i.e. through the origin bridge with the
// session cookie — project-scoped media paths work.
import { app, dialog, ipcMain, net } from "electron";
import { Menu } from "electron";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const EXT_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/mp4": ".m4a",
};

function dragCacheDir() {
  const dir = path.join(app.getPath("temp"), "shot-studio-drag");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Best-effort filename from the URL path, extension patched from content-type.
function suggestName(srcUrl, contentType) {
  let base = "media";
  try {
    const clean = decodeURIComponent(new URL(srcUrl).pathname.split("/").pop() || "");
    if (clean) base = clean.replace(/[^\w.\- ]+/g, "_");
  } catch { /* keep default */ }
  const wantExt = EXT_BY_MIME[(contentType || "").split(";")[0].trim()];
  if (wantExt && !base.toLowerCase().endsWith(wantExt)) {
    base = base.replace(/\.[a-z0-9]{2,5}$/i, "") + wantExt;
  }
  return base;
}

// Fetch a media URL through the bridge (app:// → session cookie rides along).
async function fetchMedia(srcUrl) {
  const res = await net.fetch(srcUrl, { credentials: "include" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType: res.headers.get("content-type") || "" };
}

async function saveAs(win, srcUrl) {
  const { buf, contentType } = await fetchMedia(srcUrl);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath("downloads"), suggestName(srcUrl, contentType)),
  });
  if (canceled || !filePath) return { ok: false, reason: "canceled" };
  await writeFile(filePath, buf);
  return { ok: true, filePath };
}

export function installMedia({ getMainWindow }) {
  // Right-click on any <img>/<video>/<audio> → native "Save As…" menu. Covers
  // every media card/take in the app without touching the web renderer.
  const attachContextMenu = (win) => {
    win.webContents.on("context-menu", (_e, params) => {
      const isMedia = ["image", "video", "audio"].includes(params.mediaType);
      if (!isMedia || !params.srcURL) return;
      Menu.buildFromTemplate([
        {
          label: "Save As…",
          click: () =>
            saveAs(win, params.srcURL).catch((err) =>
              dialog.showErrorBox("Save failed", String(err?.message || err)),
            ),
        },
      ]).popup({ window: win });
    });
  };

  // Renderer-invoked Save As (the desktop bootstrap wires it to buttons).
  ipcMain.handle("media:save-as", (event, srcUrl) => {
    if (typeof srcUrl !== "string") throw new Error("media:save-as expects a URL");
    return saveAs(getMainWindow(), srcUrl);
  });

  // Drag-out: the renderer preventDefault()s the HTML5 drag and hands us the
  // media URL; we download it to a temp cache file and start a NATIVE file
  // drag, so the drop target (Finder, Resolve, Slack…) receives a real file.
  ipcMain.on("media:start-drag", async (event, srcUrl) => {
    try {
      if (typeof srcUrl !== "string") return;
      const { buf, contentType } = await fetchMedia(srcUrl);
      const name = suggestName(srcUrl, contentType);
      const hash = createHash("sha1").update(srcUrl).digest("hex").slice(0, 10);
      const file = path.join(dragCacheDir(), `${hash}-${name}`);
      await writeFile(file, buf);
      const icon = await app.getFileIcon(file);
      event.sender.startDrag({ file, icon });
    } catch (err) {
      console.error("[desktop] drag-out failed:", err?.message || err);
    }
  });

  // In-app downloads (episode export <a download>, blob saves) → native save
  // dialog with a sensible default name, landing in ~/Downloads by default.
  const installDownloadDialog = (ses) => {
    ses.on("will-download", (_e, item) => {
      item.setSaveDialogOptions({
        defaultPath: path.join(app.getPath("downloads"), item.getFilename() || "export"),
      });
    });
  };

  return { attachContextMenu, installDownloadDialog };
}
