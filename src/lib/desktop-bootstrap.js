// Desktop-only glue, called once from main.jsx BEFORE the app renders. On the
// web `window.desktop` doesn't exist and this resolves immediately — zero
// behavior change. On the Electron app it:
//   1. hydrates the BYOK key stores from the safeStorage vault (TOO-22),
//   2. handles deep links pushed by notification clicks (TOO-25),
//   3. turns HTML5 drags of our media elements into native file drags (TOO-24),
//   4. watches the /api/data/events firehose and raises system notifications
//      for pipeline writes landing while the window is unfocused (TOO-25),
//   5. surfaces auto-update state as a toast with a Restart action (TOO-27).
import { toast } from "sonner";
import { desktop, isDesktop } from "@/lib/desktop";
import { initFalKey } from "@/lib/falKey";
import { initAtlasKey } from "@/lib/atlasKey";
import { initSearchKeys } from "@/lib/searchKeys";
import { onProjectChange } from "@/lib/projectFetch";

export async function initDesktop(router) {
  if (!isDesktop) return;
  await Promise.all([initFalKey(), initAtlasKey(), initSearchKeys()]);
  desktop.onNavigate?.((path) => router.navigate(path));
  installDragOut();
  watchPipelineEvents();
  watchUpdates();
}

// Dragging an <img>/<video>/<audio> out of the app becomes a native file drag
// (Finder / Resolve / Slack get a real file, downloaded through the
// authenticated session by the main process). App-internal drags (timeline
// items, upload targets) keep their own draggable containers and are left
// alone.
function installDragOut() {
  window.addEventListener(
    "dragstart",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest("img,video,audio") : null;
      if (!el) return;
      // An explicit draggable ancestor means an app-managed drag — skip it.
      const managed = e.target.closest?.("[draggable='true']");
      if (managed && !managed.matches("img,video,audio")) return;
      const src = el.currentSrc || el.src;
      if (!src || !src.startsWith(window.location.origin)) return;
      e.preventDefault();
      desktop.media.startDrag(src);
    },
    true,
  );
}

// Resource key (the /api/<resource>/… path segment carried on every firehose
// frame) → what finished + where clicking the notification should land.
const NOTIFY_RESOURCES = {
  render: { label: "Shot render", to: "/shots" },
  storyboard: { label: "Storyboard still", to: "/animatic" },
  episode: { label: "Episode render", to: "/episode" },
  export: { label: "Export", to: "/cuts" },
  cuts: { label: "Cut", to: "/cuts" },
  sounds: { label: "Sound render", to: "/sounds" },
  radio: { label: "Radio dialogue", to: "/radio" },
  multishot: { label: "Multishot render", to: "/multishot" },
};
const NOTIFY_DEBOUNCE_MS = 5000;

// Watch the EXISTING live-sync firehose — no new backend events. Writes to
// render-producing resources that land while the window is unfocused raise a
// system notification (the main process double-checks focus). Debounced per
// resource so an agent burst doesn't machine-gun the notification center.
function watchPipelineEvents() {
  let es;
  const lastAt = {};
  const connect = () => {
    es?.close();
    // The projectFetch shim appends ?projectId=<current> at construct time —
    // reconnect on project switch to follow the active project.
    es = new EventSource("/api/data/events");
    es.onmessage = (e) => {
      if (document.hasFocus()) return;
      try {
        const data = JSON.parse(e.data);
        const hit = NOTIFY_RESOURCES[data.resource];
        if (!hit) return;
        const now = Date.now();
        if (lastAt[data.resource] && now - lastAt[data.resource] < NOTIFY_DEBOUNCE_MS) return;
        lastAt[data.resource] = now;
        desktop.notify({
          title: "Shot Studio",
          body: `${hit.label} finished`,
          navigateTo: hit.to,
        });
      } catch {
        /* malformed frame */
      }
    };
  };
  connect();
  onProjectChange(connect);
}

// Non-intrusive update affordance: a toast when the new version is downloaded
// and will install on quit, with an optional immediate restart.
function watchUpdates() {
  desktop.updates?.onState(({ state, version }) => {
    if (state !== "ready") return;
    toast.success("Update ready", {
      id: "desktop-update",
      description: `Shot Studio ${version || ""} installs when you quit.`,
      duration: Infinity,
      action: { label: "Restart now", onClick: () => desktop.updates.install() },
    });
  });
}
