// Shared client for the Shot Studio Worker API. Every tool under agent/tools/
// goes through here so there is one base URL and one place to inject project
// context (see agent/lib/context.ts).
const BASE = process.env.SHOT_STUDIO_API ?? "http://localhost:3334";

import { getProjectId } from "./context";

export async function api<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const projectId = getProjectId();
  const headers = new Headers(init?.body ? { "content-type": "application/json" } : undefined);
  if (projectId) headers.set("x-project-id", projectId);

  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "include",
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
