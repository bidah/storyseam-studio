import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from './api';
import { CLIENT_ID } from './client-id';
import { useProjectStore } from './project';

// Live-sync: subscribe to the Worker's SSE firehose (/api/data/events, served
// by the ProjectEvents Durable Object) and invalidate this project's queries
// whenever anything changed elsewhere — the chat agent's writes, the web app,
// another device. Own writes are echo-suppressed via x-client-id (the shim
// adds it; the payload carries the writer's clientId).
//
// RN has no EventSource; the fetch shim routes /events paths through
// expo/fetch, whose Response supports body.getReader(), so we parse the SSE
// frames by hand. The DO keeps no replay buffer, so every (re)connect
// invalidates everything once.
//
// The worker's 25s heartbeat is a named `event: ping` frame (see
// worker/src/sse-do.js). Pings must NOT be treated as foreign edits — they only
// feed the watchdog (below) and the seq gap check. A watchdog catches
// "zombie-OPEN" streams: a dead TCP path that never surfaces a read error would
// otherwise leave us believing we're connected forever (AppState only recovers
// on foreground; the watchdog also covers zombies while foregrounded).

const RETRY_MS = 3000;
// ~2.4× the 25s heartbeat: three missed pings before we declare the stream dead.
const WATCHDOG_MS = 60000;
const WATCHDOG_TICK_MS = 15000;

export function useDataEvents() {
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.projectId);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let everConnected = false;
    let failures = 0;
    let lastFrameAt = Date.now();
    // Reset to null on every (re)connect — the connect-time invalidateAll()
    // already covers the gap, so a seq reset can't produce a false miss.
    let lastSeq: number | null = null;

    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: [projectId] });
    };

    const connect = async () => {
      if (disposed) return;
      controller = new AbortController();
      lastFrameAt = Date.now();
      lastSeq = null;
      try {
        const res = await fetch(
          apiUrl(`/api/data/events?projectId=${encodeURIComponent(projectId)}`),
          { headers: { accept: 'text/event-stream' }, signal: controller.signal },
        );
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        if (failures > 0) console.warn(`[live-sync] reconnected after ${failures} failure(s)`);
        failures = 0;
        // Anything broadcast while we were away is lost — refetch once per
        // (re)connect, except the very first connect of a fresh mount.
        if (everConnected) invalidateAll();
        everConnected = true;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            // Any parseable frame (edit OR ping) means the stream is alive.
            lastFrameAt = Date.now();
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const data = dataLines.join('\n');
            if (!data) continue;
            let evt: any;
            try {
              evt = JSON.parse(data);
            } catch {
              /* malformed frame */
              continue;
            }
            if (eventName === 'ping') {
              // A ping whose seq is ahead of the last data frame we saw means an
              // event was broadcast that never reached us — resync without a
              // disconnect. Converges within one heartbeat (~25s) of a silent loss.
              if (typeof evt?.seq === 'number') {
                if (lastSeq !== null && evt.seq > lastSeq) invalidateAll();
                lastSeq = evt.seq;
              }
              continue;
            }
            // Data frame: detect a seq gap (missed an in-between broadcast).
            if (typeof evt?.seq === 'number') {
              if (lastSeq !== null && evt.seq !== lastSeq + 1) invalidateAll();
              lastSeq = evt.seq;
            }
            // Own writes advance lastSeq above but suppress the reaction here.
            if (evt?.clientId !== CLIENT_ID) invalidateAll();
          }
        }
        throw new Error('SSE stream ended');
      } catch (err) {
        if (disposed) return;
        // Never swallow this silently. A permanently-failing stream (a 403 from
        // the ownership guard because the cookie didn't survive the fetch shim,
        // a bad origin) is otherwise indistinguishable from "connected and
        // idle": the UI simply stops updating and only pull-to-refresh works.
        failures += 1;
        if (failures === 1 || failures % 10 === 0) {
          console.warn(
            `[live-sync] /api/data/events disconnected (attempt ${failures}), retrying in ${RETRY_MS}ms:`,
            (err as Error)?.message || err,
          );
        }
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, RETRY_MS);
      }
    };
    connect();

    // Zombie-OPEN watchdog: a dead TCP path can hang reader.read() forever
    // without erroring. If no frame (edit or ping) has arrived within
    // WATCHDOG_MS, abort so the catch/retry loop reconnects (which forces the
    // everConnected resync above).
    const watchdog = setInterval(() => {
      if (disposed) return;
      if (Date.now() - lastFrameAt > WATCHDOG_MS) {
        console.warn('[live-sync] watchdog: no frames for 60s, reconnecting');
        controller?.abort();
        clearTimeout(retryTimer);
        // Re-arm before reconnect so a slow reconnect doesn't re-trip us.
        lastFrameAt = Date.now();
        retryTimer = setTimeout(connect, 100);
      }
    }, WATCHDOG_TICK_MS);

    // Backgrounding kills the socket silently; rebuild it on foreground.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !disposed) {
        controller?.abort();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 100);
      }
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      controller?.abort();
      sub.remove();
    };
  }, [projectId, queryClient]);
}
