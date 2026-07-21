// Robust subscription to one of the Worker's live-sync SSE channels
// (/api/data/events, /api/script/events, /api/timeline/events).
//
// Replaces the old one-shot `new EventSource(path)` hooks in RootLayout, which
// had three reliability holes (see docs/live-sync.md):
//   1. The patched EventSource (projectFetch.js) bakes `?projectId=` in at
//      construct time, so a project switch left the tab subscribed to the OLD
//      project's ProjectEvents DO forever. Here `projectId` is an effect dep —
//      switching projects tears the stream down and reconnects with the new id.
//   2. No onerror/onopen handling: a fatally CLOSED stream (worker deploy, dev
//      proxy restart, laptop sleep) silently killed live-sync for the session.
//   3. Events fired while disconnected are gone (the DO keeps no replay
//      buffer), so a reconnect alone isn't enough — callers must refetch.
//
// Returns { edits, resyncs }:
//   - `edits` bumps on every change made ELSEWHERE (this tab's own writes are
//     echo-suppressed via the x-client-id header the fetch shim adds).
//   - `resyncs` bumps when the stream reconnects after an error — events may
//     have been missed, so callers must revalidate on it too. It is a separate
//     counter so purely cosmetic reactions (the Script tab glow) can ignore it.
import { useEffect, useState } from "react";
import { CLIENT_ID } from "@/lib/clientId";
import { getProjectId, onProjectChange } from "@/lib/projectFetch";

const RETRY_MS = 3000;
// ~2.4× the DO's 25s heartbeat: three missed pings before we call the stream
// dead. The watchdog catches "zombie-OPEN" streams — a dead TCP path that never
// surfaces an `onerror`, so `readyState` stays OPEN and the fatal-CLOSED and
// visibilitychange recovery paths never fire.
const WATCHDOG_MS = 60000;
const WATCHDOG_TICK_MS = 15000;

export function useProjectEvents(path) {
  const [edits, setEdits] = useState(0);
  const [resyncs, setResyncs] = useState(0);
  const [projectId, setPid] = useState(getProjectId);
  useEffect(() => onProjectChange(setPid), []);

  useEffect(() => {
    let es;
    let retryTimer;
    let disposed = false;
    let hadError = false;
    let lastFrameAt = Date.now();
    // Reset to null on every (re)connect — the reconnect resync already covers
    // the gap, so a seq reset can't manufacture a false miss.
    let lastSeq = null;
    const alive = () => {
      lastFrameAt = Date.now();
    };

    const connect = () => {
      if (disposed) return;
      lastSeq = null;
      alive();
      es = new EventSource(path); // the projectFetch shim appends ?projectId=<current>
      es.onopen = () => {
        alive();
        // Reconnected after a drop — anything broadcast in the gap is lost
        // (no server-side replay), so tell the caller to refetch.
        if (hadError) setResyncs((n) => n + 1);
        hadError = false;
      };
      es.onerror = () => {
        hadError = true;
        // EventSource auto-retries on transient errors; only a fatal CLOSED
        // (non-200 during a deploy, proxy restart, …) needs a manual rebuild.
        if (es.readyState === EventSource.CLOSED) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(connect, RETRY_MS);
        }
      };
      es.onmessage = (e) => {
        alive();
        try {
          const data = JSON.parse(e.data);
          // A seq gap means a broadcast between this frame and the last one
          // never reached us — refetch, not just glow.
          if (typeof data.seq === "number") {
            if (lastSeq !== null && data.seq !== lastSeq + 1) setResyncs((n) => n + 1);
            lastSeq = data.seq;
          }
          // Own writes advance lastSeq above but suppress the reaction here.
          if (data.clientId !== CLIENT_ID) setEdits((n) => n + 1);
        } catch {
          /* ignore malformed frames */
        }
      };
      // Named heartbeat (never fires onmessage, so no false Script glow). Feeds
      // the watchdog and catches a broadcast that silently never arrived: a ping
      // seq ahead of the last data frame we saw ⇒ we missed an event.
      es.addEventListener("ping", (e) => {
        alive();
        try {
          const { seq } = JSON.parse(e.data);
          if (typeof seq === "number") {
            if (lastSeq !== null && seq > lastSeq) setResyncs((n) => n + 1);
            lastSeq = seq;
          }
        } catch {
          /* ignore malformed ping */
        }
      });
    };
    connect();

    // Zombie-OPEN watchdog: no `onerror` ever fires on a dead TCP path, so poll
    // frame liveness. If nothing (edit or ping) has arrived within WATCHDOG_MS,
    // tear the stream down and rebuild — onopen then bumps resyncs.
    const watchdog = setInterval(() => {
      if (disposed || !es) return;
      if (Date.now() - lastFrameAt > WATCHDOG_MS) {
        console.warn("[live-sync] watchdog reconnect", path);
        hadError = true;
        clearTimeout(retryTimer);
        es.close();
        connect();
      }
    }, WATCHDOG_TICK_MS);

    // Laptop sleep can leave a zombie CLOSED stream that never errors again;
    // recover the moment the tab becomes visible.
    const onVisible = () => {
      if (document.visibilityState === "visible" && es?.readyState === EventSource.CLOSED) {
        hadError = true;
        clearTimeout(retryTimer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisible);
      es?.close();
    };
    // projectId dep: recreate the stream on project switch so it follows the
    // active project (the new EventSource picks up the new ?projectId=).
  }, [path, projectId]);

  return { edits, resyncs };
}
