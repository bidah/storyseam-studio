// Project-scoped, USER-SCOPED client for the shot-studio-uploads Worker JSON
// API. Ported from eve's agent/lib/api.ts, but the project id and user id are
// injected via CLOSURE (from the decoded instance id) instead of read from
// durable per-session state — because a flue tool's `run({ data, signal })`
// gets no ambient context.
//
// Every request carries a signed identity header (lib/agent-identity.ts). It
// used to carry only `x-project-id` and no credential at all, which forced the
// worker to exempt anonymous callers from its ownership check — an exemption
// anyone could use by naming a project id. The worker now fails closed, so an
// unsigned request from here would 401: if you add a call path that bypasses
// this client, it needs the same header.
//
// (Two-worker phase: tools still call the worker over HTTP. The later
// single-worker consolidation can swap this for direct binding calls.)

import { mintAgentAssertion, agentSecret, AGENT_HEADER, AGENT_CHAT_HEADER } from "./agent-identity.js";

// JSON-serializable value — what a flue tool puts in its `{ output }` envelope.
// Structurally identical to flue's JsonValue, so tool `run` returns are
// assignable. A top-level array is legal here BECAUSE of the envelope: a bare
// array return throws in flue 2, a `{ output: [...] }` one does not.
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Api = ReturnType<typeof createApi>;

export function createApi(
  projectId: string | null,
  userId?: string | null,
  chatId?: string | null,
  episodeId?: string | null,
  // The author's own fal key (BYOK), stamped as `x-fal-key` exactly as the
  // browser's fetch shim does — the routes that spend on fal directly
  // (`/api/musicalized/cue`) read it from there. Absent, they fall back to the
  // Worker's FAL_KEY secret.
  falKey?: string | null,
) {
  const base = process.env.SHOT_STUDIO_API ?? "http://localhost:3334";

  // One assertion per turn rather than per call: it is valid for five minutes,
  // and a tool that fans out over twenty shots shouldn't pay for twenty HMAC
  // signings. Cached by expiry, not by count, so a long run re-mints.
  let cached: { token: string; until: number } | null = null;
  async function identity(): Promise<string | null> {
    const secret = agentSecret();
    if (!secret || !userId) return null;
    const now = Date.now();
    // Re-mint a minute before the real expiry so a request in flight when the
    // token turns over doesn't land on the far side of it.
    if (cached && cached.until > now) return cached.token;
    const token = await mintAgentAssertion(userId, secret);
    cached = { token, until: now + 4 * 60_000 };
    return token;
  }

  async function request<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    const headers = new Headers(
      init?.body ? { "content-type": "application/json" } : undefined,
    );
    if (projectId) headers.set("x-project-id", projectId);
    // Scope every tool call to the conversation's episode (a series). Absent for a
    // feature / the first episode — the worker treats absence as the unsuffixed
    // baseline, so pre-series behaviour is unchanged.
    if (episodeId) headers.set("x-episode-id", episodeId);
    const token = await identity();
    if (token) headers.set(AGENT_HEADER, token);
    // Correlation only — which conversation made this change, recorded in
    // doc_history so a history entry leads back to the chat that caused it.
    if (chatId) headers.set(AGENT_CHAT_HEADER, chatId);
    if (falKey) headers.set("x-fal-key", falKey);

    const res = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg =
        (data as { error?: string })?.error ?? `${res.status} ${res.statusText}`;
      throw new Error(`Shot Studio API ${path} failed: ${msg}`);
    }
    return data as T;
  }

  return {
    get: <T extends Json = Json>(path: string, signal?: AbortSignal) =>
      request<T>(path, { signal }),
    post: <T extends Json = Json>(
      path: string,
      body?: unknown,
      signal?: AbortSignal,
    ) => request<T>(path, { method: "POST", body, signal }),
    // Generic verb for PUT / PATCH / DELETE tools.
    req: <T extends Json = Json>(
      path: string,
      method: string,
      body?: unknown,
      signal?: AbortSignal,
    ) => request<T>(path, { method, body, signal }),
  };
}
