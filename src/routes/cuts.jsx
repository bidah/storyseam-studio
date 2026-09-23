import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Play, RefreshCw, ExternalLink, TriangleAlert, Music, Download, Clapperboard, Loader2, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useT, t as _t } from "@/lib/i18n";
import { useAgent, agentIsBusy, stitchCutMessage, scoreCutMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useNavigate, useLoaderData } from "react-router";
import { Empty, Panel, ErrorNote, fmtTime } from "@/components/shared";
import { toPreviewSrc } from "@/lib/previewSrc";

// A stitched-cut <video> with a live "now playing" overlay. As the cut plays,
// the top-right chips track which multishot bundle (and, for a scored cut, which
// background-music cue) the current frame comes from — using the from→to
// timecodes the server computed for each segment. Clicking a chip jumps to that
// card in the Episode / Sound-studio tab (see App's navigateTo).
function NowPlayingCut({ src, segs, music, withMusic, navigateTo }) {
  const t = useT();
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const usable = useMemo(() => (segs || []).filter((s) => s.file), [segs]);
  const seg =
    usable.find((s) => currentTime >= s.start && currentTime < s.end) ||
    (usable.length ? usable[currentTime > 0 ? usable.length - 1 : 0] : null);
  const cue = withMusic ? (music || []).find((m) => currentTime >= m.start && currentTime < m.beatEnd) : null;

  const chip =
    "pointer-events-auto flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 " +
    "text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/85";

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
    "border border-white/15 bg-black/85 px-2 py-1 text-[11px] font-medium text-white " +
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
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
        >
          <source src={src} type="video/mp4" />
        </video>

        <div className="pointer-events-none absolute right-2 top-2 flex max-w-[75%] flex-col items-end gap-1.5">
          {seg && (
            <button
              type="button"
              className={chip}
              onClick={() => navigateTo({ view: "episode", anchor: `ep-${seg.id}` })}
              title={t("Jump to {id} in the Episode tab", { id: seg.id })}
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
              title={t('Jump to "{label}" in the Sound studio', { label: cue.name || cue.label })}
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
            aria-label={t("cut timeline — click to seek")}
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(currentTime)}
          >
            {/* track */}
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-none bg-muted" />
            {/* progress fill */}
            <div
              className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-none bg-primary/50"
              style={{ width: `${Math.min(1, Math.max(0, currentTime / dur)) * 100}%` }}
            />
            {/* playhead */}
            <div
              className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-none bg-primary"
              style={{ left: `${Math.min(1, Math.max(0, currentTime / dur)) * 100}%` }}
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
                        ? t("{id} {name} — seek to scene", { id: mk.seg.id, name: mk.seg.name || "" })
                        : t("{label} — seek to cue", { label: mk.cue.label })
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      seek(mk.seekTo);
                    }}
                    className={cn(
                      /* rounded-full kept: a 10px marker dot is a circle. */
                      "block h-2.5 w-2.5 rounded-full border border-black/40 transition-transform hover:scale-125",
                      isShot ? "bg-primary" : "bg-muted-foreground",
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
                        title={t("Jump to {id} in the Episode tab", { id: mk.seg.id })}
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
                        title={t('Jump to "{label}" in the Sound studio', { label: mk.cue.name || mk.cue.label })}
                      >
                        <Music size={12} className="shrink-0 text-muted-foreground" />
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
  const t = useT();
  const scored = gen.kind === "scored";
  const when = gen.at ? new Date(gen.at).toLocaleString() : null;
  const scenes = (gen.segments || []).filter((s) => s.file).length;
  const src = `${gen.url}?v=${bump}`;
  // Preview the 720p proxy (huge for the app's largest file — the full cut).
  // A fresh stitch plays immediately via the /proxy fallback (original, short
  // TTL) and silently upgrades once the proxy lands. The download link keeps the
  // original full-res src.
  const previewSrc = `${toPreviewSrc(gen.url)}?v=${bump}`;
  return (
    <Panel
      className={latest ? "border-primary/40" : undefined}
      title={
        <span className="flex items-center gap-2">
          {scored ? <Music size={15} className="text-primary" /> : <Play size={15} className="text-primary" fill="currentColor" />}
          <span className="font-mono">v{gen.v}</span>
          <span className="text-muted-foreground">·</span>
          {scored ? t("with background music") : t("stitched — no music")}
        </span>
      }
      meta={
        <div className="flex items-center gap-1.5">
          {latest && <Badge variant="info">{t("latest")}</Badge>}
          {scored
            ? <Badge variant="success">{Math.abs(gen.gainDb ?? -22)} {t("dB bed")} · {gen.music?.length || 0} {t("cues")}</Badge>
            : <Badge variant="outline">{scenes} {t("scenes")} · {fmtTime(gen.totalDuration)}</Badge>}
        </div>
      }
    >
      <div className="space-y-3">
        <NowPlayingCut
          src={previewSrc}
          segs={gen.segments || []}
          music={gen.music || []}
          withMusic={scored}
          navigateTo={navigateTo}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {gen.range?.from} → {gen.range?.to}
            {scored
              ? <> · {gen.music?.length || 0} {t("cues")} ~{Math.abs(gen.gainDb ?? -22)} {t("dB under dialogue & SFX")}{when && <> · {t("mixed")} {when}</>}</>
              : <>{when && <> · {t("stitched")} {when}</>}</>}
          </span>
          <a
            className="inline-flex items-center gap-1 text-primary hover:underline"
            href={src} target="_blank" rel="noreferrer" download
          >
            <Download size={13} /> {t("download mp4")} <ExternalLink size={12} />
          </a>
        </div>
        {latest && !compact && olderCount > 0 && (
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <History size={12} /> {olderCount} {t("older version")}{olderCount === 1 ? "" : "s"} {t("in history")}
          </button>
        )}
      </div>
    </Panel>
  );
}

// Modal archive of every complete-cut generation, newest first. Each keeps its
// own preserved setup (takes, timecodes, music cues) so you can A/B any version.
function CutHistoryDialog({ open, onOpenChange, history, bump, navigateTo }) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[495px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <SheetHeader className="border-b pr-14">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <History size={16} /> {t("Complete-cut history")}
            <Badge variant="secondary">{history.length} {t("version")}{history.length === 1 ? "" : "s"}</Badge>
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {history.length === 0 ? (
            <Empty>{t("no versions rendered yet.")}</Empty>
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
  const t = useT();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const data = useLoaderData();
  useRevalidateOnMount("cuts");
  const [error, setError] = useState(null); // stitch/score/trim (mutation) errors
  const [bump, setBump] = useState(0);      // media cache-bust for the cut <video>
  const [historyOpen, setHistoryOpen] = useState(false);

  // Re-read the cut when the agent finishes a turn (it may have just run
  // stitch_cuts / score_cut). Edge-triggered inside the hook — an earlier
  // level-triggered version ran on the steady "ready" state, so every app-wide
  // revalidation (the SSE firehose, Refresh, project switch) re-ran it and
  // bumped the media nonce, remounting the <video> and snapping playback back
  // to 0. Cache-busting now lives in its own effect below, gated on the cut
  // actually changing.
  useRevalidateOnAgentIdle("cuts", agent.status);

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
          <h2 className="text-xl font-semibold tracking-tight">{t("Complete cut")} · {data.range.from} → {data.range.to}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setHistoryOpen(true)} disabled={history.length === 0} title={history.length === 0 ? t("no versions yet") : t("{n} version(s) rendered", { n: history.length })}>
              <History size={13} /> {t("history")}{history.length > 0 && <Badge variant="secondary" className="ml-1">{history.length}</Badge>}
            </Button>
            <Button onClick={stitch} disabled={agentBusy || usable.length === 0} title={agentBusy ? t("agent is busy — finishing the current turn") : usable.length === 0 ? t("no rendered takes to stitch") : t("asks the agent to (re)build the complete cut as a new version")}>
              {agentBusy ? <><Loader2 size={13} className="animate-spin" /> {t("agent working…")}</> : out ? <><RefreshCw size={13} /> {t("re-stitch")}</> : <><Play size={13} fill="currentColor" /> {t("stitch selected takes")}</>}
            </Button>
            <Button variant="outline" onClick={score} disabled={agentBusy || !out || music.length === 0} title={agentBusy ? t("agent is busy — finishing the current turn") : !out ? t("stitch the cut first") : music.length === 0 ? t("no rendered music cues") : t("mix the background music under the cut as a new version")}>
              {agentBusy ? <><Loader2 size={13} className="animate-spin" /> {t("agent working…")}</> : <><Music size={13} /> {history.some((g) => g.kind === "scored") ? t("add music version") : t("add background music")}</>}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{usable.length} {t("scenes")}</Badge>
          <Badge variant="success">~{fmtTime(total)} {t("total")}</Badge>
          {fallbacks.length > 0 && <Badge variant="warning">{fallbacks.length} {t("fallback (no take selected)")}</Badge>}
          {missing.length > 0 && <Badge variant="warning">{missing.length} {t("missing")}</Badge>}
          <span className="flex items-center gap-1">{t("concatenates the")} <Check size={11} /> {t("selected take of each scene, in order, into one mp4")}</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {out ? (
        <CutVersionCard gen={out} bump={bump} navigateTo={navigateTo} latest olderCount={olderCount} onOpenHistory={() => setHistoryOpen(true)} />
      ) : (
        <div className="rounded-none border border-dashed p-6 text-center">
          <Empty>{t("not stitched yet — press")} “{t("stitch selected takes")}” {t("to build the {from} → {to} cut", { from: data.range.from, to: data.range.to })}</Empty>
        </div>
      )}

      {out && out.kind !== "scored" && music.length > 0 && (
        <div className="rounded-none border border-dashed p-4 text-center text-sm text-muted-foreground">
          <span className="flex items-center justify-center gap-1.5">
            <Music size={13} /> {music.length} {t("background-music cues ready — press")} <strong className="text-foreground">{t("add background music")}</strong> {t("to render a scored version (it becomes the new latest version)")}.
          </span>
        </div>
      )}

      <CutHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} history={history} bump={bump} navigateTo={navigateTo} />

      <Panel title={`${t("Stitch order")} (${usable.length} ${t("scenes")})`}>
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
                <Empty>{t("no rendered take")}</Empty>
              ) : (
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    {s.name}
                    {s.fallback ? (
                      <Badge variant="warning"><TriangleAlert size={11} /> {t("no take selected — using first")}</Badge>
                    ) : (
                      <Badge variant="success"><Check size={11} /> {t("selected")}</Badge>
                    )}
                    {s.musicCue && (
                      <Badge variant="info" title={t("background music cue over this scene")}>
                        <Music size={11} /> {s.musicCue.label}
                      </Badge>
                    )}
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {fmtTime(s.start)} → {fmtTime(s.end)}
                    <em className="not-italic"> ({s.duration.toFixed(1)}{t("s")})</em>
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
    if (!res.ok) throw new Error(json.error || _t("Failed to load"));
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
