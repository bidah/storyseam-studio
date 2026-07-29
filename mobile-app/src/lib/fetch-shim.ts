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
import { getFalKey } from './fal-key';
import { getAtlasKey } from './atlas-key';
import { getActiveProvider, disabledProvidersCsv } from './providers';
import { getSandboxMode } from './sandbox-mode';
import { getSearchProvider } from './search-provider';
import { getExaKey, getFirecrawlKey } from './search-keys';

// Stock RN fetch gives a Response with no `body.getReader()`, so anything we
// read as a stream has to go through expo/fetch. Every SSE channel belongs here:
// a channel missing from this list doesn't fail loudly, it just never delivers a
// frame (lib/sse.ts throws "SSE <status>" once and then retries forever).
function needsStreaming(path: string) {
  return path.startsWith('/eve') || /\/api\/(data|nav|script|timeline)\/events/.test(path);
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
    // The user's own BYOK keys (device-only — lib/fal-key.ts / lib/atlas-key.ts)
    // ride REGARDLESS of the provider selection so the Worker can keep polling
    // in-flight jobs from a previously selected provider: it reads x-fal-key /
    // x-atlas-key; /eve sends carry them as x-flue-* (persisted per
    // conversation). The SELECTED provider (lib/providers.ts — exactly one at
    // a time) rides as the render-provider header (wins the catalog default),
    // the two non-selected ids as the disabled-providers header.
    const eve = path.startsWith('/eve');
    const falKey = getFalKey();
    if (falKey) headers.set(eve ? 'x-flue-fal-key' : 'x-fal-key', falKey);
    const atlasKey = getAtlasKey();
    if (atlasKey) headers.set(eve ? 'x-flue-atlas-key' : 'x-atlas-key', atlasKey);
    headers.set(eve ? 'x-flue-disabled-providers' : 'x-disabled-providers', disabledProvidersCsv());
    headers.set(eve ? 'x-flue-render-provider' : 'x-render-provider', getActiveProvider());
    // Sandbox selection (lib/sandbox-mode.ts) is AGENT-ONLY — where the agent's
    // bash/skills run. Sent on every /eve send so switching back to in-memory
    // takes effect immediately; the flue worker reads an absent header as
    // "leave the conversation's stored mode alone".
    if (eve) headers.set('x-flue-sandbox', getSandboxMode());
    // Web search (lib/search-provider.ts / lib/search-keys.ts) is AGENT-ONLY
    // too — no `/api/*` route searches the web, so there is no non-`x-flue-`
    // variant. The keys are OPTIONAL: the flue worker carries operator keys and
    // a user key only takes precedence when present.
    if (eve) {
      headers.set('x-flue-search-provider', getSearchProvider());
      const exaKey = getExaKey();
      if (exaKey) headers.set('x-flue-exa-key', exaKey);
      const firecrawlKey = getFirecrawlKey();
      if (firecrawlKey) headers.set('x-flue-firecrawl-key', firecrawlKey);
    }
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
