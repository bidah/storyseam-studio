import { File } from 'expo-file-system';
import { API_ORIGIN } from './env';
import { getProjectId } from './project';

// Thin helpers over the patched global fetch (see fetch-shim.ts, which injects
// x-project-id / x-client-id / Cookie on every request to the Worker).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function apiUrl(path: string) {
  return path.startsWith('http') ? path : API_ORIGIN + path;
}

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init);
}

export async function apiJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const data: any = await res.json();
      if (data?.error) message = String(data.error);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const postJson = <T = any>(path: string, body?: unknown) =>
  apiJson<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const putJson = <T = any>(path: string, body?: unknown) =>
  apiJson<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
export const patchJson = <T = any>(path: string, body?: unknown) =>
  apiJson<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
export const deleteJson = <T = any>(path: string) => apiJson<T>(path, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Media URLs. Payloads carry relative srcs ("/gen/x.mp4", "/asset/…",
// "/thumb/…"). Native media elements can't send headers, so the project id
// rides as ?projectId= — the Worker accepts it as the header's equivalent.
// `version` is the cache-bust nonce (the web app's reloadKey).
export function mediaUrl(rel: string | null | undefined, version?: string | number): string | undefined {
  if (!rel) return undefined;
  if (rel.startsWith('http')) return rel;
  const pid = getProjectId();
  const params: string[] = [];
  if (pid) params.push(`projectId=${encodeURIComponent(pid)}`);
  if (version !== undefined) params.push(`v=${version}`);
  const sep = rel.includes('?') ? '&' : '?';
  return API_ORIGIN + rel + (params.length ? sep + params.join('&') : '');
}

// 720p preview proxy for video/audio playback (port of web previewSrc.js).
const PREVIEW_MAP: Array<[string, string]> = [
  ['/gen/', '/proxy/gen/'],
  ['/multishot-media/', '/proxy/multishot-media/'],
  ['/sound-media/', '/proxy/sound-media/'],
];

export function toPreviewSrc(src: string | null | undefined) {
  if (!src || typeof src !== 'string') return src ?? undefined;
  for (const [from, to] of PREVIEW_MAP) {
    if (src.startsWith(from)) return to + src.slice(from.length);
  }
  return src;
}

// Upload a local file (image-picker URI) to R2 via the Worker; returns its
// public URL — used by chat image attachments and any future imports.
export async function uploadFile(uri: string, name: string, mime: string) {
  const bytes = await new File(uri).bytes();
  const res = await apiFetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': mime || 'application/octet-stream', 'x-filename': name },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new ApiError(res.status, `upload failed (${res.status})`);
  return (await res.json()) as { url: string; key: string; size: number };
}

// Speech-to-text: send a recorded audio file (local URI from expo-audio) to the
// Worker's Whisper endpoint (Cloudflare Workers AI) and get back the transcript.
export async function transcribeAudio(uri: string, mime = 'audio/m4a') {
  const bytes = await new File(uri).bytes();
  const res = await apiFetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': mime },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) {
    let message = `transcription failed (${res.status})`;
    try {
      const data: any = await res.json();
      if (data?.error) message = String(data.error);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as { text: string };
}
