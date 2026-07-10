import { useState, useEffect } from "react";
import { useLoaderData } from "react-router";
import { ChevronLeft, ChevronRight, Volume2, VolumeX, Speech, RefreshCw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Empty, Eyebrow, Panel, ImageModal } from "@/components/shared";
import { useShell } from "@/lib/shellContext";

/* ---------------------------------------------------------------- *
 * MultiShot experiment — generation slideshow + summaries          *
 * ---------------------------------------------------------------- */

function GenerationSlideshow({ generations, reloadKey }) {
  const list = Array.isArray(generations) ? generations : [];
  const [i, setI] = useState(0);
  useEffect(() => {
    setI((cur) => Math.min(cur, Math.max(0, list.length - 1)));
  }, [list.length]);

  if (list.length === 0) {
    return (
      <Panel title="Generations">
        <Empty>
          no generations yet — submit the Seedance multishot job, then{" "}
          <RefreshCw size={12} className="inline" /> Refresh
        </Empty>
      </Panel>
    );
  }

  const g = list[Math.min(i, list.length - 1)];
  const prev = () => setI((c) => (c - 1 + list.length) % list.length);
  const next = () => setI((c) => (c + 1) % list.length);
  const params = g.params || {};

  return (
    <Panel
      title="Generations"
      meta={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={prev} disabled={list.length < 2} aria-label="Previous">
            <ChevronLeft size={16} />
          </Button>
          <div className="flex items-center gap-1.5">
            {list.map((gen, idx) => (
              <button
                key={gen.id || idx}
                className={cn(
                  "size-2 rounded-full transition-colors",
                  idx === i ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/60"
                )}
                onClick={() => setI(idx)}
                title={gen.label || `Take ${idx + 1}`}
                aria-label={gen.label || `Take ${idx + 1}`}
              />
            ))}
          </div>
          <Button variant="outline" size="icon-sm" onClick={next} disabled={list.length < 2} aria-label="Next">
            <ChevronRight size={16} />
          </Button>
          <span className="ml-1 text-xs tabular-nums text-muted-foreground">
            {i + 1} / {list.length}
          </span>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">{g.label || `Take ${i + 1}`}</strong>
            <Badge variant={g.hasAudio ? "success" : "muted"}>
              {g.hasAudio ? <><Volume2 size={12} /> has audio</> : <><VolumeX size={12} /> silent</>}
            </Badge>
            {g.createdAt && <span className="text-xs text-muted-foreground">{g.createdAt}</span>}
          </div>
          {g.videoUrl ? (
            <video key={`${g.videoUrl}?v=${reloadKey}-${i}`} controls preload="metadata" className="rounded-lg bg-black">
              <source src={`${g.videoUrl}?v=${reloadKey}`} type="video/mp4" />
            </video>
          ) : (
            <Empty>video file missing</Empty>
          )}
          {g.resultUrl && (
            <a
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              href={g.resultUrl}
              target="_blank"
              rel="noreferrer"
            >
              result URL <ExternalLink size={12} />
            </a>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <Eyebrow className="mb-1.5">Params</Eyebrow>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {Object.entries(params).map(([k, v]) => (
                <div className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1" key={k}>
                  <span className="text-muted-foreground">{k}</span>
                  <span
                    className={cn(
                      "font-medium",
                      k === "generate_audio" && (v ? "text-primary" : "text-destructive")
                    )}
                  >
                    {String(v)}
                  </span>
                </div>
              ))}
              {g.id && (
                <div className="col-span-2 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                  <span className="text-muted-foreground">job id</span>
                  <span className="truncate font-mono text-[11px]">{g.id}</span>
                </div>
              )}
            </div>
          </div>

          {Array.isArray(g.mediaInputs) && g.mediaInputs.length > 0 && (
            <div>
              <Eyebrow className="mb-1.5">Media inputs</Eyebrow>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {g.mediaInputs.map((m, idx) => (
                  <li key={idx} className="truncate font-mono">{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <Eyebrow className="mb-1.5">Prompt</Eyebrow>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2.5 font-mono text-[11px] leading-relaxed">
              {g.prompt}
            </pre>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function MultiShot({ reloadKey }) {
  const data = useLoaderData(); // the multishot experiment, or null if none
  useRevalidateOnMount("multishot");
  const [modalImage, setModalImage] = useState(null);

  if (!data) return <Empty>No multishot experiment found.</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{data.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="success">
            {(data.generations || []).length} generation
            {(data.generations || []).length === 1 ? "" : "s"}
          </Badge>
          <span>{data.model}</span>
          <Separator orientation="vertical" className="!h-3" />
          <span>{data.submittedVia}</span>
        </div>
      </div>

      <GenerationSlideshow generations={data.generations} reloadKey={reloadKey} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={`Shots used (${data.shots.length})`}>
          <ol className="space-y-3">
            {data.shots.map((s) => (
              <li key={s.id} className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary" className="font-mono">shot{s.id}</Badge>
                  <span className="text-muted-foreground">{s.time}</span>
                  <span className="text-muted-foreground">{s.camera}</span>
                </div>
                <div className="text-sm">{s.summary}</div>
                <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Speech size={13} className="mt-0.5 shrink-0" /> {s.dialogue}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title={`Images used (${data.images.length})`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.images.map((im) => (
              <figure key={im.file} className="space-y-1">
                <button
                  type="button"
                  className="block w-full overflow-hidden rounded-lg border bg-muted transition-transform hover:scale-[1.02]"
                  onClick={() => setModalImage({ ...im, url: `${im.url}?v=${reloadKey}` })}
                  title="Click to view full image"
                >
                  <img src={`${im.url}?v=${reloadKey}`} alt={im.name} className="aspect-square w-full object-cover" />
                </button>
                <figcaption className="truncate text-[11px] text-muted-foreground">
                  <span className="mr-1 font-medium text-primary">{im.role}</span>
                  {im.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </Panel>

        <Panel title={`Audio used (${data.audio.length})`}>
          <ul className="space-y-3">
            {data.audio.map((a) => (
              <li key={a.file} className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="secondary">{a.role}</Badge>
                  <span className="truncate text-muted-foreground">{a.name}</span>
                </div>
                <audio controls preload="none" src={`${a.url}?v=${reloadKey}`} />
                {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
    </div>
  );
}

// Loader: the multishot experiment (or null if none). reloadKey still flows from
// the shell for the <video>/<img>/<audio> cache-bust (?v=).
export function loader() {
  return swr("multishot", async () => {
    const res = await fetch("/api/multishot");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json.multishot ?? null;
  });
}

export { MultiShot };

export function Component() {
  const { reloadKey } = useShell();
  return <MultiShot reloadKey={reloadKey} />;
}
