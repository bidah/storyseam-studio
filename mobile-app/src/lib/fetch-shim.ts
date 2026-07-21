// Global fetch patch — the RN port of the web app's projectFetch.js shim.
//
// For requests to the Shot Studio Worker it injects the per-project /
// per-client / per-model headers plus the Better Auth session cookie, so the
// flue SDK, better-auth, and every query hook work without threading headers
// through ~40 call sites. Streaming paths (/eve/*, the SSE /events channels)
// are routed through expo/fetch — the only RN fetch whose Response exposes
// body.getReader(), which flue's durable-stream reader requires. Everything
// else stays on the stock RN fetch (whose responses better-auth's cookie
// handling already understands).
//
// The Worker proxies /eve/* to the flue worker (name `whistlewood`), so this
// shim keeps routing /eve through expo/fetch exactly as it did for eve — the
// flue @flue/sdk client uses the (already-installed) global fetch, so it picks
// this up transparently. The per-turn model rides as `x-flue-model`, which the
// Worker's /eve proxy forwards into the flue agent Durable Object.
import { fetch as expoFetch } from 'expo/fetch';
import { API_ORIGIN } from './env';
import { CLIENT_ID } from './client-id';
import { getProjectId } from './project';
import { getAgentModelSpecifier } from './agent-model';

function needsStreaming(path: string) {
  return path.startsWith('/eve') || /\/api\/(data|script|timeline)\/events/.test(path);
}

function getSessionCookie(): string {
  try {
    // Lazy require avoids pulling better-auth into the very first JS tick.
    const { authClient } = require('./auth-client') as typeof import('./auth-client');
    return authClient.getCookie() || '';
  } catch {
    return '';
  }
}

let installed = false;

export function installFetchShim() {
  if (installed) return;
  installed = true;

  const origFetch = globalThis.fetch.bind(globalThis);

  (globalThis as any).fetch = (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url !== 'string' || !url.startsWith(API_ORIGIN)) {
      return origFetch(input, init);
    }

    const path = url.slice(API_ORIGIN.length);
    const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
    const pid = getProjectId();
    if (pid && !headers.has('x-project-id')) headers.set('x-project-id', pid);
    headers.set('x-client-id', CLIENT_ID);
    if (path.startsWith('/eve')) headers.set('x-flue-model', getAgentModelSpecifier());
    if (!headers.has('cookie')) {
      const cookie = getSessionCookie();
      if (cookie) headers.set('cookie', cookie);
    }

    if (needsStreaming(path)) {
      const flat: Record<string, string> = {};
      headers.forEach((v, k) => {
        flat[k] = v;
      });
      return expoFetch(url, {
        ...(init as any),
        headers: flat,
        // Manual cookie header — don't let any ambient credential store interfere.
        credentials: 'omit',
      } as any) as unknown as Promise<Response>;
    }

    return origFetch(input, { ...(init || {}), headers, credentials: 'omit' });
  };
}

installFetchShim();
