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

    const connect = () => {
      if (disposed) return;
      es = new EventSource(path); // the projectFetch shim appends ?projectId=<current>
      es.onopen = () => {
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
        try {
          const data = JSON.parse(e.data);
          if (data.clientId !== CLIENT_ID) setEdits((n) => n + 1);
        } catch {
          /* ignore malformed frames / heartbeats */
        }
      };
    };
    connect();

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
      document.removeEventListener("visibilitychange", onVisible);
      es?.close();
    };
    // projectId dep: recreate the stream on project switch so it follows the
    // active project (the new EventSource picks up the new ?projectId=).
  }, [path, projectId]);

  return { edits, resyncs };
}
