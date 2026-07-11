import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Play, RefreshCw, ExternalLink, TriangleAlert, Music, Download, Clapperboard, Loader2, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { useAgent, agentIsBusy, stitchCutMessage, scoreCutMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useNavigate, useLoaderData, useRevalidator } from "react-router";
import { Empty, Panel, ErrorNote, fmtTime } from "@/components/shared";

// A stitched-cut <video> with a live "now playing" overlay. As the cut plays,
// the top-right chips track which multishot bundle (and, for a scored cut, which
// background-music cue) the current frame comes from — using the from→to
// timecodes the server computed for each segment. Clicking a chip jumps to that
// card in the Episode / Sound-studio tab (see App's navigateTo).
function NowPlayingCut({ src, segs, music, withMusic, navigateTo }) {
  const videoRef = useRef(null);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const usable = useMemo(() => (segs || []).filter((s) => s.file), [segs]);
  const seg =
    usable.find((s) => t >= s.start && t < s.end) ||
    (usable.length ? usable[t > 0 ? usable.length - 1 : 0] : null);
  const cue = withMusic ? (music || []).find((m) => t >= m.start && t < m.beatEnd) : null;

  const chip =
    "pointer-events-auto flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 " +
    "text-xs font-medium text-white shadow-sm backdrop-blur transition hover:bg-black/85";

  // Fall back to the last segment's end when the browser hasn't reported the
  // real container duration yet, so dots still lay out before playback starts.
  const dur = duration || (usable.length ? usable[usable.length - 1].end : 0);

  // Every shot boundary + (for a scored cut) every background-music cue, placed
  // on the strip by its fraction of the total duration.
  const markers = useMemo(() => {
    if (!(dur > 0)) return [];
    const shots = usable.map((s) => ({
      kind: "shot",
      key: `shot-${s.id}`,
      left: Math.min(1, Math.max(0, s.start / dur)),
      seekTo: s.start,
      seg: s,
    }));
    const cues = withMusic
      ? (music || []).map((m) => ({
          kind: "cue",
          key: `cue-${m.track}-${m.start}`,
          left: Math.min(1, Math.max(0, m.start / dur)),
          seekTo: m.start,
          cue: m,
        }))
      : [];
    return [...shots, ...cues];
  }, [usable, music, withMusic, dur]);

  const seek = (to) => {
    const v = videoRef.current;
    if (v && dur > 0) v.currentTime = Math.min(dur, Math.max(0, to));
  };
  const seekToFraction = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seek(frac * dur);
  };

  const tip =
    "pointer-events-auto flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md " +
    "border border-white/15 bg-black/85 px-2 py-1 text-[11px] font-medium text-white shadow-md " +
    "backdrop-blur transition-colors hover:border-primary hover:bg-primary/30";

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          key={src}
          ref={videoRef}
          controls
          preload="metadata"
          playsInline
          className="w-full rounded-lg bg-black"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onSeeked={(e) => setT(e.currentTarget.currentTime)}
        >
          <source src={src} type="video/mp4" />
        </video>

        <div className="pointer-events-none absolute right-2 top-2 flex max-w-[75%] flex-col items-end gap-1.5">
          {seg && (
            <button
              type="button"
              className={chip}
              onClick={() => navigateTo({ view: "episode", anchor: `ep-${seg.id}` })}
              title={`Jump to ${seg.id} in the Episode tab`}
            >
              <Clapperboard size={13} className="shrink-0 text-primary" />
              <span className="font-mono">{seg.id}</span>
              {seg.name && <span className="max-w-[16ch] truncate text-white/70">{seg.name}</span>}
              <ExternalLink size={11} className="shrink-0 opacity-70" />
            </button>
          )}
          {cue && (
            <button
              type="button"
              className={chip}
              onClick={() => navigateTo({ view: "sounds", anchor: `snd-${cue.track}` })}
              title={`Jump to “${cue.name || cue.label}” in the Sound studio`}
            >
              <Music size={13} className="shrink-0 text-primary" />
              <span className="max-w-[24ch] truncate">{cue.label}</span>
              <ExternalLink size={11} className="shrink-0 opacity-70" />
            </button>
          )}
        </div>
      </div>

      {/* Custom marker/seek strip: a dot at every shot (lime) and background-sound
          cue (sky). Click the strip to seek; hover a dot for a tooltip that, when
          clicked, jumps to that scene's Episode / Sound-studio card. */}
      {dur > 0 && (
        <div className="mx-[15px] px-0.5 pt-4">
          <div
            className="group/strip relative h-6 cursor-pointer"
            onClick={seekToFraction}
            role="slider"
            aria-label="cut timeline — click to seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(t)}
          >
            {/* track */}
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
            {/* progress fill */}
            <div
              className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary/50"
              style={{ width: `${Math.min(1, Math.max(0, t / dur)) * 100}%` }}
            />
            {/* playhead */}
            <div
              className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
              style={{ left: `${Math.min(1, Math.max(0, t / dur)) * 100}%` }}
            />
            {markers.map((mk) => {
              const isShot = mk.kind === "shot";
              return (
                <div
                  key={mk.key}
                  className="group/dot absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${mk.left * 100}%` }}
                >
                  {/* dot — click seeks to this marker's start */}
                  <button
                    type="button"
                    aria-label={
                      isShot
                        ? `${mk.seg.id} ${mk.seg.name || ""} — seek to scene`
                        : `${mk.cue.label} — seek to cue`
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      seek(mk.seekTo);
                    }}
                    className={cn(
                      "block h-2.5 w-2.5 rounded-full border border-black/40 shadow-sm transition hover:scale-125",
                      isShot ? "bg-primary" : "bg-sky-400",
                      !isShot && "translate-y-2" // sound dots sit on a lower row so they don't overlap shot dots
                    )}
                  />
                  {/* tooltip — hover the dot, move up onto it, click to jump to the card.
                      pb bridges the gap so the cursor never leaves the group. */}
                  <div
                    className={cn(
                      "absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 pb-2 group-hover/dot:block",
                      !isShot && "-translate-y-2"
                    )}
                  >
                    {isShot ? (
                      <button
                        type="button"
                        className={tip}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateTo({ view: "episode", anchor: `ep-${mk.seg.id}` });
                        }}
                        title={`Jump to ${mk.seg.id} in the Episode tab`}
                      >
                        <Clapperboard size={12} className="shrink-0 text-primary" />
                        <span className="font-mono">{mk.seg.id}</span>
                        {mk.seg.name && <span className="max-w-[18ch] truncate text-white/70">{mk.seg.name}</span>}
                        <span className="tabular-nums text-white/50">
                          {fmtTime(mk.seg.start)} → {fmtTime(mk.seg.end)}
                        </span>
                        <ExternalLink size={10} className="shrink-0 opacity-70" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={tip}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateTo({ view: "sounds", anchor: `snd-${mk.cue.track}` });
                        }}
                        title={`Jump to “${mk.cue.name || mk.cue.label}” in the Sound studio`}
                      >
                        <Music size={12} className="shrink-0 text-sky-400" />
                        <span className="max-w-[24ch] truncate">{mk.cue.label}</span>
                        <span className="tabular-nums text-white/50">
                          {fmtTime(mk.cue.start)} → {fmtTime(mk.cue.beatEnd)}
                        </span>
                        <ExternalLink size={10} className="shrink-0 opacity-70" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// One rendered complete-cut generation (a base stitch or a scored version),
// shown as a card with the version number, the now-playing player, the frozen
// setup it was baked from, and a download link. Every generation is immutable
// and keeps its own object setup, so an old version always plays exactly as it
// was rendered.
function CutVersionCard({ gen, bump, navigateTo, latest, compact, olderCount, onOpenHistory }) {
  const scored = gen.kind === "scored";
  const when = gen.at ? new Date(gen.at).toLocaleString() : null;
  const scenes = (gen.segments || []).filter((s) => s.file).length;
  const src = `${gen.url}?v=${bump}`;
  return (
    <Panel
      className={latest ? "border-primary/40" : undefined}
      title={
        <span className="flex items-center gap-2">
          {scored ? <Music size={15} className="text-primary" /> : <Play size={15} className="text-primary" fill="currentColor" />}
          <span className="font-mono">v{gen.v}</span>
          <span className="text-muted-foreground">·</span>
          {scored ? "with background music" : "stitched — no music"}
        </span>
      }
      meta={
        <div className="flex items-center gap-1.5">
          {latest && <Badge variant="info">latest</Badge>}
          {scored
            ? <Badge variant="success">{Math.abs(gen.gainDb ?? -22)} dB bed · {gen.music?.length || 0} cues</Badge>
            : <Badge variant="outline">{scenes} scenes · {fmtTime(gen.totalDuration)}</Badge>}
        </div>
      }
    >
      <div className="space-y-3">
        <NowPlayingCut
          src={src}
          segs={gen.segments || []}
          music={gen.music || []}
          withMusic={scored}
          navigateTo={navigateTo}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {gen.range?.from} → {gen.range?.to}
            {scored
              ? <> · {gen.music?.length || 0} cues ~{Math.abs(gen.gainDb ?? -22)} dB under dialogue &amp; SFX{when && <> · mixed {when}</>}</>
              : <>{when && <> · stitched {when}</>}</>}
          </span>
          <a
            className="inline-flex items-center gap-1 text-primary hover:underline"
            href={src} target="_blank" rel="noreferrer" download
          >
            <Download size={13} /> download mp4 <ExternalLink size={12} />
          </a>
        </div>
        {latest && !compact && olderCount > 0 && (
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <History size={12} /> {olderCount} older version{olderCount === 1 ? "" : "s"} in history
          </button>
        )}
      </div>
    </Panel>
  );
}

// Modal archive of every complete-cut generation, newest first. Each keeps its
// own preserved setup (takes, timecodes, music cues) so you can A/B any version.
function CutHistoryDialog({ open, onOpenChange, history, bump, navigateTo }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[495px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <SheetHeader className="border-b pr-14">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <History size={16} /> Complete-cut history
            <Badge variant="secondary">{history.length} version{history.length === 1 ? "" : "s"}</Badge>
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {history.length === 0 ? (
            <Empty>no versions rendered yet.</Empty>
          ) : (
            <div className="space-y-4">
              {history.map((gen, idx) => (
                <CutVersionCard
                  key={gen.v}
                  gen={gen}
                  bump={bump}
                  navigateTo={navigateTo}
                  latest={idx === 0}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CompleteCuts({ navigateTo }) {
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const data = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("cuts");
  const [error, setError] = useState(null); // stitch/score/trim (mutation) errors
  const [bump, setBump] = useState(0);      // media cache-bust for the cut <video>
  const [historyOpen, setHistoryOpen] = useState(false);

  // Re-read the cut when the agent finishes a turn (it may have just run
  // stitch_cuts / score_cut). Fire ONLY on the transition INTO "ready" — the old
  // version keyed off the unstable `revalidator` object and ran on the steady
  // "ready" state, so every app-wide revalidation (the SSE firehose, Refresh,
  // project switch) re-ran it and bumped the media nonce, remounting the <video>
  // and snapping playback back to 0. Cache-busting now lives in its own effect
  // below, gated on the cut actually changing.
  const prevStatus = useRef(agent.status);
  useEffect(() => {
    const enteredReady = agent.status === "ready" && prevStatus.current !== "ready";
    prevStatus.current = agent.status;
    if (enteredReady) {
      invalidateTabCache("cuts");
      revalidator.revalidate();
    }
  }, [agent.status, revalidator]);

  // Stitching/scoring runs THROUGH the agent chat (get_cuts → stitch_cuts /
  // score_cut), like every other mutation — the agent runs ffmpeg locally and
  // picks up the takes selected right now, so a fresh Episodes-tab pick is honored.
  const stitch = useCallback(async () => {
    setError(null);
    try {
      await agent.send({ message: stitchCutMessage(data?.range, (data?.segments || []).filter((s) => s.file).length) });
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [agent, data]);

  const score = useCallback(async () => {
    setError(null);
    try {
      await agent.send({ message: scoreCutMessage(data?.range) });
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [agent, data]);

  const segs = data.segments || [];
  const usable = segs.filter((s) => s.file);
  const missing = segs.filter((s) => s.missing);
  const fallbacks = usable.filter((s) => s.fallback);
  const total = usable.reduce((a, s) => a + s.duration, 0);
  const music = data.music || [];
  const history = data.history || [];     // every generation, newest-first
  const out = data.output;                // the latest generation (or null)
  const olderCount = Math.max(0, history.length - 1);

  // Bust the <video> media cache ONLY when a genuinely new render lands — keyed
  // off the output's identity (url + render time / version), not off every
  // revalidation. A re-stitch can reuse the same output URL, so we still need the
  // ?v= nonce; but bumping it on unrelated revalidations changed the <video> key
  // and tore the element down mid-playback. First render seeds prevSig, so no
  // bump on mount.
  const outSig = out ? `${out.url}::${out.at ?? out.v ?? ""}` : "";
  const prevSig = useRef(outSig);
  useEffect(() => {
    if (prevSig.current !== outSig) {
      prevSig.current = outSig;
      if (outSig) setBump((b) => b + 1);
    }
  }, [outSig]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Complete cut · {data.range.from} → {data.range.to}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setHistoryOpen(true)} disabled={history.length === 0} title={history.length === 0 ? "no versions yet" : `${history.length} version${history.length === 1 ? "" : "s"} rendered`}>
              <History size={13} /> history{history.length > 0 && <Badge variant="secondary" className="ml-1">{history.length}</Badge>}
            </Button>
            <Button onClick={stitch} disabled={agentBusy || usable.length === 0} title={agentBusy ? "agent is busy — finishing the current turn" : usable.length === 0 ? "no rendered takes to stitch" : "asks the agent to (re)build the complete cut as a new version"}>
              {agentBusy ? <><Loader2 size={13} className="animate-spin" /> agent working…</> : out ? <><RefreshCw size={13} /> re-stitch</> : <><Play size={13} fill="currentColor" /> stitch selected takes</>}
            </Button>
            <Button variant="outline" onClick={score} disabled={agentBusy || !out || music.length === 0} title={agentBusy ? "agent is busy — finishing the current turn" : !out ? "stitch the cut first" : music.length === 0 ? "no rendered music cues" : "mix the background music under the cut as a new version"}>
              {agentBusy ? <><Loader2 size={13} className="animate-spin" /> agent working…</> : <><Music size={13} /> {history.some((g) => g.kind === "scored") ? "add music version" : "add background music"}</>}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{usable.length} scenes</Badge>
          <Badge variant="success">~{fmtTime(total)} total</Badge>
          {fallbacks.length > 0 && <Badge variant="warning">{fallbacks.length} fallback (no take selected)</Badge>}
          {missing.length > 0 && <Badge variant="warning">{missing.length} missing</Badge>}
          <span className="flex items-center gap-1">concatenates the <Check size={11} /> selected take of each scene, in order, into one mp4</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {out ? (
        <CutVersionCard gen={out} bump={bump} navigateTo={navigateTo} latest olderCount={olderCount} onOpenHistory={() => setHistoryOpen(true)} />
      ) : (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <Empty>not stitched yet — press “stitch selected takes” to build the {data.range.from} → {data.range.to} cut.</Empty>
        </div>
      )}

      {out && out.kind !== "scored" && music.length > 0 && (
        <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          <span className="flex items-center justify-center gap-1.5">
            <Music size={13} /> {music.length} background-music cues ready — press <strong className="text-foreground">add background music</strong> to render a scored version (it becomes the new latest version).
          </span>
        </div>
      )}

      <CutHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} history={history} bump={bump} navigateTo={navigateTo} />

      <Panel title={`Stitch order (${usable.length} scenes)`}>
        <ol className="space-y-1.5">
          {segs.map((s) => (
            <li
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                s.missing && "border-destructive/30 bg-destructive/5",
                s.fallback && "border-warning/30 bg-warning/5"
              )}
            >
              <Badge variant="secondary" className="font-mono">{s.id}</Badge>
              {s.missing ? (
                <Empty>no rendered take</Empty>
              ) : (
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    {s.name}
                    {s.fallback ? (
                      <Badge variant="warning"><TriangleAlert size={11} /> no take selected — using first</Badge>
                    ) : (
                      <Badge variant="success"><Check size={11} /> selected</Badge>
                    )}
                    {s.musicCue && (
                      <Badge variant="info" title="background music cue over this scene">
                        <Music size={11} /> {s.musicCue.label}
                      </Badge>
                    )}
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {fmtTime(s.start)} → {fmtTime(s.end)}
                    <em className="not-italic"> ({s.duration.toFixed(1)}s)</em>
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

// Loader: the complete-cut manifest (segments, music, render history, output).
export function loader() {
  return swr("cuts", async () => {
    const res = await fetch("/api/episode/cuts");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export { CompleteCuts };

// Route entry. The Complete-cuts overlay still calls navigateTo({ view, anchor })
// to jump to a bundle / sound card; we adapt that to React Router hash navigation
// (/episode#ep-<id>, /sounds#snd-<track>). RootLayout's anchor hook does the
// scroll + flash once the target tab has loaded.
export function Component() {
  const navigate = useNavigate();
  const navigateTo = useCallback(
    ({ view, anchor }) => navigate(`/${view}${anchor ? `#${anchor}` : ""}`),
    [navigate],
  );
  return <CompleteCuts navigateTo={navigateTo} />;
}
