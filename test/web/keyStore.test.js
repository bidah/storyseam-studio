// BYOK key vault seam (lib/keyStore.js): backend selection (web vs desktop),
// store/read round-trips, the one-time localStorage → safeStorage-vault
// migration, and the projectFetch shim still emitting provider headers when
// the key comes from the vault.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createKeyStore, pickBackend, vaultBackend, webBackend } from "@/lib/keyStore";

// In-memory stand-in for the preload's safeStorage vault IPC.
function fakeVault(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (name) => data[name] || ""),
    set: vi.fn(async (name, value) => {
      if (value) data[name] = value;
      else delete data[name];
    }),
  };
}

afterEach(() => {
  delete window.desktop;
});

describe("backend selection", () => {
  it("uses localStorage on the web (no window.desktop)", () => {
    expect(pickBackend("k", "v", {}).kind).toBe("web");
    expect(pickBackend("k", "v", undefined).kind).toBe("web");
  });

  it("uses the vault when the preload injected desktop.vault", () => {
    const w = { desktop: { vault: fakeVault() } };
    expect(pickBackend("k", "v", w).kind).toBe("desktop");
  });
});

describe("web backend", () => {
  it("round-trips through localStorage exactly like before", () => {
    const store = createKeyStore("t:key", "tKey", webBackend("t:key"));
    store.set("  abc:def  ");
    expect(store.get()).toBe("abc:def"); // trimmed
    expect(localStorage.getItem("t:key")).toBe("abc:def");
    // a fresh store hydrates synchronously from localStorage
    const again = createKeyStore("t:key", "tKey", webBackend("t:key"));
    expect(again.get()).toBe("abc:def");
    again.clear();
    expect(localStorage.getItem("t:key")).toBeNull();
  });
});

describe("desktop backend", () => {
  it("hydrates from the vault on init and writes through on set", async () => {
    const vault = fakeVault({ falKey: "stored-key" });
    const store = createKeyStore("t:fal", "falKey", vaultBackend(vault, "falKey", "t:fal"));
    expect(store.get()).toBe(""); // nothing until hydrated
    await store.init();
    expect(store.get()).toBe("stored-key");
    store.set("new-key");
    await Promise.resolve(); // let the write-through settle
    expect(vault.data.falKey).toBe("new-key");
  });

  it("migrates a legacy localStorage key into the vault once, then removes it", async () => {
    localStorage.setItem("t:fal", "legacy-key");
    const vault = fakeVault();
    const store = createKeyStore("t:fal", "falKey", vaultBackend(vault, "falKey", "t:fal"));
    await store.init();
    expect(store.get()).toBe("legacy-key");
    expect(vault.data.falKey).toBe("legacy-key");
    // nothing key-shaped remains in localStorage
    expect(localStorage.getItem("t:fal")).toBeNull();
  });

  it("prefers the vault value over a stale localStorage leftover", async () => {
    localStorage.setItem("t:fal", "stale");
    const vault = fakeVault({ falKey: "vaulted" });
    const store = createKeyStore("t:fal", "falKey", vaultBackend(vault, "falKey", "t:fal"));
    await store.init();
    expect(store.get()).toBe("vaulted");
    expect(localStorage.getItem("t:fal")).toBeNull();
  });

  it("notifies subscribers when hydration lands (gates re-render)", async () => {
    const vault = fakeVault({ falKey: "k" });
    const store = createKeyStore("t:fal", "falKey", vaultBackend(vault, "falKey", "t:fal"));
    const seen = [];
    store.subscribe((v) => seen.push(v));
    await store.init();
    expect(seen).toEqual(["k"]);
  });
});

describe("fetch shim with a vaulted key", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("still emits x-fal-key / provider headers when the key lives in the vault", async () => {
    // Preload injected BEFORE app modules load — module init must pick the
    // vault backend.
    window.desktop = { vault: fakeVault({ falKey: "vault-fal-key" }) };
    const { initFalKey } = await import("@/lib/falKey.js");
    const { installProjectScope } = await import("@/lib/projectFetch.js");
    await initFalKey();

    const orig = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", orig);
    installProjectScope();

    await window.fetch("/api/shotlist", { method: "GET" });
    const init = orig.mock.calls[0][1];
    const headers = new Headers(init.headers);
    expect(headers.get("x-fal-key")).toBe("vault-fal-key");
    expect(headers.get("x-render-provider")).toBeTruthy();
    expect(headers.get("x-disabled-providers")).toBeTruthy();
  });
});
