// Secure key vault (TOO-22): BYOK provider keys encrypted with Electron's
// safeStorage (macOS Keychain-backed key) instead of localStorage. Ciphertext
// lives in a JSON file in userData; the plaintext never touches disk. The
// renderer talks to it through the preload's `desktop.vault` — the key helpers
// in src/lib pick this backend when it exists.
import { app, ipcMain, safeStorage } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = () => path.join(app.getPath("userData"), "key-vault.json");
// Only key-shaped, known names are accepted — the vault is not a general store.
const ALLOWED = new Set(["falKey", "atlasKey"]);

function readAll() {
  try {
    const raw = JSON.parse(readFileSync(FILE(), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(obj) {
  writeFileSync(FILE(), JSON.stringify(obj));
}

export function installVault() {
  ipcMain.handle("vault:get", (_e, name) => {
    if (!ALLOWED.has(name)) throw new Error(`vault: unknown key "${name}"`);
    const enc = readAll()[name];
    if (!enc) return "";
    try {
      return safeStorage.decryptString(Buffer.from(enc, "base64"));
    } catch {
      // Keychain entry lost (OS reinstall, migration) — treat as unset.
      return "";
    }
  });

  ipcMain.handle("vault:set", (_e, name, value) => {
    if (!ALLOWED.has(name)) throw new Error(`vault: unknown key "${name}"`);
    const all = readAll();
    const next = String(value || "").trim();
    if (!next) {
      delete all[name];
    } else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("vault: OS encryption unavailable");
      }
      all[name] = safeStorage.encryptString(next).toString("base64");
    }
    writeAll(all);
    return true;
  });
}
