// THE SITTING RUNNER — one Auto Sitting, unattended, in headless Chrome.
//
// ADR 0001: the Sitting of an Auto Film runs in a Daytona box, not the author's
// tab, and it runs the EXISTING Stage code rather than a rewrite: the session
// sequence (`createDirectorSession`), the fal WMA transport (`stageTransport`)
// and the recorder's rules (`verdictFor`, the container choice). What this file
// adds is only what a person does on the Stage: press play, wait, keep.
//
// It talks to the Worker through `/api/sitting-runner/*` with the job token
// from its URL fragment — never a cookie, never a fal key. The fal calls go
// through the runner's proxy, which attaches the platform key server-side.
//
// Progress leaves two ways: `[sitting] {json}` console lines (the box's driver
// echoes them into the job's logs) and `POST /api/sitting-runner/progress`
// (what the Film job's card reads). `window.__sitting.status` becomes `done` or
// `failed` when there is nothing left to do; the driver exits on it.
import { createDirectorSession, type SessionState } from '@/director/session';
import { stageTransport, asMediaStream, DIRECTOR_ENDPOINT } from '@/director/transport';
import { verdictFor } from '@/director/recording';
import { baseType, supportedContainer } from '@/director/use-recorder';
import type { AppendedReel, Recipe } from '@/lib/series';

type RunnerStatus = { status: 'starting' | 'running' | 'done' | 'failed'; error?: string; state?: string };
declare global {
  interface Window {
    __sitting?: RunnerStatus;
  }
}

type ScreeningResponse = {
  filmId: string;
  seriesId: string;
  endpoint?: string;
  configure: Recipe;
  reels: AppendedReel[];
  filmSeconds: number;
  maxWallSeconds: number;
};

const TOKEN_HEADER = 'x-sitting-token';
const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t') || '';
const statusEl = document.getElementById('status');
const picture = document.getElementById('picture') as HTMLVideoElement | null;

function log(kind: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ kind, at: new Date().toISOString(), ...data });
  console.log(`[sitting] ${line}`);
  if (statusEl) statusEl.textContent = `${kind} ${JSON.stringify(data)}`;
}

function finish(status: 'done' | 'failed', error?: string) {
  window.__sitting = { status, error };
  log(status, error ? { error } : {});
}

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(TOKEN_HEADER, token);
  return fetch(path, { ...init, headers });
}

async function report(body: Record<string, unknown>) {
  try {
    await api('/api/sitting-runner/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* progress is best-effort; the film is what matters */
  }
}

async function upload(film: Blob, seconds: number, final: 'ended' | 'failed') {
  // The film exists only in this tab, so a failed upload is tried again
  // rather than given up on the first network hiccup.
  let lastError = '';
  for (let tryNo = 1; tryNo <= 3; tryNo += 1) {
    try {
      const res = await api(`/api/sitting-runner/film?seconds=${Math.round(seconds)}&final=${final}`, {
        method: 'POST',
        headers: { 'content-type': film.type },
        body: film,
      });
      if (res.ok) return;
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      lastError = body?.error || `the server said ${res.status}`;
      if (res.status < 500) break;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((r) => setTimeout(r, 3000 * tryNo));
  }
  throw new Error(`the film could not be kept: ${lastError}`);
}

async function main() {
  window.__sitting = { status: 'starting' };
  if (!token) return finish('failed', 'no sitting token in the URL');

  const res = await api('/api/sitting-runner/screening');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return finish('failed', `the Screening could not be loaded: ${body?.error || res.status}`);
  }
  const plan = (await res.json()) as ScreeningResponse;
  log('screening', { filmId: plan.filmId, reels: 1 + plan.reels.length, filmSeconds: plan.filmSeconds });

  // The Stage's transport, pointed at the runner's proxy: same client, same
  // endpoint pin — the key is attached on the Worker, never here.
  const transport = stageTransport(null, plan.endpoint || DIRECTOR_ENDPOINT, {
    proxyUrl: '/api/sitting-runner/fal/proxy',
    headers: { [TOKEN_HEADER]: token },
  });

  // ── The recorder: the Stage's rules, without React ─────────────────────────
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let armed = false;
  let settled = false;

  const session = createDirectorSession({
    transport,
    maxWallSeconds: plan.maxWallSeconds,
    onTrace: (line) => console.log(`[director:trace] ${line}`),
  });

  const stopRecorder = () =>
    new Promise<Blob[]>((resolve) => {
      const r = recorder;
      recorder = null;
      if (!r) return resolve([]);
      r.addEventListener(
        'stop',
        () => {
          const collected = chunks;
          chunks = [];
          resolve(collected);
        },
        { once: true },
      );
      if (r.state !== 'inactive') r.stop();
      else resolve(chunks);
    });

  async function settle(state: SessionState, message: string | null, detail: string | null) {
    if (settled) return;
    settled = true;
    const verdict = verdictFor(state, armed);
    const final = state === 'failed' ? 'failed' : 'ended';
    const seconds = Math.floor(session.snapshot.videoSeconds);
    const parts = await stopRecorder();
    const bytes = parts.reduce((n, p) => n + p.size, 0);
    if (verdict !== 'keep' || bytes === 0) {
      await report({ state: 'failed', filmS: seconds, message: message || 'nothing was recorded', detail });
      return finish('failed', detail || message || 'this sitting produced no film');
    }
    const type = baseType(parts[0]?.type || 'video/webm');
    await report({ state: 'uploading', filmS: seconds });
    log('uploading', { bytes, seconds, type, final });
    try {
      await upload(new Blob(parts, { type }), seconds, final);
    } catch (error) {
      await report({ state: 'failed', filmS: seconds, message: (error as Error).message });
      return finish('failed', (error as Error).message);
    }
    if (final === 'failed') {
      // The partial film is kept (it was billed), and the Worker already knows
      // this attempt failed from the upload's `final`.
      return finish('failed', detail || message || 'the Director session failed');
    }
    finish('done');
  }

  let lastState: SessionState | null = null;
  let lastBeat = 0;
  let lastFilmS = -1;
  session.subscribe((snap) => {
    const filmS = Math.floor(snap.videoSeconds);
    if (snap.state !== lastState) {
      lastState = snap.state;
      log('state', { state: snap.state, filmS, target: snap.videoTarget, reel: snap.reel, message: snap.message, detail: snap.detail });
      if (!['ended', 'failed'].includes(snap.state)) {
        void report({ state: snap.state, filmS, target: snap.videoTarget, reel: snap.reel });
      }
    } else if (filmS !== lastFilmS && Date.now() - lastBeat > 10_000) {
      lastBeat = Date.now();
      log('progress', { filmS, target: snap.videoTarget, reel: snap.reel });
      void report({ state: snap.state, filmS, target: snap.videoTarget, reel: snap.reel });
    }
    lastFilmS = filmS;

    const stream = asMediaStream(snap.stream);
    if (picture && stream && picture.srcObject !== stream) {
      picture.srcObject = stream;
      void picture.play().catch(() => {});
    }

    // Arm once, the moment there is both a stream and a picture — the Stage's rule.
    if (!armed && snap.state === 'live' && stream) {
      const mimeType = supportedContainer();
      if (!mimeType) {
        log('recorder', { error: 'this browser cannot record' });
      } else {
        try {
          const r = new MediaRecorder(stream, { mimeType });
          chunks = [];
          r.addEventListener('dataavailable', (event) => {
            if (event.data.size > 0) chunks.push(event.data);
          });
          r.start(2000);
          recorder = r;
          armed = true;
          log('recording', { mimeType });
        } catch (error) {
          log('recorder', { error: (error as Error).message });
        }
      }
    }

    if (verdictFor(snap.state, armed) !== 'wait' && snap.state !== 'idle') {
      void settle(snap.state, snap.message, snap.detail);
    }
  });

  window.__sitting = { status: 'running' };
  session.open({ configure: plan.configure, reels: plan.reels, filmSeconds: plan.filmSeconds });
}

main().catch((error) => {
  void report({ state: 'failed', message: String((error as Error)?.message || error) });
  finish('failed', String((error as Error)?.message || error));
});
