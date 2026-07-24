# Shot Studio desktop (macOS)

Electron shell around the **unchanged** web SPA (TOO-18). The renderer is the
same Vite build the Worker serves; the main process hosts it on the privileged
`app://shot-studio` origin and bridges every backend path to the deployed
Worker.

## How it works

- **Origin bridge** (`main/bridge.js`): classifies every `app://` request with
  the shared route table (`src/lib/routeTable.js`, vendored by
  `scripts/sync-shared.mjs` — never edit `main/routeTable.js`). Backend paths
  forward through `net.fetch` with `credentials: "include"`, so the Better Auth
  session cookie in the Electron jar rides along; SSE paths stream unbuffered;
  everything else serves the Vite build with a strict CSP (inline scripts
  whitelisted by hash at serve time).
- **Auth** (`main/auth.js`): the renderer asks Better Auth for the authorize
  URL (`disableRedirect`), the main process opens it in a child window sharing
  the app session; the callback lands on the Worker's existing redirect URI and
  the session cookie persists in the jar. `src/lib/auth-client.js` rewrites the
  client's base URL because Better Auth rejects the `app://` scheme.
- **Key vault** (`main/vault.js`): BYOK fal/Atlas keys encrypted with
  `safeStorage` (macOS Keychain), stored as ciphertext in
  `userData/key-vault.json`. The renderer seam is `src/lib/keyStore.js`
  (localStorage on web, vault + one-time migration on desktop).
- **Media** (`main/media.js`): right-click any `<img>/<video>/<audio>` → native
  Save As…; dragging media out of the app becomes a native file drag (real file
  downloaded through the authenticated session); in-app downloads (episode
  export) get the native save dialog.
- **Notifications** (`main/notify.js` + `src/lib/desktop-bootstrap.js`): the
  renderer watches the existing `/api/data/events` firehose and raises macOS
  notifications for pipeline writes while the window is unfocused; clicking
  deep-links the tab.
- **Updates** (`main/updates.js`): electron-updater against the generic feed
  the Worker serves at `/desktop/updates/*` (R2). Failures never block the app.

## Commands (repo root)

- `npm run desktop:dev` — Vite dev server + Electron with HMR (offline page
  auto-retries until Vite is up).
- `npm run desktop:start` — build the SPA, run Electron in prod mode (app://
  bridge against the deployed Worker).
- `npm run desktop:dist` — build signed + notarized DMG/ZIP for arm64 + x64
  (requires `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and a
  Developer ID certificate in the keychain; unsigned smoke build:
  `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac zip --arm64
  -c.mac.notarize=false` in `desktop/`).
- `npm run desktop:publish` — dist + upload artifacts and `latest-mac.yml` to
  R2 (`desktop/updates/` prefix) via wrangler.

## Gotchas

- A SIGKILLed instance leaves stale `Singleton*` files in
  `~/Library/Application Support/Shot Studio/`, making the next launch quit
  instantly (single-instance lock). Normal quits clean up fine; if it happens,
  delete the `Singleton*` symlinks.
- `protocol.handle` request bodies can't be piped straight into `net.fetch` —
  the bridge buffers them (JSON APIs only; big uploads go direct to the Worker).
