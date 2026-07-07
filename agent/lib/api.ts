// Shared client for the Shot Studio Express API (the data layer on :3334).
// Every tool under agent/tools/ goes through here so there is one base URL.
const BASE = process.env.SHOT_STUDIO_API ?? "http://localhost:3334";

export async function api<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
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
