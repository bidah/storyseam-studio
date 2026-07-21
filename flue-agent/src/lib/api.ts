// Project-scoped client for the shot-studio-uploads Worker JSON API. Ported from
// eve's agent/lib/api.ts, but the project id is injected via CLOSURE (from the
// decoded instance id) instead of read from durable per-session state — because
// a flue tool's `run({ input, signal })` gets no ambient context.
//
// (Two-worker phase: tools still call the worker over HTTP. The later
// single-worker consolidation can swap this for direct binding calls.)

// JSON-serializable value — flue tools must return one. Structurally identical
// to flue's JsonValue, so tool `run` returns are assignable.
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Api = ReturnType<typeof createApi>;

export function createApi(projectId: string | null) {
  const base = process.env.SHOT_STUDIO_API ?? "http://localhost:3334";

  async function request<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    const headers = new Headers(
      init?.body ? { "content-type": "application/json" } : undefined,
    );
    if (projectId) headers.set("x-project-id", projectId);

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
