import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from './api';
import { CLIENT_ID } from './client-id';
import { useProjectStore } from './project';

// Live-sync: subscribe to one of the Worker's SSE channels, served by the
// ProjectEvents Durable Object.
//
//   /api/data/events  every write elsewhere — the chat agent, the web app,
//                     another device — so this app's queries refetch.
//   /api/nav/events   the agent asking the app to move (routes/navigate.js).
//
// RN has no EventSource; the fetch shim routes /events paths through
// expo/fetch, whose Response supports body.getReader(), so we parse the SSE
// frames by hand. The DO keeps no replay buffer, so every (re)connect must
// assume it missed something.
//
// The worker's 25s heartbeat is a named `event: ping` frame (see
// worker/src/sse-do.js). Pings must NOT be treated as foreign edits — they only
// feed the watchdog and the seq gap check. A watchdog catches "zombie-OPEN"
// streams: a dead TCP path that never surfaces a read error would otherwise
// leave us believing we're connected forever (AppState only recovers on
// foreground; the watchdog also covers zombies while foregrounded).
//
// The transport below is shared by both channels on purpose. It is the fiddliest
// code in this app — retry, seq gaps, watchdog, background/foreground — and a
// second copy for the nav channel would drift from this one within a release.

const RETRY_MS = 3000;
// ~2.4× the 25s heartbeat: three missed pings before we declare the stream dead.
const WATCHDOG_MS = 60000;
const WATCHDOG_TICK_MS = 15000;

interface ChannelHandlers {
  // A frame from someone else (own writes are echo-suppressed via x-client-id).
  onEvent?: (evt: any) => void;
  // Frames were missed — on (re)connect, or on a detected seq gap. Channels
  // carrying STATE use this to refetch; channels carrying one-shot COMMANDS
  // (nav) leave it out, because replaying a stale command is worse than
  // dropping it.
  onResync?: () => void;
}

// Subscribe to one channel for as long as the caller is mounted. `handlers` is
// read through a ref so a caller can pass fresh closures every render without
// tearing the stream down and losing frames.
function useSseChannel(path: string, handlers: ChannelHandlers) {
  const projectId = useProjectStore((s) => s.projectId);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let everConnected = false;
    let failures = 0;
    let lastFrameAt = Date.now();
    // Reset to null on every (re)connect — the connect-time resync already
    // covers the gap, so a seq reset can't produce a false miss.
    let lastSeq: number | null = null;

    const resync = () => ref.current.onResync?.();

    const connect = async () => {
      if (disposed) return;
      controller = new AbortController();
      lastFrameAt = Date.now();
      lastSeq = null;
      try {
        const res = await fetch(
          apiUrl(`${path}?projectId=${encodeURIComponent(projectId)}`),
          { headers: { accept: 'text/event-stream' }, signal: controller.signal },
        );
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        if (failures > 0) console.warn(`[live-sync] ${path} reconnected after ${failures} failure(s)`);
        failures = 0;
        // Anything broadcast while we were away is lost — resync once per
        // (re)connect, except the very first connect of a fresh mount.
        if (everConnected) resync();
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
                if (lastSeq !== null && evt.seq > lastSeq) resync();
                lastSeq = evt.seq;
              }
              continue;
            }
            // Data frame: detect a seq gap (missed an in-between broadcast).
            if (typeof evt?.seq === 'number') {
              if (lastSeq !== null && evt.seq !== lastSeq + 1) resync();
              lastSeq = evt.seq;
            }
            // Own writes advance lastSeq above but suppress the reaction here.
            if (evt?.clientId !== CLIENT_ID) ref.current.onEvent?.(evt);
          }
        }
        throw new Error('SSE stream ended');
      } catch (err) {
        if (disposed) return;
        // Never swallow this silently. A permanently-failing stream (a 401/403
        // from the ownership guard because the cookie didn't survive the fetch
        // shim, a bad origin) is otherwise indistinguishable from "connected and
        // idle": the UI simply stops updating and only pull-to-refresh works.
        failures += 1;
        if (failures === 1 || failures % 10 === 0) {
          console.warn(
            `[live-sync] ${path} disconnected (attempt ${failures}), retrying in ${RETRY_MS}ms:`,
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
        console.warn(`[live-sync] watchdog: no frames on ${path} for 60s, reconnecting`);
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
  }, [projectId, path]);
}

// Invalidate this project's queries whenever anything changed elsewhere.
export function useDataEvents() {
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.projectId);
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: [projectId] });
  };
  useSseChannel('/api/data/events', { onEvent: invalidateAll, onResync: invalidateAll });
}

// The agent's navigate commands. Returns the latest one (or null) so the caller
// can route on it — see lib/screen-report.ts `useAgentNavigation`.
//
// No `onResync`: a navigate is a one-shot COMMAND, not state. Re-firing "go to
// Radio" because the socket dropped and came back would move the author out of
// whatever they opened in the meantime, which on a phone means losing the screen
// they were actually using.
export function useNavEvents() {
  const [command, setCommand] = useState<any>(null);
  useSseChannel('/api/nav/events', { onEvent: setCommand });
  return command;
}
