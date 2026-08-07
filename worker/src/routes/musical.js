// Musical — a song → audio "shot bible". Backed by the D1 doc store (`docs` row
// `musical`) for state and R2 (`media/<pid>/sound-media/…`, the same kind Sound
// Studio uses) for the audio bytes.
//
// The flow, mirroring the Remotion "Deliver" render (routes/render.js): the
// author uploads a song in TWO aligned versions — a vocal stem (clean vocals,
// where breath gaps are visible) and the full mix — then "Split" cuts the song
// into shot-length segments (≤ cap, default 15s) whose cuts land on real breath
// gaps in the stem, so a lip-synced AI video clip never breaks mid-word at a
// seam. The cutting is DSP (ffmpeg + numpy), which a Worker can't run, so it
// runs as a detached Daytona job exactly like the render does: the Worker builds
// a bash script, starts it on a python+ffmpeg sandbox, the script pulls the
// audio from the public /files/, cuts both versions at a shared boundary list,
// and PUTs each segment plus a manifest.json back through /ingest. The caller
// polls GET /api/musical/job/:id, which finalizes the doc (upserts the cut
// segments by label) the first time it sees the job done.
//
// The agent then authors each segment's sung lyric + director prompt and saves
// them (POST /api/musical/segments) — the deterministic DSP is server code, the
// creative authoring is the model. Both the GUI Split button and the agent's
// split_song tool drive the SAME routes.
import { readDoc, updateDoc } from "../lib/docs.js";
import { mediaKey, putMedia } from "../lib/media.js";
import { createJob, pollJob, startSandboxJob, jobView } from "../lib/jobs.js";

const MUSICAL_LABELS = { app: "shot-studio", role: "musical" };
const DEFAULT_CAP_SEC = 15;

const AUDIO_TYPES = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

const emptyMusical = () => ({ song: null, continuity: "", segments: [], split: null, seq: 0 });
const readMusical = (env, pid) => readDoc(env, pid, "musical", emptyMusical());
const updateMusical = (env, pid, mutate) => updateDoc(env, pid, "musical", emptyMusical(), mutate);

// Duration in seconds from a RIFF/WAVE header — same probe Sound Studio uses.
// Returns 0 for non-WAV (mp3), where the client supplies `totalSec` instead.
function wavDuration(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.getUint32(0) !== 0x52494646 || dv.getUint32(8) !== 0x57415645) return 0;
    let off = 12, byteRate = 0, dataSize = 0;
    while (off + 8 <= dv.byteLength) {
      const chunkId = dv.getUint32(off);
      const size = dv.getUint32(off + 4, true);
      if (chunkId === 0x666d7420) byteRate = dv.getUint32(off + 16, true);
      else if (chunkId === 0x64617461) dataSize = Math.min(size, dv.byteLength - off - 8);
      off += 8 + size + (size % 2);
    }
    return byteRate && dataSize ? Math.round((dataSize / byteRate) * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

const extOf = (name) => {
  const m = /\.(wav|mp3|ogg|opus|m4a|aac|flac)(?:\?|$)/i.exec(String(name || ""));
  return m ? "." + m[1].toLowerCase() : ".mp3";
};

// Serialize the doc for the client, resolving every audio file to a
// `/sound-media/<file>` streaming URL (Range-served, seekable by <audio>).
const mediaUrl = (file) => (file ? "/sound-media/" + file : null);
function musicalView(db) {
  const song = db.song
    ? { ...db.song, voxUrl: mediaUrl(db.song.voxFile), mixUrl: mediaUrl(db.song.mixFile) }
    : null;
  const segments = (db.segments || []).map((s) => ({
    ...s,
    voxUrl: mediaUrl(s.voxFile),
    mixUrl: mediaUrl(s.mixFile),
  }));
  return { song, continuity: db.continuity || "", segments, split: db.split || null };
}

// The python cutter, written into the Daytona sandbox and run there. Detects
// breath gaps in the vocal stem via RMS energy (the lyric-shot-splitter method),
// picks boundaries (an explicit list wins; otherwise greedily packs phrases onto
// gap midpoints so each segment ≤ cap), then cuts BOTH versions at the shared
// boundary list and writes a manifest. Cuts are re-encoded (not stream-copied)
// so they're sample-accurate rather than snapping to MP3 frame boundaries.
const SPLIT_PY = String.raw`
import sys, os, json, subprocess, wave
import numpy as np

vox_wav, mix_path, out_dir, cap_s, song_id, bounds_arg, labels_arg = sys.argv[1:8]
cap = float(cap_s)
os.makedirs(out_dir, exist_ok=True)

def load_mono(path):
    w = wave.open(path, 'rb'); sr = w.getframerate(); ch = w.getnchannels()
    raw = w.readframes(w.getnframes()); w.close()
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if ch > 1: data = data.reshape(-1, ch).mean(axis=1)
    return data / 32768.0, sr

def rms_db(data, sr, window=0.05):
    win = max(1, int(sr * window)); n = len(data) // win
    rms = np.array([np.sqrt(np.mean(data[i*win:(i+1)*win] ** 2)) for i in range(n)])
    return 20 * np.log10(rms + 1e-9), window

def smooth(db, k=3):
    return np.convolve(db, np.ones(k)/k, mode='same') if k > 1 else db

def find_gaps(db, window, thresh_db=32.0, min_gap=0.20):
    thresh = db.max() - thresh_db; silent = db < thresh; gaps = []; start = None
    for i, s in enumerate(silent):
        if s and start is None: start = i
        elif not s and start is not None:
            if (i - start) * window >= min_gap: gaps.append((start*window, i*window))
            start = None
    if start is not None and (len(silent) - start) * window >= min_gap:
        gaps.append((start*window, len(silent)*window))
    return gaps

data, sr = load_mono(vox_wav)
total = round(len(data) / sr, 2)
db, window = rms_db(data, sr)
gaps = find_gaps(smooth(db, 3), window)

def autopack(gaps, total, cap):
    mids = sorted({round((a+b)/2, 2) for a, b in gaps if 0 < (a+b)/2 < total})
    bounds = [0.0]; cur = 0.0; forced = 0
    while total - cur > cap + 0.05:
        cand = [m for m in mids if cur + 0.4 < m <= cur + cap]
        if cand: nxt = cand[-1]
        else: nxt = round(cur + cap, 2); forced += 1
        bounds.append(nxt); cur = nxt
    bounds.append(total)
    return bounds, forced

forced = 0
if bounds_arg.strip():
    bounds = [float(x) for x in bounds_arg.split(',') if x.strip() != '']
    if bounds[0] > 0: bounds = [0.0] + bounds
    if abs(bounds[-1] - total) > 0.5: bounds.append(total)
else:
    bounds, forced = autopack(gaps, total, cap)

nshots = len(bounds) - 1
if labels_arg.strip():
    labels = [x.strip() for x in labels_arg.split(',')]
else:
    labels = ['%02d' % (i+1) for i in range(nshots)]
labels = (labels + ['%02d' % (i+1) for i in range(nshots)])[:nshots]

def ff_cut(src, t0, t1, out):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ss', str(t0), '-to', str(t1),
                    '-c:a', 'libmp3lame', '-q:a', '2', out], check=True)

segments = []
for i in range(nshots):
    t0, t1 = round(bounds[i], 2), round(bounds[i+1], 2)
    lab = labels[i]; tag = '%.2f-%.2f' % (t0, t1)
    vox = 'musical_%s_shot%s_vox_%s.mp3' % (song_id, lab, tag)
    mix = 'musical_%s_shot%s_mix_%s.mp3' % (song_id, lab, tag)
    ff_cut(vox_wav, t0, t1, os.path.join(out_dir, vox))
    ff_cut(mix_path, t0, t1, os.path.join(out_dir, mix))
    segments.append({'label': lab, 't0': t0, 't1': t1, 'dur': round(t1 - t0, 2),
                     'voxFile': vox, 'mixFile': mix, 'over': (t1 - t0) > cap + 0.05})

manifest = {'songId': song_id, 'total': total, 'capSec': cap, 'segments': segments,
            'gaps': [[round(a, 2), round(b, 2)] for a, b in gaps], 'forcedCuts': forced}
with open(os.path.join(out_dir, 'manifest.json'), 'w') as f:
    json.dump(manifest, f)
print('cut %d segments' % nshots)
`;

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
}

async function daytonaClient(env) {
  const { Daytona } = await import("@daytona/sdk");
  return new Daytona({ apiKey: env.DAYTONA_API_KEY });
}

// Reuse a warm musical sandbox if one is up, else build the python+ffmpeg image
// once. Same lifecycle as getRenderSandbox (routes/render.js), lighter image.
async function getMusicalSandbox(env) {
  const { Daytona, Image } = await import("@daytona/sdk");
  const daytona = new Daytona({ apiKey: env.DAYTONA_API_KEY });
  for await (const s of daytona.list({ labels: MUSICAL_LABELS })) {
    const st = String(s.state || "").toLowerCase();
    if (st && st !== "started" && st !== "running") {
      try { await s.start(); await s.waitUntilStarted?.(); } catch { break; }
    }
    return s;
  }
  const img = Image.base("python:3.12-slim-bookworm").runCommands(
    "apt-get update",
    "apt-get install -y --no-install-recommends ffmpeg curl ca-certificates",
    "pip install --no-cache-dir numpy",
    "rm -rf /var/lib/apt/lists/*",
  );
  return daytona.create(
    { image: img, resources: { cpu: 2, memory: 4, disk: 5 }, autoStopInterval: 30, labels: MUSICAL_LABELS },
    { timeout: 0, onSnapshotCreateLogs: () => {} },
  );
}

export function registerMusical(app) {
  // The whole shot bible for the client.
  app.get("/api/musical", async (c) => {
    const db = await readMusical(c.env, c.get("projectId"));
    return c.json(musicalView(db));
  });

  // Upload the song. Multipart with `vox` and/or `mix` files (add one, then the
  // other), plus optional `title`, `lyrics`, `totalSec` (mp3 has no header
  // duration, so the client reads it off an <audio> element and sends it).
  app.post("/api/musical/song", async (c) => {
    const pid = c.get("projectId");
    let form;
    try { form = await c.req.parseBody(); } catch { return c.json({ error: "Expected multipart form data" }, 400); }
    const vox = form.vox, mix = form.mix;
    const title = typeof form.title === "string" ? form.title.trim() : "";
    const lyrics = typeof form.lyrics === "string" ? form.lyrics : "";
    const totalSecIn = Number(form.totalSec);
    if (!(vox instanceof File) && !(mix instanceof File))
      return c.json({ error: "Attach a `vox` (vocal stem) and/or `mix` (full mix) audio file" }, 400);

    // Stable per-song id namespaces the R2 filenames so a re-upload of the same
    // role overwrites cleanly and segments group under one prefix.
    const existing = await readMusical(c.env, pid);
    const songId = existing.song?.id || `song_${(existing.seq || 0) + 1}`;

    let total = Number.isFinite(totalSecIn) && totalSecIn > 0 ? totalSecIn : 0;
    const stored = {};
    for (const [role, file] of [["vox", vox], ["mix", mix]]) {
      if (!(file instanceof File)) continue;
      const buf = await file.arrayBuffer();
      if (!buf.byteLength) return c.json({ error: `${role} file is empty` }, 400);
      const ext = extOf(file.name);
      const name = `musical_${songId}_${role}${ext}`;
      await putMedia(c.env, pid, "sound-media", name, buf, AUDIO_TYPES[ext] || "application/octet-stream");
      stored[role === "vox" ? "voxFile" : "mixFile"] = name;
      if (!total) total = wavDuration(buf);
    }

    const res = await updateMusical(c.env, pid, (m) => {
      if (!m.song) { m.seq = (m.seq || 0) + 1; m.song = { id: songId, title: "", totalSec: 0, lyrics: "", capSec: DEFAULT_CAP_SEC }; }
      Object.assign(m.song, stored);
      if (title) m.song.title = title;
      if (lyrics) m.song.lyrics = lyrics;
      if (total) m.song.totalSec = total;
      return { song: m.song };
    });
    return c.json({ ok: true, song: { ...res.song, voxUrl: mediaUrl(res.song.voxFile), mixUrl: mediaUrl(res.song.mixFile) } });
  });

  // Start the split as a detached Daytona job. Optional `boundaries` (seconds,
  // ascending) refine the cut by hand; omitted → auto-pack on detected gaps.
  // Returns { jobId } — poll GET /api/musical/job/:id.
  app.post("/api/musical/split", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const db = await readMusical(c.env, pid);
    if (!db.song?.voxFile) return c.json({ error: "Upload a vocal stem first — gap detection runs on it" }, 400);
    if (!db.song?.mixFile) return c.json({ error: "Upload the full mix first — it's the second version of each cut" }, 400);
    if (!c.env.DAYTONA_API_KEY) return c.json({ error: "Audio cutting needs Daytona (DAYTONA_API_KEY not set)" }, 503);

    const capSec = Number.isFinite(+body.capSec) ? Math.min(30, Math.max(3, +body.capSec)) : (db.song.capSec || DEFAULT_CAP_SEC);
    const boundaries = Array.isArray(body.boundaries)
      ? body.boundaries.map(Number).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
      : [];
    const labels = Array.isArray(body.labels) ? body.labels.map((x) => String(x).replace(/[^A-Za-z0-9]/g, "")) : [];
    const songId = db.song.id;

    const base = (c.env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
    const voxKey = mediaKey(pid, "sound-media", db.song.voxFile);
    const mixKey = mediaKey(pid, "sound-media", db.song.mixFile);
    const manifestKey = `media/${pid}/sound-media/${songId}-manifest.json`;
    const voxExt = extOf(db.song.voxFile);
    const mixExt = extOf(db.song.mixFile);

    const jobId = await createJob(c.env, "musical");
    const jd = `/tmp/${jobId}`;
    // Every dynamic value is passed base64'd and decoded in-shell so nothing —
    // a filename, a comma-separated boundary list, an empty arg — has to survive
    // shell quoting. `set -o pipefail` fails the job if any piped stage (a curl
    // download, the python) errors, so a broken split records as an error rather
    // than silently uploading a partial manifest.
    const dec = (s) => `"$(printf %s ${b64(s)} | base64 -d)"`;
    const script = [
      "set -eo pipefail",
      `cd /tmp && rm -rf ${jd} && mkdir -p ${jd}/out && cd ${jd}`,
      `curl -fsS -o vox${voxExt} ${dec(`${base}/files/${voxKey}`)}`,
      `curl -fsS -o mix${mixExt} ${dec(`${base}/files/${mixKey}`)}`,
      // Gap detection reads WAV; transcode the stem regardless of its container.
      `ffmpeg -v error -y -i vox${voxExt} vox.wav`,
      `printf %s ${b64(SPLIT_PY)} | base64 -d > split.py`,
      `python3 split.py vox.wav mix${mixExt} out ${capSec} ${songId} ${dec(boundaries.join(","))} ${dec(labels.join(","))}`,
      `for f in out/*.mp3; do curl -fsS -X PUT -H "authorization: Bearer ${c.env.INGEST_TOKEN}" -T "$f" ${base}/ingest/media/${pid}/sound-media/"$(basename "$f")"; done`,
      `curl -fsS -X PUT -H "authorization: Bearer ${c.env.INGEST_TOKEN}" -H "content-type: application/json" -T out/manifest.json ${dec(`${base}/ingest/${manifestKey}`)}`,
      `rm -rf ${jd}`,
    ].join("\n");

    try {
      const sandbox = await getMusicalSandbox(c.env);
      await startSandboxJob(c.env, jobId, sandbox, script, `/files/${manifestKey}`);
    } catch (e) {
      return c.json({ error: `Could not start split: ${e.message || e}` }, 502);
    }
    await updateMusical(c.env, pid, (m) => {
      m.split = { jobId, status: "running", at: new Date().toISOString(), capSec };
      return {};
    });
    return c.json({ ok: true, jobId, status: "running", capSec });
  });

  // Poll the split job. On the first poll AFTER it finishes, read the manifest
  // from R2 and finalize the doc: upsert each cut segment by label (setting
  // timecodes + files, preserving any lyric/prompt already authored). Any poller
  // — the GUI or the agent — triggers the finalize, so the cards appear without
  // a separate write.
  app.get("/api/musical/job/:id", async (c) => {
    const pid = c.get("projectId");
    const client = await daytonaClient(c.env);
    const row = await pollJob(c.env, c.req.param("id"), (id) => client.get(id));
    if (!row) return c.json({ error: "no such job" }, 404);
    const view = jobView(row);

    if (view.status === "done") {
      const db = await readMusical(c.env, pid);
      const key = `media/${pid}/sound-media/${db.song?.id}-manifest.json`;
      const obj = await c.env.BUCKET.get(key);
      const manifest = obj ? await obj.json().catch(() => null) : null;
      if (manifest?.segments && db.split?.status !== "done") {
        const res = await updateMusical(c.env, pid, (m) => {
          const byLabel = new Map((m.segments || []).map((s) => [s.label, s]));
          m.segments = manifest.segments.map((seg, i) => {
            const prev = byLabel.get(seg.label) || {};
            return {
              n: i + 1,
              label: seg.label,
              sec: prev.sec || "",
              t0: seg.t0, t1: seg.t1, dur: seg.dur,
              lyric: prev.lyric || "",
              prompt: prev.prompt || "",
              voxFile: seg.voxFile, mixFile: seg.mixFile,
              status: "cut",
              over: !!seg.over,
            };
          });
          if (m.song) m.song.totalSec = manifest.total || m.song.totalSec;
          m.split = { ...(m.split || {}), status: "done", at: new Date().toISOString(),
            forcedCuts: manifest.forcedCuts || 0, gaps: manifest.gaps || [] };
          return { segments: m.segments };
        });
        return c.json({ status: "done", segments: res.segments.map((s) => ({ ...s, voxUrl: mediaUrl(s.voxFile), mixUrl: mediaUrl(s.mixFile) })), forcedCuts: manifest.forcedCuts || 0 });
      }
      const cur = await readMusical(c.env, pid);
      return c.json({ status: "done", segments: musicalView(cur).segments });
    }
    if (view.status === "error") {
      await updateMusical(c.env, pid, (m) => { if (m.split?.jobId === c.req.param("id")) m.split.status = "error"; return {}; });
      return c.json({ status: "error", error: view.error });
    }
    return c.json({ status: "running" });
  });

  // Author the creative layer: sung lyric + director prompt per segment (matched
  // by label), plus the optional global continuity lock. Files/timecodes are set
  // by the split, so this only touches text — a re-save never disturbs the audio.
  app.post("/api/musical/segments", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const items = Array.isArray(body?.segments) ? body.segments : [];
    const res = await updateMusical(c.env, pid, (m) => {
      const byLabel = new Map((m.segments || []).map((s) => [s.label, s]));
      let touched = 0;
      for (const it of items) {
        const seg = byLabel.get(String(it.label));
        if (!seg) continue;
        if (typeof it.lyric === "string") seg.lyric = it.lyric;
        if (typeof it.prompt === "string") seg.prompt = it.prompt;
        if (typeof it.sec === "string") seg.sec = it.sec;
        touched++;
      }
      if (typeof body.continuity === "string") m.continuity = body.continuity;
      return { touched, total: (m.segments || []).length };
    });
    return c.json({ ok: true, updated: res.touched, segments: res.total });
  });

  // Reset the shot bible (drops the split + segments; leaves the uploaded song).
  app.post("/api/musical/reset", async (c) => {
    const pid = c.get("projectId");
    await updateMusical(c.env, pid, (m) => { m.segments = []; m.split = null; return {}; });
    return c.json({ ok: true });
  });
}
