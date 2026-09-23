import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  Music, Upload, Scissors, Play, Pause, Copy, Check, Download,
  Loader2, Wand2, RotateCcw, AudioLines, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy, renderMusicalMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Empty, Panel, ErrorNote, fmtTime } from "@/components/shared";

/* ---------------------------------------------------------------- *
 * Musical — a song → audio "shot bible"                            *
 *                                                                  *
 * Upload a song in two aligned versions (vocal stem + full mix),   *
 * "Split" it into shot-length segments cut on real breath gaps     *
 * (a Daytona ffmpeg job), then have the agent author each shot's   *
 * sung lyric + Seedance/Kling director prompt.                     *
 * ---------------------------------------------------------------- */

async function musApi(url, opts) {
  const res = await fetch(url, {
    headers: opts?.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

// Read a media file's duration in the browser (mp3 carries no header duration
// the Worker can cheaply probe, so the client measures it off an <audio>).
function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(a.duration) ? a.duration : 0); };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    a.src = url;
  });
}

/* ---- audio players -------------------------------------------------------- */

// A compact play/scrub player over a real /sound-media/ URL. These URLs are
// Range-served by the Worker (streamKey), so a plain <audio> element seeks fine
// — no Web Audio decode dance (that was only for the standalone sandboxed HTML).
function useAudio(src) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onT = () => setT(a.currentTime);
    const onMeta = () => setDur(a.duration || 0);
    const onEnd = () => { setPlaying(false); a.currentTime = 0; };
    a.addEventListener("timeupdate", onT);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => { a.removeEventListener("timeupdate", onT); a.removeEventListener("loadedmetadata", onMeta); a.removeEventListener("ended", onEnd); };
  }, [src]);
  const toggle = () => { const a = ref.current; if (!a) return; if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => {}); } else { a.pause(); setPlaying(false); } };
  const seek = (frac) => { const a = ref.current; if (a?.duration) a.currentTime = Math.max(0, Math.min(frac, 1)) * a.duration; };
  return { ref, playing, t, dur, toggle, seek };
}

function MiniPlayer({ src, label, file }) {
  const { ref, playing, t, dur, toggle, seek } = useAudio(src);
  const pct = dur ? (t / dur) * 100 : 0;
  return (
    <div className="rounded-md border bg-muted/40 p-2.5">
      <audio ref={ref} src={src} preload="metadata" />
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {file ? (
          <a href={src} download={file} className="text-muted-foreground hover:text-foreground" aria-label={`Download ${label}`} title={file}>
            <Download size={13} />
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          disabled={!src}
          className="flex size-8 min-w-8 items-center justify-center rounded-none bg-primary text-primary-foreground disabled:opacity-40"
          aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <div
          className="relative h-2 flex-1 cursor-pointer overflow-hidden rounded-none bg-border"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); }}
        >
          <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="min-w-[74px] text-right text-xs tabular-nums text-muted-foreground">
          {fmtTime(t)} / {fmtTime(dur || 0)}
        </span>
      </div>
    </div>
  );
}

// The "see what we're splitting" master player: the full song with a vocal/mix
// toggle, segment markers on the scrubber, and the current shot lit up.
function MasterPlayer({ song, segments }) {
  const [mode, setMode] = useState("mix");
  const src = mode === "vox" ? song.voxUrl : song.mixUrl;
  const { ref, playing, t, dur, toggle, seek } = useAudio(src);
  const total = dur || song.totalSec || 0;
  const pct = total ? (t / total) * 100 : 0;
  const current = segments.find((s) => t >= s.t0 && t < s.t1);
  return (
    <div className="rounded-lg border bg-card p-4">
      <audio ref={ref} src={src} preload="metadata" />
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Full song — reference before the split</div>
        <div className="inline-flex overflow-hidden rounded-none border">
          {["vox", "mix"].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={m === "vox" ? !song.voxUrl : !song.mixUrl}
              className={cn("px-3 py-1 text-xs font-semibold", mode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground", "disabled:opacity-40")}
            >
              {m === "vox" ? "Vocal only" : "Full mix"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={toggle} disabled={!src} className="flex size-12 min-w-12 items-center justify-center rounded-none bg-primary text-primary-foreground disabled:opacity-40" aria-label={playing ? "Pause song" : "Play song"}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div
          className="relative h-10 flex-1 cursor-pointer overflow-hidden rounded-md border bg-muted"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); }}
        >
          {total > 0 && segments.map((s) => (
            <div
              key={s.label}
              className={cn("absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-border text-[10px] font-bold", current?.label === s.label ? "bg-primary/25 text-foreground" : "text-muted-foreground")}
              style={{ left: `${(s.t0 / total) * 100}%`, width: `${((s.t1 - s.t0) / total) * 100}%` }}
            >
              {s.label}
            </div>
          ))}
          <div className="absolute inset-y-0 z-10 w-0.5 bg-foreground" style={{ left: `${pct}%` }} />
        </div>
        <span className="min-w-[92px] text-right text-sm font-semibold tabular-nums">{fmtTime(t)} / {fmtTime(total)}</span>
      </div>
    </div>
  );
}

/* ---- shot card ------------------------------------------------------------ */

function CopyButton({ text, label = "Copy prompt", small }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <Button
      variant="outline"
      size={small ? "sm" : "sm"}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
        setDone(true); setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </Button>
  );
}

function ShotCard({ seg }) {
  const [open, setOpen] = useState(false);
  return (
    <Card id={`mshot-${seg.label}`} className="scroll-mt-20 overflow-hidden">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex h-8 min-w-8 items-center justify-center rounded-md bg-primary px-2 text-sm font-bold text-primary-foreground">{seg.label}</span>
          {seg.sec ? <span className="text-sm font-semibold">{seg.sec}</span> : null}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            <b className="text-foreground">{seg.t0.toFixed(2)}s → {seg.t1.toFixed(2)}s</b> · {seg.dur.toFixed(2)}s
          </span>
          {seg.over ? <Badge variant="warning">over cap</Badge> : null}
        </div>

        {seg.lyric ? (
          <p className="mb-3 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm">
            <span className="mr-1 text-primary">♪</span>{seg.lyric}
          </p>
        ) : (
          <p className="mb-3 rounded-md border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">No lyric yet — author with the agent.</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MiniPlayer src={seg.voxUrl} label="Vocal only" file={seg.voxFile} />
          <MiniPlayer src={seg.mixUrl} label="Full mix" file={seg.mixFile} />
        </div>

        {seg.prompt ? (
          <div className="mt-3 rounded-md border">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Seedance / Kling prompt</span>
              <CopyButton text={seg.prompt} />
            </div>
            <pre className={cn("whitespace-pre-wrap px-3 py-2 text-sm", !open && "max-h-40 overflow-hidden")}>{seg.prompt}</pre>
            <button onClick={() => setOpen((o) => !o)} className="w-full border-t bg-muted/40 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              {open ? "Collapse" : "Show full prompt"}
            </button>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">No director prompt yet.</div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---- upload ---------------------------------------------------------------- */

function UploadPanel({ song, onChanged }) {
  const [vox, setVox] = useState(null);
  const [mix, setMix] = useState(null);
  const [title, setTitle] = useState(song?.title || "");
  const [lyrics, setLyrics] = useState(song?.lyrics || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      if (vox) fd.append("vox", vox);
      if (mix) fd.append("mix", mix);
      if (title.trim()) fd.append("title", title.trim());
      if (lyrics.trim()) fd.append("lyrics", lyrics);
      const durSrc = mix || vox;
      if (durSrc) { const d = await readDuration(durSrc); if (d) fd.append("totalSec", String(d)); }
      if (!vox && !mix && (title.trim() || lyrics.trim())) {
        // metadata-only save (title/lyrics) needs at least the song row to exist
      }
      await musApi("/api/musical/song", { method: "POST", body: fd });
      setVox(null); setMix(null);
      onChanged();
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const FileRow = ({ label, hint, file, set, has }) => (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-1 flex items-center gap-2">
        <AudioLines size={15} className="text-muted-foreground" />
        <span className="text-sm font-semibold">{label}</span>
        {has && !file ? <Badge variant="success">uploaded</Badge> : null}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      <Input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg" onChange={(e) => set(e.target.files?.[0] || null)} />
      {file ? <p className="mt-1 truncate text-xs text-muted-foreground">{file.name}</p> : null}
    </div>
  );

  return (
    <Panel title={song ? "Update song" : "Upload the song"} meta="Two aligned versions">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FileRow label="Vocal stem" hint="Isolated vocals — gap detection runs on this." file={vox} set={setVox} has={!!song?.voxFile} />
        <FileRow label="Full mix" hint="Vocals + instrumental — the second version of each cut." file={mix} set={setMix} has={!!song?.mixFile} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <div>
          <Label className="mb-1 block text-xs">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Little Voice, Big Heart" />
        </div>
        <div>
          <Label className="mb-1 block text-xs">Lyrics (optional — helps the agent author each shot)</Label>
          <Textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={4} placeholder="Paste the lyrics, with section labels if you have them…" />
        </div>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
      <div className="mt-3 flex justify-end">
        <Button onClick={submit} disabled={busy || (!vox && !mix && !title.trim() && !lyrics.trim())}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {song ? "Save" : "Upload"}
        </Button>
      </div>
    </Panel>
  );
}

/* ---- main ------------------------------------------------------------------ */

function MusicalStudio() {
  const { song, continuity, segments, split } = useLoaderData();
  const agent = useAgent();
  const revalidate = useRevalidator().revalidate;
  useRevalidateOnMount("musical");
  useRevalidateOnAgentIdle("musical", agent.status);

  const refetch = useCallback(() => { invalidateTabCache("musical"); revalidate(); }, [revalidate]);

  const [splitting, setSplitting] = useState(false);
  const [capSec, setCapSec] = useState(song?.capSec || 15);
  const [err, setErr] = useState(null);
  const pollRef = useRef(false);

  const ready = !!(song?.voxFile && song?.mixFile);
  const running = splitting || split?.status === "running";

  const runSplit = async () => {
    setErr(null); setSplitting(true);
    try {
      const { jobId } = await musApi("/api/musical/split", { method: "POST", body: JSON.stringify({ capSec: Number(capSec) }) });
      refetch();
      // Poll the job — the cut is quick, but a cold Daytona image build is slow.
      pollRef.current = true;
      const deadline = Date.now() + 6 * 60 * 1000;
      while (pollRef.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        const st = await musApi(`/api/musical/job/${jobId}`);
        if (st.status === "done") { break; }
        if (st.status === "error") { setErr(`Split failed: ${st.error || "unknown error"}`); break; }
      }
    } catch (e) { setErr(String(e.message || e)); }
    finally { setSplitting(false); refetch(); }
  };
  useEffect(() => () => { pollRef.current = false; }, []);

  const authorWithAgent = async () => {
    setErr(null);
    try { await agent.send({ message: renderMusicalMessage(song) }); }
    catch (e) { setErr(String(e.message || e)); }
  };

  const resetBible = async () => {
    setErr(null);
    try { await musApi("/api/musical/reset", { method: "POST" }); refetch(); }
    catch (e) { setErr(String(e.message || e)); }
  };

  const authored = useMemo(() => segments.filter((s) => (s.prompt || "").trim()).length, [segments]);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Music className="text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Musical</h1>
          <p className="text-sm text-muted-foreground">Split a song into shot-length audio cuts on real breath gaps, then author each shot.</p>
        </div>
        {song ? (
          <div className="ml-auto flex flex-wrap gap-2 text-xs">
            <Badge variant="muted">Runtime {fmtTime(song.totalSec || 0)}</Badge>
            <Badge variant="muted">Shots {segments.length}</Badge>
            {segments.length ? <Badge variant={authored === segments.length ? "success" : "warning"}>Authored {authored}/{segments.length}</Badge> : null}
          </div>
        ) : null}
      </div>

      {err ? <ErrorNote>{err}</ErrorNote> : null}

      <UploadPanel song={song} onChanged={refetch} />

      {song && ready ? (
        <>
          <MasterPlayer song={song} segments={segments} />

          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Max shot length</Label>
              <Input type="number" min={3} max={30} value={capSec} onChange={(e) => setCapSec(e.target.value)} className="w-20" />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
            <Button onClick={runSplit} disabled={running}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <Scissors size={15} />}
              {segments.length ? "Re-split" : "Split into shots"}
            </Button>
            {segments.length ? (
              <>
                <Button variant="secondary" onClick={authorWithAgent} disabled={agentIsBusy(agent)}>
                  <Wand2 size={15} /> Author prompts with agent
                </Button>
                <Button variant="ghost" onClick={resetBible} className="ml-auto text-muted-foreground">
                  <RotateCcw size={15} /> Reset
                </Button>
              </>
            ) : null}
            {running ? <span className="text-xs text-muted-foreground">Cutting on Daytona — the first run builds the sandbox (~1 min).</span> : null}
          </div>
        </>
      ) : song ? (
        <ErrorNote>Upload both a vocal stem and a full mix to enable the split.</ErrorNote>
      ) : null}

      {continuity ? (
        <Panel title="Global continuity lock" meta="Paste into every prompt">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm">{continuity}</p>
            <CopyButton text={continuity} label="Copy" />
          </div>
        </Panel>
      ) : null}

      {segments.length ? (
        <div className="space-y-4">
          {segments.map((s) => <ShotCard key={s.label} seg={s} />)}
        </div>
      ) : song && ready ? (
        <Empty>No shots yet — tap “Split into shots”.</Empty>
      ) : null}
    </div>
  );
}

export function loader() {
  return swr("musical", async () => {
    const res = await fetch("/api/musical");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load the Musical tab");
    return json;
  });
}

export function Component() {
  return <MusicalStudio />;
}
