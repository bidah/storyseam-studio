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

const RETRY_MS = 3000;

export function useDataEvents() {
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.projectId);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let everConnected = false;

    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: [projectId] });
    };

    const connect = async () => {
      if (disposed) return;
      controller = new AbortController();
      try {
        const res = await fetch(
          apiUrl(`/api/data/events?projectId=${encodeURIComponent(projectId)}`),
          { headers: { accept: 'text/event-stream' }, signal: controller.signal },
        );
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
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
            const data = frame
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .join('\n');
            if (!data) continue;
            try {
              const evt = JSON.parse(data);
              if (evt?.clientId !== CLIENT_ID) invalidateAll();
            } catch {
              /* heartbeat / malformed frame */
            }
          }
        }
        throw new Error('SSE stream ended');
      } catch {
        if (disposed) return;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, RETRY_MS);
      }
    };
    connect();

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
      controller?.abort();
      sub.remove();
    };
  }, [projectId, queryClient]);
}
