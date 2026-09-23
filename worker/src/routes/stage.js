// The Stage — where a Series becomes a film, and the two things that only the
// server can do about it.
//
// A Director Session is a WebRTC connection between the BROWSER and fal: three
// authenticated HTTP calls to open it, then a heartbeat every five seconds, then
// media over a peer connection the Worker never sees. So this file is not the
// session. It is:
//
//   1. the proxy those three calls and the heartbeat go through, because the
//      page must not hold a fal key, and
//   2. the ledger of what the session PRODUCED, because fal keeps nothing.
//
// ── Why the proxy is pinned, and pinned twice ───────────────────────────────
// A proxy that will forward anywhere is a fal key with extra steps. This one
// forwards to exactly two hosts, exactly four paths, and exactly one endpoint —
// checked before the key is attached, so a caller probing it learns nothing.
//
// Deliberately NOT forwarded: `rest.fal.ai/tokens/`. That endpoint mints a
// short-lived credential whose SCOPE COMES FROM THE REQUEST BODY, so forwarding
// it would hand any caller a key for any model and undo the pin entirely. The
// WMA transport never asks for one.
//
// ── Why there is a cap ──────────────────────────────────────────────────────
// A session bills for every second it is open. The page closes it on pause, on
// navigate and on error — but a crashed tab, a slept laptop or a bug leaves a
// runner streaming to nobody, and the only thing keeping it alive is that
// heartbeat. The heartbeat comes through here, which makes this the one place
// that can end a session everything else has lost track of.
//
// ── Why a sitting is recorded as it plays ───────────────────────────────────
// A WMA session returns no file. fal keeps nothing. A sitting that was not
// recorded WHILE IT PLAYED cannot be recovered — and re-running the recipe does
// not get it back, because the endpoint is not deterministic: two sittings of
// one Series are different films.
import { absolutizeSeries, directorUrl, readSeries, readSittings, updateSittings } from "../lib/director.js";
import { putMedia } from "../lib/media.js";
import { recipe, screening } from "../lib/series.ts";

/** The one model this key may be spent on. */
export const DIRECTOR_ENDPOINT = "minimax/h3-max/director";

const WMA_HOST = "wma.fal.run";
const APP_HOSTS = new Set(["fal.run", "queue.fal.run"]);
/** The bridge routes a session actually uses. Everything else on that host is not ours. */
const WMA_PATHS = new Set(["/ice", "/session", "/session/heartbeat"]);
const HEARTBEAT_PATH = "/session/heartbeat";
const TARGET_URL_HEADER = "x-fal-target-url";

/**
 * How long one sitting may run before the proxy stops feeding its heartbeat.
 *
 * Twenty minutes. Long enough for any film this studio authors — a cue sheet is
 * capped at 64 beats per reel — and short enough that a forgotten tab costs
 * minutes rather than an afternoon. Override per deployment with
 * `MAX_SESSION_SECONDS`.
 */
const DEFAULT_MAX_SESSION_SECONDS = 20 * 60;

const maxSessionSeconds = (env) => {
  const n = Number(env?.MAX_SESSION_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_SESSION_SECONDS;
};

/** `Key <credentials>`, idempotently — a key that already carries the scheme is left alone. */
export function falAuthorization(key) {
  if (!key) return undefined;
  return /^key /i.test(key) ? key : `Key ${key}`;
}

const isDirector = (endpoint) =>
  endpoint === DIRECTOR_ENDPOINT || !!endpoint?.startsWith(`${DIRECTOR_ENDPOINT}/`);

/** The `app_id` an `/ice` or `/session` body names, if it names one plainly. */
function appId(body) {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed.app_id === "string" ? parsed.app_id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The session id a heartbeat carries.
 *
 * `{ "session_id": "…" }` is the entire body the client sends, and it is the
 * only identifier any of the three WMA calls carries that lives as long as the
 * session does.
 */
export function heartbeatSessionId(body) {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed.session_id === "string" && parsed.session_id ? parsed.session_id : undefined;
  } catch {
    return undefined;
  }
}

/** `null` when the target may be forwarded; the refusal, with a reason, when it may not. */
export function refuseTarget(targetUrl, body) {
  const forbidden = (error) => Response.json({ error }, { status: 403 });
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return Response.json({ error: `${TARGET_URL_HEADER} is not a url` }, { status: 400 });
  }
  if (target.protocol !== "https:") return forbidden("only https targets are forwarded");

  const host = target.host.toLowerCase();
  if (host === WMA_HOST) {
    const path = target.pathname.replace(/\/+$/, "") || "/";
    if (!WMA_PATHS.has(path)) return forbidden(`${path} is not a session route`);
    // The heartbeat names no app — it acts on a session the bridge already
    // authorized — so the endpoint pin applies to the two calls that do.
    if (path !== HEARTBEAT_PATH && !isDirector(appId(body))) {
      return forbidden(`only ${DIRECTOR_ENDPOINT} may be opened through this proxy`);
    }
    return null;
  }
  if (APP_HOSTS.has(host)) {
    if (!isDirector(target.pathname.replace(/^\//, ""))) {
      return forbidden(`only ${DIRECTOR_ENDPOINT} may be called through this proxy`);
    }
    return null;
  }
  return forbidden(`${host} is not a fal host this proxy forwards to`);
}

// ── The session clock ────────────────────────────────────────────────────────
//
// In memory, one map per isolate, and honestly weaker than it looks: a session's
// beats can land on different isolates and a cold isolate starts the clock over.
// It BOUNDS the damage rather than eliminating it. The sturdier version is the
// same map in D1, which is a swap of this block and not of its callers — left
// until a forgotten tab has actually cost something, because a per-heartbeat
// write every five seconds is a real price to pay for a rare failure.
const RETENTION_MS = 60 * 60 * 1000;

export function createSessionClock() {
  const firstSeen = new Map();
  return {
    elapsed(sessionId, now) {
      const at = firstSeen.get(sessionId);
      if (at === undefined) {
        firstSeen.set(sessionId, now);
        // Only when the map has grown enough to be worth walking — a busy
        // isolate should not pay a full sweep per heartbeat.
        if (firstSeen.size >= 512) {
          for (const [id, seen] of firstSeen) if (now - seen > RETENTION_MS) firstSeen.delete(id);
        }
        return 0;
      }
      return (now - at) / 1000;
    },
    size: () => firstSeen.size,
  };
}

/** The process-wide clock the route uses. Tests build their own. */
export const sessionClock = createSessionClock();

/**
 * The refusal a heartbeat gets once its session has run past the cap.
 *
 * The clock starts at the FIRST heartbeat rather than at `/session`, because the
 * heartbeat is the only call that names the session id. That puts the cap about
 * five seconds later than the session's true start, which is well inside the
 * minute fal bills as a minimum anyway.
 *
 * The client tolerates a single missed beat and fails the session after three
 * consecutive rejections — so a capped session dies in the browser within about
 * fifteen seconds whether or not the runner notices the silence.
 */
export function refuseCappedSession(targetUrl, body, { env, clock = sessionClock, now = Date.now } = {}) {
  let path;
  try {
    const target = new URL(targetUrl);
    if (target.host.toLowerCase() !== WMA_HOST) return null;
    path = target.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
  if (path !== HEARTBEAT_PATH) return null;

  const sessionId = heartbeatSessionId(body);
  // A beat with no session id is not a beat we can meter; the bridge will
  // reject it on its own merits.
  if (!sessionId) return null;

  const elapsed = clock.elapsed(sessionId, now());
  const cap = maxSessionSeconds(env);
  if (elapsed <= cap) return null;
  return Response.json(
    { error: "session limit reached", code: "session_limit", elapsedS: Math.round(elapsed) },
    { status: 403 },
  );
}

/** Headers that belong to OUR hop and must not be replayed to fal. */
const HOP_HEADERS = new Set([
  "host", "connection", "content-length", "accept-encoding", "cf-connecting-ip",
  "cf-ray", "cf-visitor", "cf-ipcountry", "x-forwarded-for", "x-forwarded-proto",
  "x-real-ip", "cookie", "authorization", TARGET_URL_HEADER,
  // The caller's own credentials and project routing. fal has no use for them
  // and forwarding a key to a third party is how a key leaks.
  "x-fal-key", "x-flue-fal-key", "x-atlas-key", "x-flue-atlas-key",
  "x-project-id", "x-episode-id", "x-client-id", "x-flue-agent-user",
]);

export function registerStage(app) {
  // ── The proxy ─────────────────────────────────────────────────────────────
  //
  // Hand-rolled rather than `@fal-ai/server-proxy`, because everything that
  // package does for us here is the forwarding, and everything that MATTERS —
  // the host pin, the path pin, the endpoint pin, the cap — is above and would
  // have to be written anyway. One fewer alpha dependency in the Worker.
  app.all("/api/stage/fal/proxy", async (c) => {
    const targetUrl = c.req.header(TARGET_URL_HEADER);
    if (!targetUrl) return c.json({ error: `${TARGET_URL_HEADER} is required` }, 400);

    // Read the body ONCE. It is needed three times — the endpoint pin, the
    // session cap, and the forwarded request — and a body can only be consumed
    // once.
    const method = c.req.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await c.req.text();

    const badTarget = refuseTarget(targetUrl, body);
    if (badTarget) return badTarget;

    const capped = refuseCappedSession(targetUrl, body, { env: c.env });
    if (capped) return capped;

    // BYOK, like every other generation in this studio: the author's own fal key
    // arrives per request and is never persisted. `FAL_KEY` is the operator's
    // optional dev fallback.
    const key = c.req.header("x-fal-key") || c.env.FAL_KEY || "";
    if (!key) {
      return c.json(
        { error: "A Director sitting needs your fal key — add it in Settings.", code: "no_fal_key" },
        401,
      );
    }

    const headers = new Headers();
    for (const [name, value] of c.req.raw.headers) {
      if (!HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    }
    // `Key ` is not decoration. fal's scheme is `Authorization: Key <creds>`;
    // the bare key comes back as 401 "unrecognized auth scheme".
    headers.set("authorization", falAuthorization(key));

    const upstream = await fetch(targetUrl, { method, headers, body });
    // Passed through rather than re-read: `/session` answers with an SDP answer
    // the client parses, and buffering it here would buy nothing.
    const out = new Headers(upstream.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  });

  // ── What a sitting would send ─────────────────────────────────────────────

  app.get("/api/stage/series/:id", async (c) => {
    const pid = c.get("projectId");
    const series = await readSeries(c.env, pid, c.req.param("id"));
    if (!series) return c.json({ error: "No such Series" }, 404);
    const resolved = absolutizeSeries(c.env, pid, series);
    const plan = screening(resolved);
    return c.json({
      seriesId: series.id,
      title: series.title,
      aspectRatio: series.aspectRatio,
      resolution: series.resolution,
      endpoint: DIRECTOR_ENDPOINT,
      configure: recipe(resolved),
      reels: plan.reels,
      filmSeconds: plan.filmSeconds,
      maxSessionSeconds: maxSessionSeconds(c.env),
    });
  });

  // ── Kept sittings ─────────────────────────────────────────────────────────

  app.get("/api/stage/sittings", async (c) => {
    const db = await readSittings(c.env, c.get("projectId"));
    return c.json({
      kept: [...(db.kept || [])]
        .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))
        .map((s) => ({ ...s, url: directorUrl(s.file), scoredUrl: directorUrl(s.scoredFile) })),
    });
  });

  // The recording itself, as it came off `MediaRecorder`. Multipart, because
  // this is a video file and not a document — and the container is whatever the
  // browser produced (WebM in most, mp4 in Safari), which is why the extension
  // rides along rather than being assumed.
  app.post("/api/stage/sittings", async (c) => {
    const pid = c.get("projectId");
    let form;
    try { form = await c.req.parseBody(); } catch { return c.json({ error: "Expected multipart form data" }, 400); }

    const file = form.film;
    if (!(file instanceof File)) return c.json({ error: "Attach the recording as `film`" }, 400);
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength) return c.json({ error: "The recording is empty" }, 400);

    const seriesId = String(form.seriesId || "");
    const series = await readSeries(c.env, pid, seriesId);
    if (!series) return c.json({ error: "A sitting belongs to a Series — send a `seriesId` that exists" }, 404);

    const type = file.type || "video/webm";
    const ext = /mp4/i.test(type) ? "mp4" : "webm";
    const id = crypto.randomUUID();
    const name = `sitting_${seriesId}_${id}.${ext}`;
    await putMedia(c.env, pid, "director", name, bytes, type);

    const entry = {
      id,
      seriesId,
      title: series.title,
      file: name,
      contentType: type,
      bytes: bytes.byteLength,
      seconds: Number(form.seconds) || 0,
      recordedAt: new Date().toISOString(),
      // The sheet this sitting was shot against, stamped now. A sitting whose
      // cue sheet has since moved is still a film of the sheet it was made
      // from, and the Musicalized tab needs to know which one that was.
      cueTiming: series.audioVersion?.cueTiming ?? null,
      beats: (series.directions || []).length,
    };
    await updateSittings(c.env, pid, (db) => {
      db.seq = (db.seq || 0) + 1;
      db.kept = [entry, ...(db.kept || [])];
      return {};
    });
    return c.json({ ok: true, sitting: { ...entry, url: directorUrl(name) } });
  });

  // Forgetting a sitting drops the RECORD. The bytes stay in R2, the same
  // promise the plugin marketplace makes about uninstalling: nothing you made
  // is deleted by a tidy-up.
  app.delete("/api/stage/sittings/:id", async (c) => {
    const id = c.req.param("id");
    const res = await updateSittings(c.env, c.get("projectId"), (db) => {
      const before = (db.kept || []).length;
      db.kept = (db.kept || []).filter((s) => s.id !== id);
      return { removed: before - db.kept.length };
    });
    if (!res.removed) return c.json({ error: "No such sitting" }, 404);
    return c.json({ ok: true });
  });
}
