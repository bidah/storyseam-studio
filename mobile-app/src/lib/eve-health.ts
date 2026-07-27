import { useQuery } from '@tanstack/react-query';
import { apiJson } from './api';

// `/eve/health` — the flue worker's public capability report (flue-agent
// src/app.ts). It never returns a key, only booleans saying which OPERATOR keys
// the worker carries, so Settings can tell the user which backends already work
// without one of their own:
//
//   providers.anthropic / providers.cerebras — key-gated MODEL providers. The
//     Cloudflare Workers AI models need no key and are always available, so only
//     the Cerebras row is gated in the chat-provider section.
//   search.exa / search.firecrawl — operator web-search keys. A user key simply
//     takes precedence when set (lib/search-keys.ts).
//
// Best-effort: a failed request leaves the badges off rather than blocking the
// settings form, which works fine either way.

export type EveHealth = {
  ok?: boolean;
  providers?: { anthropic?: boolean; cerebras?: boolean };
  search?: { exa?: boolean; firecrawl?: boolean };
};

export function useEveHealth() {
  return useQuery<EveHealth>({
    queryKey: ['eve', 'health'],
    queryFn: () => apiJson<EveHealth>('/eve/health'),
    // Capabilities change only on a worker deploy — no need to re-ask often.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
