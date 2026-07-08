import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, Check, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  RotateCcw, Maximize2, Volume2, VolumeX, Speech, Star, Play, RefreshCw,
  Copy, Pencil, ExternalLink, Leaf, Sparkles, TriangleAlert, Circle,
  Heart, Music, Save, Clock, Download, Trash2,
  PenLine, FileText, Image as ImageIcon, Clapperboard, Sun, Moon,
  Loader2, Wand2, LogOut, User,
} from "lucide-react";

import { Glowing } from "glowing";

import { cn } from "@/lib/utils";
import { CLIENT_ID } from "@/lib/clientId";
import AgentChat from "@/components/AgentChat";
import LoginGate from "@/components/Login";
import ScriptEditor from "@/components/ScriptEditor";
import {
  AgentProvider, useAgent, agentIsBusy, renderSoundMessage, renderAllPendingMessage,
  renderEpisodeMessage,
} from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ---------------------------------------------------------------- *
 * Small shared building blocks                                     *
 * ---------------------------------------------------------------- */

// Muted, italic empty / "not yet" state.
function Empty({ children, className }) {
  return (
    <span className={cn("text-sm italic text-muted-foreground", className)}>
      {children}
    </span>
  );
}

// Uppercase eyebrow / section label.
function Eyebrow({ children, className }) {
  return (
    <div className={cn("text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", className)}>
      {children}
    </div>
  );
}

// Toggle chip (moods, restrictions, …).
function Chip({ on, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        on
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Section card with a title row.
function Panel({ id, title, meta, className, bodyClassName, children }) {
  return (
    <Card id={id} className={cn("gap-0 overflow-hidden py-0", className)}>
      {(title || meta) && (
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3 [.border-b]:pb-3">
          {title && <CardTitle className="text-sm font-semibold">{title}</CardTitle>}
          {meta}
        </CardHeader>
      )}
      <CardContent className={cn("p-4", bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

function ErrorNote({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Editable text cell (Seedance shot / seed-audio block)            *
 * ---------------------------------------------------------------- */

function EditableCell({ shotId, kind, initialText, found, segmentTag, segmentLabel }) {
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [status, setStatus] = useState(null); // "saving" | "ok" | error string
  const dirty = text !== saved;

  useEffect(() => {
    setText(initialText);
    setSaved(initialText);
  }, [initialText]);

  const onSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch(`/api/shots/${shotId}/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(text);
      setStatus("ok");
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      setStatus(String(e.message || e));
    }
  }, [shotId, kind, text]);

  if (!found && !initialText) {
    return <Empty>no matching block in source file</Empty>;
  }

  return (
    <div className="space-y-2">
      {segmentLabel ? (
        <div
          className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-500"
          title="Shared segment context (not editable here)"
        >
          {segmentLabel}
        </div>
      ) : (
        segmentTag != null && <Badge variant="muted">SEGMENT {segmentTag}</Badge>
      )}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[220px] resize-y font-mono text-xs leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onSave} disabled={!dirty || status === "saving"}>
          {status === "saving" ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : <><Save size={13} /> Save</>}
        </Button>
        {dirty && (
          <span className="flex items-center gap-1 text-xs text-amber-500">
            <Circle size={8} fill="currentColor" /> unsaved
          </span>
        )}
        {status === "ok" && (
          <span className="flex items-center gap-1 text-xs text-primary">
            <Check size={13} /> written to file
          </span>
        )}
        {status && status !== "ok" && status !== "saving" && (
          <span className="text-xs text-destructive">{status}</span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Media takes (audio / video) with a take scrubber                 *
 * ---------------------------------------------------------------- */

function MediaTakes({ kind, takes, reloadKey }) {
  const list = Array.isArray(takes) ? takes : [];
  const [i, setI] = useState(0); // index 0 = latest
  useEffect(() => setI(0), [reloadKey, list.length]);

  if (list.length === 0) {
    return <Empty>not generated yet</Empty>;
  }
  const takesArr = list;
  const t = takesArr[Math.min(i, takesArr.length - 1)];
  const src = `${t.url}?v=${reloadKey}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground" title={t.title}>
        {i === 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <Star size={11} fill="currentColor" /> LATEST ·
          </span>
        )}
        <span className="truncate">{t.title}</span>
      </div>
      {kind === "audio" ? (
        <audio key={src} controls preload="none">
          <source src={src} type="audio/mpeg" />
        </audio>
      ) : (
        <video key={src} controls preload="metadata" className="bg-black">
          <source src={src} type="video/mp4" />
        </video>
      )}
      {takesArr.length > 1 && (
        <div className="flex items-center gap-2.5">
          <Slider
            className="flex-1"
            min={0}
            max={takesArr.length - 1}
            step={1}
            value={[takesArr.length - 1 - i]}
            onValueChange={([v]) => setI(takesArr.length - 1 - v)}
            aria-label="Select take"
          />
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            take {t.take}
            {t.variant && t.variant !== "final" ? ` · ${t.variant}` : ""} ·{" "}
            {takesArr.length - i}/{takesArr.length}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Full-size image viewer                                           *
 * ---------------------------------------------------------------- */

function ImageModal({ image, onClose }) {
  return (
    <Dialog open={!!image} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-[96vw]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{image?.name || "Image"}</DialogTitle>
        </DialogHeader>
        {image && (
          <>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
              <img
                src={image.url}
                alt={image.name}
                className="h-full w-full object-contain"
              />
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3 text-sm">
              <Badge variant="secondary" className="uppercase">{image.role}</Badge>
              <span className="truncate text-muted-foreground">{image.name}</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalImage, setModalImage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/multishot");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json.multishot);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (loading) return <Spinner label="loading multishot…" />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
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

/* ---------------------------------------------------------------- *
 * Reference-label + copy helpers                                   *
 * ---------------------------------------------------------------- */

function refLabel(rel) {
  const base = rel.split("/").pop().toLowerCase();
  const night = base.includes("night");
  const t = (n) => (night ? `${n} (night)` : n);
  if (base.includes("kids")) return "Elf kids";
  if (base.includes("king") && base.includes("house")) return "King's house";
  if (base.includes("king")) return t("Forest King");
  if (base.includes("sara")) return t("Sara");
  if (base.includes("helena")) return t("Helena");
  if (base.includes("mote") || base.includes("glow")) return t("Mote");
  if (base.includes("deep") && base.includes("forest")) return t("deep wood");
  if (base.includes("school")) return "school";
  if (base.includes("classroom")) return "classroom";
  if (base.includes("forest")) return t("forest");
  return base.replace(/\.[a-z0-9]+$/, "");
}

function CopyButton({ text, label = "copy prompt" }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <Button variant={copied ? "secondary" : "outline"} size="sm" onClick={onCopy}>
      {copied ? <><Check size={13} /> copied</> : <><Copy size={13} /> {label}</>}
    </Button>
  );
}

/* ---------------------------------------------------------------- *
 * Confirm dialog                                                   *
 * ---------------------------------------------------------------- */

function ConfirmModal({ open, title, message, confirmLabel = "Remove", onConfirm, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Revision signing                                                 *
 * ---------------------------------------------------------------- */

const SIGN_SECTIONS = [
  { key: "images", label: "Images", hint: "all references needed for the prompt are assigned", Icon: ImageIcon },
  { key: "prompt", label: "Prompt", hint: "the skill prompt is final", Icon: FileText },
  { key: "audio", label: "Audio", hint: "the voice / sound references are correct", Icon: Volume2 },
];

function SigningModal({ bundle, signoff, open, onSign, onClose }) {
  const [signedBy, setSignedBy] = useState(() => {
    try { return localStorage.getItem("shotStudioSigner") || ""; } catch { return ""; }
  });
  const so = signoff || { images: null, prompt: null, audio: null };
  const name = signedBy.trim();
  const toggle = (section, signed) => {
    if (signed) {
      if (!name) return;
      try { localStorage.setItem("shotStudioSigner", name); } catch { /* ignore */ }
    }
    onSign(bundle.id, section, signed, name);
  };
  const fmt = (at) => { try { return new Date(at).toLocaleString(); } catch { return at; } };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine size={16} /> Revision signing
            <Badge variant="secondary" className="font-mono">{bundle.id}</Badge>
            <span className="font-normal text-muted-foreground">{bundle.beatTitle}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="signed-by">Signed by</Label>
          <Input
            id="signed-by"
            value={signedBy}
            placeholder="your name"
            onChange={(e) => setSignedBy(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          {SIGN_SECTIONS.map(({ key, label, hint, Icon }) => {
            const sig = so[key];
            const on = !!sig;
            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                  on ? "border-primary/30 bg-primary/5" : "border-border"
                )}
              >
                <Checkbox
                  checked={on}
                  disabled={!on && !name}
                  onCheckedChange={(c) => toggle(key, !!c)}
                  aria-label={on ? `unsign ${label}` : `sign ${label}`}
                  className="size-5"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon size={13} /> {label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {on ? `signed by ${sig.by} · ${fmt(sig.at)}` : hint}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Reference thumbnails + pickers                                   *
 * ---------------------------------------------------------------- */

function SqItem({ im, on, bundleId, onAdd, onRemove, onView }) {
  return (
    <figure
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted transition-colors",
        on ? "border-primary ring-1 ring-primary/40" : "border-border"
      )}
    >
      <button className="block w-full" onClick={() => onView({ url: im.url, name: im.rel, role: "reference" })}>
        <img src={im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
      </button>
      {on ? (
        <Button
          variant="destructive" size="icon-xs"
          className="absolute right-1.5 top-1.5 rounded-full opacity-90"
          title="remove from this shot" aria-label="remove from this shot"
          onClick={() => onRemove(bundleId, im)}
        >
          <X size={13} />
        </Button>
      ) : (
        <Button
          size="icon-xs"
          className="absolute right-1.5 top-1.5 rounded-full opacity-90"
          title="use in this shot" aria-label="use in this shot"
          onClick={() => onAdd(bundleId, im)}
        >
          <Plus size={14} />
        </Button>
      )}
      <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">{im.name}</figcaption>
    </figure>
  );
}

function RefPickerModal({ bundle, folders, picked, flat, open, onAdd, onRemove, onView, onClose }) {
  const [active, setActive] = useState(null);
  const selected = [...picked].map((rel) => flat.get(rel)).filter(Boolean);
  const af = active && folders.find((f) => f.folder === active);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[min(94vw,1000px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            References
            <Badge variant="secondary" className="font-mono">{bundle.id}</Badge>
            <span className="font-normal text-muted-foreground">{bundle.beatTitle}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div>
            <Eyebrow className="mb-2">selected for this shot ({selected.length})</Eyebrow>
            {selected.length === 0 ? (
              <Empty>none yet — pick from your library selections below</Empty>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {selected.map((im) => (
                  <SqItem key={im.rel} im={im} on bundleId={bundle.id} onAdd={onAdd} onRemove={onRemove} onView={onView} />
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div>
            {folders.length === 0 ? (
              <Empty>no images pre-selected yet — go to the library tab and select some first.</Empty>
            ) : af ? (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => setActive(null)}>
                    <ChevronLeft size={14} /> folders
                  </Button>
                  <h4 className="text-sm font-semibold">{af.folder}</h4>
                  <Badge variant="secondary">{af.images.length} selected here</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                  {af.images.map((im) => (
                    <SqItem
                      key={im.rel}
                      im={im}
                      on={picked.has(im.rel)}
                      bundleId={bundle.id}
                      onAdd={onAdd}
                      onRemove={onRemove}
                      onView={onView}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {folders.map((f) => {
                  const inShot = f.images.filter((i) => picked.has(i.rel)).length;
                  return (
                    <button
                      key={f.folder}
                      className="group overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary/50"
                      onClick={() => setActive(f.folder)}
                    >
                      <div className="relative aspect-video bg-muted">
                        <img src={f.preview} loading="lazy" alt={f.folder} className="h-full w-full object-cover" />
                        {inShot > 0 && (
                          <Badge className="absolute right-1.5 top-1.5">{inShot} <Check size={11} /></Badge>
                        )}
                      </div>
                      <div className="p-2.5">
                        <div className="truncate text-sm font-medium">{f.folder}</div>
                        <div className="text-xs text-muted-foreground">{f.images.length} selected</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Rendered generations rail (per episode bundle)                   *
 * ---------------------------------------------------------------- */

function EpVideoRail({ bundleId, vids, reloadKey, onToggleVideo }) {
  // Prefer the selected take so a picked video is never hidden behind a later
  // unselected one; fall back to the last render when nothing is selected.
  const selFile = vids.find((v) => v.selected)?.file;
  const [i, setI] = useState(() => {
    const s = vids.findIndex((v) => v.selected);
    return s >= 0 ? s : vids.length - 1;
  });
  useEffect(() => {
    const s = vids.findIndex((v) => v.selected);
    setI(s >= 0 ? s : vids.length - 1);
  }, [selFile, vids.length]);
  const idx = Math.min(i, vids.length - 1);
  const g = vids[idx];
  const prev = () => setI((n) => (n - 1 + vids.length) % vids.length);
  const next = () => setI((n) => (n + 1) % vids.length);
  const selCount = vids.filter((v) => v.selected).length;
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <span className="truncate">{bundleId} · {g.name || `gen ${idx + 1}`}</span>
          {selCount > 0 && (
            <Badge variant="success" className="shrink-0">{selCount} <Check size={11} /> stitch</Badge>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="icon-xs" onClick={prev} disabled={vids.length < 2} aria-label="Previous"><ChevronLeft size={14} /></Button>
          <span className="text-xs tabular-nums text-muted-foreground">{idx + 1} / {vids.length}</span>
          <Button variant="outline" size="icon-xs" onClick={next} disabled={vids.length < 2} aria-label="Next"><ChevronRight size={14} /></Button>
        </div>
      </div>
      <div className={cn("relative overflow-hidden rounded-lg", g.selected && "ring-2 ring-primary")}>
        <video key={`${g.url}?v=${reloadKey}-${idx}`} controls preload="metadata" playsInline className="bg-black">
          <source src={`${g.url}?v=${reloadKey}`} type="video/mp4" />
        </video>
        <button
          className={cn(
            "absolute left-2 top-2 flex size-6 items-center justify-center rounded-full border-2 border-white/80 shadow transition-colors",
            g.selected ? "bg-primary text-primary-foreground" : "bg-black/50 text-transparent hover:bg-black/70"
          )}
          title={g.selected ? "selected for stitching — click to unselect" : "select this take for stitching"}
          onClick={() => onToggleVideo(bundleId, g.file, !g.selected)}
        >
          <Check size={14} />
        </button>
        {g.selected && (
          <Badge className="absolute right-2 top-2">selected</Badge>
        )}
      </div>
      {vids.length > 1 && (
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {vids.map((v, k) => (
            <button
              key={v.file || k}
              className={cn(
                "size-2 rounded-full transition-colors",
                k === idx ? "bg-primary" : v.selected ? "bg-primary/50" : "bg-muted-foreground/30 hover:bg-muted-foreground/60"
              )}
              onClick={() => setI(k)}
              title={`${v.name || `gen ${k + 1}`}${v.selected ? " — selected" : ""}`}
              aria-label={v.name || `gen ${k + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Prompt editor (restrictions, style, directives, per-shot)        *
 * ---------------------------------------------------------------- */

const RESTRICTIONS = [
  { key: "noMusic", label: "no background music", frag: "NO BACKGROUND MUSIC" },
  { key: "noVfx", label: "no visual effects & sounds", frag: "NO VISUAL EFFECTS AND NO SOUND EFFECTS" },
  { key: "justDialog", label: "just dialog", frag: "ONLY DIALOGUE — NO OTHER AUDIO" },
];

function restrictionsFromLine(line) {
  return {
    noMusic: /background music/i.test(line),
    noVfx: /visual effects/i.test(line),
    justDialog: /only dialogue|just dialog/i.test(line),
  };
}

function lineFromRestrictions(state) {
  const frags = RESTRICTIONS.filter((r) => state[r.key]).map((r) => r.frag);
  return frags.length ? frags.join(". ") + "." : "";
}

function parsePrompt(body) {
  const shotStart = body.search(/^SHOT \d+ \(/m);
  const head = (shotStart >= 0 ? body.slice(0, shotStart) : body).replace(/\s+$/, "");
  const shotsText = shotStart >= 0 ? body.slice(shotStart) : "";
  const shots = shotsText
    ? shotsText.split(/\n\n(?=SHOT \d+ \()/).map((s) => s.replace(/\s+$/, ""))
    : [];
  const lines = head.split("\n");
  const restrictionLine = lines[0] ?? "";
  const styleIdx = lines.findIndex((l) => /^STYLE:/i.test(l));
  const directives = (styleIdx >= 0 ? lines.slice(styleIdx + 1) : lines.slice(1)).join("\n").trim();
  return { restrictionLine, styleLine: styleIdx >= 0 ? lines[styleIdx] : "", directives, shots };
}

function serializePrompt({ restrictionLine, styleLine, directives, shots }) {
  const head = [restrictionLine, styleLine, directives].join("\n");
  return shots.length ? head + "\n\n" + shots.join("\n\n") : head;
}

function PromptModal({ bundle, body, fullPrefix, assigned, audioAssigned, edited, open, onView, onChange, onReset, onClose }) {
  const [sec, setSec] = useState(() => parsePrompt(body));
  const restr = useMemo(() => restrictionsFromLine(sec.restrictionLine), [sec.restrictionLine]);

  const push = useCallback(
    (next) => {
      setSec(next);
      onChange(serializePrompt(next));
    },
    [onChange]
  );
  const toggleRestriction = (key) =>
    push({ ...sec, restrictionLine: lineFromRestrictions({ ...restr, [key]: !restr[key] }) });
  const setField = (field, val) => push({ ...sec, [field]: val });
  const setShot = (i, val) => {
    const shots = sec.shots.slice();
    shots[i] = val;
    push({ ...sec, shots });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] min-w-[min(94vw,1800px)] max-w-[min(94vw,1800px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">{bundle.id}</Badge>
            <span className="font-normal">{bundle.beatTitle} — edit prompt</span>
            {edited ? (
              <Badge variant="warning"><Pencil size={11} /> edited</Badge>
            ) : (
              <Badge variant="success">live</Badge>
            )}
          </DialogTitle>
          <div className="flex items-center gap-2 pr-8">
            {edited && (
              <Button variant="outline" size="sm" onClick={onReset} title="discard edits, return to the auto-composed prompt">
                <RotateCcw size={13} /> reset to live
              </Button>
            )}
            <CopyButton text={fullPrefix + serializePrompt(sec)} />
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <section className="space-y-2">
            <Label>Audio / VFX restrictions</Label>
            <div className="flex flex-wrap gap-2">
              {RESTRICTIONS.map((r) => (
                <Chip key={r.key} on={restr[r.key]} onClick={() => toggleRestriction(r.key)}>
                  {restr[r.key] && <Check size={13} />}
                  {r.label}
                </Chip>
              ))}
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
              {sec.restrictionLine || "(no restrictions — Seedance may add music, VFX & sound)"}
            </div>
          </section>

          <section className="space-y-2">
            <Label className="flex items-center gap-2">
              References
              <span className="text-xs font-normal text-muted-foreground">
                managed with the pickers behind this modal · click a thumbnail to preview
              </span>
            </Label>
            {assigned.length === 0 && audioAssigned.length === 0 ? (
              <Empty>no references chosen</Empty>
            ) : (
              <div className="flex flex-wrap items-start gap-3">
                {assigned.map((im) => (
                  <figure key={im.rel} className="w-20 space-y-1">
                    <button
                      type="button"
                      className="block w-full overflow-hidden rounded-md border bg-muted"
                      onClick={() => onView({ url: im.url, name: im.rel, role: "reference" })}
                      title="click to view full image"
                    >
                      <img src={im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
                    </button>
                    <figcaption className="truncate text-center text-[11px] text-muted-foreground">{refLabel(im.rel)}</figcaption>
                  </figure>
                ))}
                {audioAssigned.map((a) => (
                  <Badge key={a.rel} variant="secondary" className="h-7"><Volume2 size={12} /> {a.label}</Badge>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <Label>Style</Label>
            <Textarea rows={6} className="font-mono text-xs" value={sec.styleLine} onChange={(e) => setField("styleLine", e.target.value)} />
          </section>

          <section className="space-y-2">
            <Label>Directives</Label>
            <Textarea rows={7} className="font-mono text-xs" value={sec.directives} onChange={(e) => setField("directives", e.target.value)} />
          </section>

          <section className="space-y-2">
            <Label>Shots ({sec.shots.length})</Label>
            <div className="space-y-3">
              {sec.shots.map((s, i) => (
                <div key={i} className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs font-semibold text-muted-foreground">Shot {i + 1}</div>
                  <Textarea rows={5} className="font-mono text-xs" value={s} onChange={(e) => setShot(i, e.target.value)} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Episode bundle card                                              *
 * ---------------------------------------------------------------- */

function EpisodeBundle({ b, flat, picked, onOpenPicker, onRemove, onView, audioMap, audioPicked, onOpenAudio, vids, reloadKey, onToggleVideo, override, onEditPrompt, onResetPrompt, signoff, onSign }) {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [renderErr, setRenderErr] = useState(null);
  const signedCount = signoff ? ["images", "prompt", "audio"].filter((k) => signoff[k]).length : 0;
  const fullySigned = signedCount === 3;
  const hasVid = Array.isArray(vids) && vids.length > 0;
  const edited = typeof override === "string";
  const assigned = [...picked].map((rel) => flat.get(rel)).filter(Boolean);
  const audioAssigned = [...audioPicked].map((rel) => audioMap.get(rel)).filter(Boolean);

  const refBlock = assigned.length
    ? "IMAGE REFERENCES (pass each file as an image_references entry):\n" +
      assigned.map((im) => `- ${refLabel(im.rel)}: ${im.abs || im.rel}`).join("\n")
    : "IMAGE REFERENCES: (none selected yet — use “choose references” above)";
  const audioBlock = audioAssigned.length
    ? "\n\nVOICE / SOUND REFERENCES (pass as the audio reference — voice identity, NOT dialogue):\n" +
      audioAssigned
        .map(
          (a) =>
            `- ${a.label}: ${a.abs || a.rel}` +
            (a.order && a.order.length > 1
              ? ` — voices appear in this order: ${a.order.map((n, i) => `${i + 1}=${n}`).join(", ")}`
              : "")
        )
        .join("\n")
    : "";
  const bodyPrompt = edited ? override : b.skillPrompt;
  const fullPrefix = refBlock + audioBlock + "\n\n";
  const displayPrompt = fullPrefix + bodyPrompt;

  // Drive the shared studio agent to render this bundle once its revision is
  // signed off (generate-multishot skill → Higgsfield → attach_episode_video) —
  // same as asking it in chat.
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const requestRender = async () => {
    setRenderErr(null);
    try {
      await agent.send({ message: renderEpisodeMessage(b, displayPrompt) });
    } catch (e) {
      setRenderErr(String(e.message || e));
    }
  };

  return (
    <Card id={`ep-${b.id}`} className="scroll-mt-24 gap-0 py-0">
      <CardHeader className="sticky top-[61px] z-10 flex flex-row flex-wrap items-center justify-between gap-3 rounded-t-xl border-b bg-card px-4 py-3 [.border-b]:pb-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono text-sm">{b.id}</Badge>
          <span className="font-semibold">{b.beatTitle}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{b.shots.length} shots</Badge>
          <Badge variant={b.durationEst > 15 ? "warning" : "muted"}>~{b.durationEst}s → {b.duration}s</Badge>
          {assigned.length > 0 && <Badge variant="success">{assigned.length} refs</Badge>}
          {hasVid && <Badge variant="success"><Play size={11} fill="currentColor" /> {vids.length} rendered</Badge>}
          {signedCount === 3 ? (
            <Badge variant="success"><Check size={11} /> signed</Badge>
          ) : signedCount > 0 ? (
            <Badge variant="warning">{signedCount}/3 signed</Badge>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setSignOpen(true)} title="revision signing">
            <PenLine size={13} /> revision signing
          </Button>
          <Button
            size="sm"
            onClick={requestRender}
            disabled={!fullySigned || agentBusy}
            title={
              !fullySigned
                ? "Sign off images, prompt, and audio before rendering"
                : agentBusy
                ? "Agent is busy — wait for the current turn to finish"
                : "Render this bundle with Seedance via the studio agent"
            }
          >
            {agentBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Render
          </Button>
          {renderErr && <span className="w-full text-xs text-destructive">{renderErr}</span>}
        </div>
      </CardHeader>

      <CardContent className={cn("grid gap-4 p-4", hasVid && "lg:grid-cols-[2fr_1fr]")}>
        <div className="min-w-0 space-y-4">
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide">scene needs:</span>{" "}
            {b.images.map((im) => im.key).join(" · ")}
          </div>

          <div className="space-y-3">
            {assigned.length === 0 ? (
              <Empty>no references chosen for this shot</Empty>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {assigned.map((im) => (
                  <figure key={im.rel} className="relative overflow-hidden rounded-lg border border-primary bg-muted ring-1 ring-primary/40">
                    <button className="block w-full" onClick={() => onView({ url: im.url, name: im.rel, role: "reference" })}>
                      <img src={im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
                    </button>
                    <Button
                      variant="destructive" size="icon-xs"
                      className="absolute right-1.5 top-1.5 rounded-full opacity-90"
                      title="remove from this shot" aria-label="remove from this shot"
                      onClick={() => onRemove(b.id, im)}
                    >
                      <X size={13} />
                    </Button>
                    <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">{im.name}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => onOpenPicker(b)}>
              <Plus size={14} /> choose references
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {audioAssigned.length === 0 ? (
              <Empty>no voice reference chosen</Empty>
            ) : (
              audioAssigned.map((a) => (
                <Badge key={a.rel} variant="secondary" className="h-7" title={a.rel}>
                  <Volume2 size={12} /> {a.label}
                  {a.order && a.order.length > 1 && (
                    <em className="ml-1 not-italic text-muted-foreground">({a.order.map((n, i) => `${i + 1}=${n}`).join(", ")})</em>
                  )}
                </Badge>
              ))
            )}
            <Button variant="outline" size="sm" onClick={() => onOpenAudio(b)}>
              <Volume2 size={14} /> choose audio references
            </Button>
          </div>

          <ol className="space-y-2">
            {b.shots.map((s) => (
              <li key={s.id} className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary" className="font-mono">{s.id}</Badge>
                  <span className="text-muted-foreground">{s.dur}s</span>
                  <span className="text-muted-foreground">{s.location}</span>
                  <span className="text-muted-foreground">{s.camera}</span>
                </div>
                <div className="text-sm">{s.summary}</div>
                {!/\(no dialogue\)/i.test(s.dialogue) && s.dialogue && (
                  <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Speech size={13} className="mt-0.5 shrink-0" /> {s.dialogue}
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                skill prompt — click to edit, auto-saves
                {edited ? (
                  <Badge variant="warning"><Pencil size={11} /> edited</Badge>
                ) : (
                  <Badge variant="success">live</Badge>
                )}
              </span>
              <div className="flex items-center gap-2">
                {edited && (
                  <Button variant="outline" size="sm" onClick={() => onResetPrompt(b.id)} title="discard edits, return to the auto-composed prompt">
                    <RotateCcw size={13} /> reset to live
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} title="open the full-screen prompt editor">
                  <Maximize2 size={13} /> edit
                </Button>
                <CopyButton text={displayPrompt} />
              </div>
            </div>
            <Textarea
              className={cn(
                "cursor-pointer resize-none font-mono text-xs leading-relaxed",
                open ? "[field-sizing:content] overflow-hidden" : "h-[400px] overflow-hidden [field-sizing:fixed]"
              )}
              value={displayPrompt}
              readOnly
              onClick={() => setModalOpen(true)}
              title="click to open the full-screen editor"
            />
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen((o) => !o)}>
              {open ? <><ChevronUp size={13} /> collapse</> : <><ChevronDown size={13} /> expand prompt</>}
            </Button>
          </div>
        </div>

        {hasVid && (
          <aside className="min-w-0 lg:sticky lg:top-[124px] lg:self-start">
            <EpVideoRail bundleId={b.id} vids={vids} reloadKey={reloadKey} onToggleVideo={onToggleVideo} />
          </aside>
        )}
      </CardContent>

      <PromptModal
        bundle={b}
        body={bodyPrompt}
        fullPrefix={fullPrefix}
        assigned={assigned}
        audioAssigned={audioAssigned}
        edited={edited}
        open={modalOpen}
        onView={onView}
        onChange={(text) => onEditPrompt(b.id, text)}
        onReset={() => { onResetPrompt(b.id); setModalOpen(false); }}
        onClose={() => setModalOpen(false)}
      />
      <SigningModal
        bundle={b}
        signoff={signoff}
        open={signOpen}
        onSign={onSign}
        onClose={() => setSignOpen(false)}
      />
    </Card>
  );
}

function AudioPickerModal({ bundle, audioRefs, picked, open, onToggle, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[min(94vw,640px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            Voice / sound references
            <Badge variant="secondary" className="font-mono">{bundle.id}</Badge>
            <span className="font-normal text-muted-foreground">{bundle.beatTitle}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {audioRefs.map((a) => {
            const on = picked.has(a.rel);
            return (
              <div
                key={a.rel}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                  on ? "border-primary/40 bg-primary/5" : "border-border"
                )}
              >
                <Button
                  variant={on ? "default" : "outline"} size="icon-sm"
                  className="mt-0.5 shrink-0 rounded-full"
                  title={on ? "remove from this shot" : "use in this shot"}
                  onClick={() => onToggle(bundle.id, a.rel, !on)}
                >
                  {on ? <Check size={14} /> : <Plus size={14} />}
                </Button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {a.label}
                    {!a.exists && <Badge variant="destructive">missing file</Badge>}
                  </div>
                  {a.order && a.order.length > 1 && (
                    <div className="text-xs text-muted-foreground">voice order: {a.order.map((n, i) => `${i + 1}=${n}`).join(", ")}</div>
                  )}
                  <audio controls preload="none" src={a.url} />
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Episode({ reloadKey, onView }) {
  const [data, setData] = useState(null);
  const [folders, setFolders] = useState([]);
  const [picks, setPicks] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [pickerBundle, setPickerBundle] = useState(null);
  const [audioRefs, setAudioRefs] = useState([]);
  const [audioPicks, setAudioPicks] = useState({});
  const [audioPicker, setAudioPicker] = useState(null);
  const [videos, setVideos] = useState({});
  const [prompts, setPrompts] = useState({});
  const [signoffs, setSignoffs] = useState({});
  const promptTimers = useRef({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch("/api/episode").then((r) => r.json()),
      fetch("/api/library").then((r) => r.json()),
      fetch("/api/final").then((r) => r.json()),
      fetch("/api/audio").then((r) => r.json()),
    ])
      .then(([ep, lib, fn, au]) => {
        if (!alive) return;
        if (ep.error) throw new Error(ep.error);
        setData(ep.episode);
        setVideos(ep.video || {});
        setPrompts(ep.prompts || {});
        setSignoffs(ep.signoffs || {});
        setFolders(lib.folders || []);
        const m = {};
        for (const [k, v] of Object.entries(fn.episode || {})) m[k] = new Set(v);
        setPicks(m);
        setAudioRefs(au.audio || []);
        const am = {};
        for (const [k, v] of Object.entries(au.episode || {})) am[k] = new Set(v);
        setAudioPicks(am);
      })
      .catch((e) => alive && setError(String(e.message || e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const audioMap = useMemo(() => {
    const m = new Map();
    for (const a of audioRefs) m.set(a.rel, a);
    return m;
  }, [audioRefs]);

  const onAudioToggle = useCallback(async (bundle, rel, selected) => {
    setAudioPicks((p) => {
      const s = new Set(p[bundle] || []);
      if (selected) s.add(rel);
      else s.delete(rel);
      return { ...p, [bundle]: s };
    });
    try {
      await fetch("/api/episode/audio-select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, rel, selected }),
      });
    } catch {
      /* keep optimistic state */
    }
  }, []);

  const flat = useMemo(() => {
    const m = new Map();
    for (const f of folders) for (const im of f.images) m.set(im.rel, im);
    return m;
  }, [folders]);

  const selFolders = useMemo(
    () =>
      folders
        .map((f) => {
          const imgs = f.images.filter((im) => im.selected);
          return { folder: f.folder, images: imgs, preview: imgs[0]?.url };
        })
        .filter((f) => f.images.length > 0),
    [folders]
  );
  const selCount = useMemo(() => [...flat.values()].filter((im) => im.selected).length, [flat]);

  const setPick = useCallback(async (bundle, rel, selected) => {
    setPicks((p) => {
      const s = new Set(p[bundle] || []);
      if (selected) s.add(rel);
      else s.delete(rel);
      return { ...p, [bundle]: s };
    });
    try {
      await fetch("/api/episode/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, rel, selected }),
      });
    } catch {
      /* keep optimistic state */
    }
  }, []);

  const onAdd = useCallback((bundle, im) => setPick(bundle, im.rel, true), [setPick]);
  const onRemove = useCallback((bundle, im) => setConfirm({ bundle, f: im }), []);

  const onToggleVideo = useCallback((bundle, file, selected) => {
    setVideos((vs) => {
      // Only one take per bundle can be selected — picking one clears the rest.
      const arr = (vs[bundle] || []).map((g) =>
        g.file === file ? { ...g, selected } : selected ? { ...g, selected: false } : g
      );
      return { ...vs, [bundle]: arr };
    });
    fetch("/api/episode/video-select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, file, selected }),
    }).catch(() => {});
  }, []);

  const onEditPrompt = useCallback((bundle, text) => {
    setPrompts((p) => ({ ...p, [bundle]: text }));
    clearTimeout(promptTimers.current[bundle]);
    promptTimers.current[bundle] = setTimeout(() => {
      fetch("/api/episode/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, text }),
      }).catch(() => {});
    }, 600);
  }, []);
  const onResetPrompt = useCallback((bundle) => {
    setPrompts((p) => {
      const n = { ...p };
      delete n[bundle];
      return n;
    });
    clearTimeout(promptTimers.current[bundle]);
    fetch("/api/episode/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, text: "" }),
    }).catch(() => {});
  }, []);

  const onSign = useCallback(async (bundle, section, signed, signedBy) => {
    try {
      const res = await fetch("/api/episode/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, section, signed, signedBy }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      setSignoffs((s) => ({ ...s, [bundle]: out.signoff }));
    } catch {
      /* leave prior state on failure */
    }
  }, []);

  const [assigning, setAssigning] = useState(false);
  const autoAssign = useCallback(async () => {
    setAssigning(true);
    try {
      const res = await fetch("/api/episode/auto-assign", { method: "POST" });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      const fn = await fetch("/api/final").then((r) => r.json());
      const m = {};
      for (const [k, v] of Object.entries(fn.episode || {})) m[k] = new Set(v);
      setPicks(m);
      const au = await fetch("/api/audio").then((r) => r.json());
      const am = {};
      for (const [k, v] of Object.entries(au.episode || {})) am[k] = new Set(v);
      setAudioPicks(am);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setAssigning(false);
    }
  }, []);

  if (loading) return <Spinner label="loading episode plan…" />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Empty>No episode plan found. Run episode-multishot/build.mjs.</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{data.title}</h2>
          <Button onClick={autoAssign} disabled={assigning || selCount === 0}>
            {assigning ? <><Loader2 size={14} className="animate-spin" /> assigning…</> : <><Sparkles size={14} /> auto-assign references</>}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{data.bundles.length} multishot bundles</Badge>
          <Badge variant="outline">{data.totalShots} shots total</Badge>
          <Badge variant="success">{selCount} library-selected refs</Badge>
          <span>auto-assign matches your library picks to each shot by character + location</span>
        </div>
      </div>

      <div className="space-y-4">
        {data.bundles.map((b) => (
          <EpisodeBundle
            key={b.id}
            b={b}
            flat={flat}
            picked={picks[b.id] || new Set()}
            onOpenPicker={setPickerBundle}
            onRemove={onRemove}
            onView={onView}
            audioMap={audioMap}
            audioPicked={audioPicks[b.id] || new Set()}
            onOpenAudio={setAudioPicker}
            vids={videos[b.id] || []}
            reloadKey={reloadKey}
            onToggleVideo={onToggleVideo}
            override={prompts[b.id]}
            onEditPrompt={onEditPrompt}
            onResetPrompt={onResetPrompt}
            signoff={signoffs[b.id]}
            onSign={onSign}
          />
        ))}
      </div>

      {audioPicker && (
        <AudioPickerModal
          bundle={audioPicker}
          audioRefs={audioRefs}
          picked={audioPicks[audioPicker.id] || new Set()}
          open={!!audioPicker}
          onToggle={onAudioToggle}
          onClose={() => setAudioPicker(null)}
        />
      )}

      {pickerBundle && (
        <RefPickerModal
          bundle={pickerBundle}
          folders={selFolders}
          picked={picks[pickerBundle.id] || new Set()}
          flat={flat}
          open={!!pickerBundle}
          onAdd={onAdd}
          onRemove={onRemove}
          onView={onView}
          onClose={() => setPickerBundle(null)}
        />
      )}

      <ConfirmModal
        open={!!confirm}
        title="Remove reference from this shot?"
        message={confirm ? `"${confirm.f.name}" will no longer be used to generate ${confirm.bundle}.` : ""}
        confirmLabel="Remove from shot"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setPick(confirm.bundle, confirm.f.rel, false);
          setConfirm(null);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Complete cuts (stitch selected takes)                            *
 * ---------------------------------------------------------------- */

function fmtTime(sec) {
  if (!sec && sec !== 0) return "—";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

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

function CompleteCuts({ reloadKey, navigateTo }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stitching, setStitching] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [bump, setBump] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/episode/cuts");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const stitch = useCallback(async () => {
    setStitching(true);
    setError(null);
    try {
      const res = await fetch("/api/episode/stitch", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Stitch failed");
      await load();
      setBump((b) => b + 1);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setStitching(false);
    }
  }, [load]);

  const score = useCallback(async () => {
    setScoring(true);
    setError(null);
    try {
      const res = await fetch("/api/episode/score", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Add music failed");
      await load();
      setBump((b) => b + 1);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setScoring(false);
    }
  }, [load]);

  if (loading) return <Spinner label="loading cuts…" />;
  if (!data) return <ErrorNote>{error}</ErrorNote>;

  const segs = data.segments || [];
  const usable = segs.filter((s) => s.file);
  const missing = segs.filter((s) => s.missing);
  const fallbacks = usable.filter((s) => s.fallback);
  const total = usable.reduce((a, s) => a + s.duration, 0);
  const out = data.output;
  const music = data.music || [];
  const scoredVersions = out?.scoredVersions || [];
  const scored = scoredVersions[0]; // newest
  // All generations (base stitch + each scored version) as one list, sorted by
  // creation time NEWEST-FIRST so the most-recently rendered is the top card.
  const generations = out
    ? [
        { key: "stitch", kind: "stitch", at: out.stitchedAt, url: out.url },
        ...scoredVersions.map((sv) => ({ key: `v${sv.v}`, kind: "scored", at: sv.createdAt, url: sv.url, sv })),
      ].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Complete cut · {data.range.from} → {data.range.to}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={stitch} disabled={stitching || usable.length === 0}>
              {stitching ? <><Loader2 size={13} className="animate-spin" /> stitching…</> : out ? <><RefreshCw size={13} /> re-stitch</> : <><Play size={13} fill="currentColor" /> stitch selected takes</>}
            </Button>
            <Button variant="outline" onClick={score} disabled={scoring || !out || music.length === 0} title={!out ? "stitch the cut first" : music.length === 0 ? "no rendered music cues" : "mix the background music under the cut"}>
              {scoring ? <><Loader2 size={13} className="animate-spin" /> mixing…</> : <><Music size={13} /> {scored ? "add music version" : "add background music"}</>}
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
        <div className="space-y-4">
          {/* One list of generations — the base stitched cut + each scored
              version — sorted NEWEST-FIRST, so the most recent render is the
              top card (tagged "newest"). */}
          {generations.map((g, idx) => {
            const newest = idx === 0;
            const cardClass = newest ? "border-primary/40" : undefined;
            if (g.kind === "stitch") {
              return (
                <Panel
                  key={g.key}
                  className={cardClass}
                  title={<span className="flex items-center gap-2"><Play size={15} className="text-primary" fill="currentColor" /> Stitched cut — no music</span>}
                  meta={
                    <div className="flex items-center gap-1.5">
                      {newest && <Badge variant="info">newest</Badge>}
                      <Badge variant="outline">{usable.length} scenes · {fmtTime(out.totalDuration ?? total)}</Badge>
                    </div>
                  }
                >
                  <div className="space-y-3">
                    <NowPlayingCut
                      src={`${out.url}?v=${bump}`}
                      segs={out.segments || segs}
                      music={music}
                      withMusic={false}
                      navigateTo={navigateTo}
                    />
                    <div className="text-sm text-muted-foreground">
                      {out.range?.from || data.range.from} → {out.range?.to || data.range.to}
                      {out.stitchedAt && <> · stitched {new Date(out.stitchedAt).toLocaleString()}</>}
                    </div>
                    <a
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      href={`${out.url}?v=${bump}`} target="_blank" rel="noreferrer" download
                    >
                      <Download size={13} /> download mp4 <ExternalLink size={12} />
                    </a>
                  </div>
                </Panel>
              );
            }
            const sv = g.sv;
            return (
              <Panel
                key={g.key}
                className={cardClass}
                title={<span className="flex items-center gap-2"><Music size={15} className="text-primary" /> Scored v{sv.v} — with background music</span>}
                meta={
                  <div className="flex items-center gap-1.5">
                    {newest && <Badge variant="info">newest</Badge>}
                    <Badge variant="success">{Math.abs(sv.gainDb ?? -14)} dB bed · {sv.music?.length || 0} cues</Badge>
                  </div>
                }
              >
                <div className="space-y-3">
                  <NowPlayingCut
                    src={`${sv.url}?v=${bump}`}
                    segs={sv.segments || out.segments || segs}
                    music={sv.music || music}
                    withMusic
                    navigateTo={navigateTo}
                  />
                  <div className="text-sm text-muted-foreground">
                    {sv.music?.length || 0} music cues ~{Math.abs(sv.gainDb ?? -14)} dB under the dialogue &amp; SFX
                    {sv.createdAt && <> · mixed {new Date(sv.createdAt).toLocaleString()}</>}
                  </div>
                  <a
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    href={`${sv.url}?v=${bump}`} target="_blank" rel="noreferrer" download
                  >
                    <Download size={13} /> download mp4 <ExternalLink size={12} />
                  </a>
                </div>
              </Panel>
            );
          })}

          {music.length > 0 && scoredVersions.length === 0 && (
            <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              <span className="flex items-center justify-center gap-1.5">
                <Music size={13} /> {music.length} background-music cues ready — press <strong className="text-foreground">add background music</strong> to render a scored version as the next card.
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <Empty>not stitched yet — press “stitch selected takes” to build the {data.range.from} → {data.range.to} cut.</Empty>
        </div>
      )}

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

/* ---------------------------------------------------------------- *
 * Asset library                                                    *
 * ---------------------------------------------------------------- */

function Library({ reloadKey, onView }) {
  const [folders, setFolders] = useState(null);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/library")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setFolders(j.folders);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const toggle = useCallback(async (im) => {
    try {
      const res = await fetch("/api/library/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel: im.rel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolders((fs) =>
        fs.map((f) => ({
          ...f,
          images: f.images.map((x) => (x.rel === im.rel ? { ...x, selected: data.selected } : x)),
        }))
      );
    } catch (e) {
      setError(String(e.message || e));
    }
  }, []);

  if (loading) return <Spinner label="loading library…" />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!folders) return null;

  const af = active && folders.find((f) => f.folder === active);

  if (af) {
    const selCount = af.images.filter((i) => i.selected).length;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setActive(null)}>
            <ChevronLeft size={14} /> all folders
          </Button>
          <h2 className="text-xl font-semibold tracking-tight">{af.folder}</h2>
          <Badge variant="outline">{af.count} images</Badge>
          {selCount > 0 && <Badge variant="success">{selCount} selected</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {af.images.map((im) => (
            <figure
              key={im.rel}
              className={cn(
                "group relative overflow-hidden rounded-lg border bg-muted transition-colors",
                im.selected ? "border-primary ring-1 ring-primary/40" : "border-border"
              )}
            >
              <button className="block w-full" onClick={() => onView({ url: im.url, name: im.rel, role: "asset" })}>
                <img src={im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
              </button>
              {im.selected ? (
                <Button
                  variant="destructive" size="icon-xs"
                  className="absolute right-1.5 top-1.5 rounded-full opacity-90"
                  title="remove from final_selection" aria-label="remove from final_selection"
                  onClick={() => setConfirm(im)}
                >
                  <X size={13} />
                </Button>
              ) : (
                <Button
                  size="icon-xs"
                  className="absolute right-1.5 top-1.5 rounded-full opacity-0 transition-opacity group-hover:opacity-90"
                  title="add to final_selection" aria-label="add to final_selection"
                  onClick={() => toggle(im)}
                >
                  <Plus size={14} />
                </Button>
              )}
              {im.selected && <Badge className="absolute left-1.5 top-1.5">selected</Badge>}
              <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">{im.name}</figcaption>
            </figure>
          ))}
        </div>

        <ConfirmModal
          open={!!confirm}
          title="Remove from selection?"
          message={confirm ? `"${confirm.name}" will be removed from final_selection (and any shots it was assigned to).` : ""}
          confirmLabel="Remove"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            toggle(confirm);
            setConfirm(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Asset library</h2>
        <Badge variant="outline">{folders.length} folders</Badge>
        <Badge variant="success">
          {folders.reduce((a, f) => a + f.images.filter((i) => i.selected).length, 0)} selected → final_selection
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {folders.map((f) => {
          const sel = f.images.filter((i) => i.selected).length;
          return (
            <button
              key={f.folder}
              className="group overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/50"
              onClick={() => setActive(f.folder)}
            >
              <div className="relative aspect-video bg-muted">
                <img src={f.preview} loading="lazy" alt={f.folder} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                {sel > 0 && <Badge className="absolute right-2 top-2">{sel} <Check size={11} /></Badge>}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium">{f.folder}</div>
                <div className="text-xs text-muted-foreground">{f.count} images</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Sound studio                                                     *
 * ---------------------------------------------------------------- */

async function soundApi(url, opts) {
  const res = await fetch(url, {
    headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function SoundVersion({ track, ver, onChanged }) {
  const [prompt, setPrompt] = useState(ver.prompt);
  const [vname, setVname] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setPrompt(ver.prompt);
  }, [ver.prompt, ver.v, track.id]);
  const dirty = prompt !== ver.prompt;

  // Drive the shared studio agent to actually render this pending version
  // (seed-audio skill → Higgsfield → attach_sound) — same as asking it in chat.
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const requestRender = async () => {
    setErr(null);
    try {
      await agent.send({ message: renderSoundMessage(track, ver) });
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  const run = async (fn) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveNewVersion = () =>
    run(async () => {
      await soundApi(`/api/sounds/${track.id}/version`, {
        method: "POST",
        body: JSON.stringify({ prompt, name: vname }),
      });
      setVname("");
    });
  const saveInPlace = () =>
    run(() =>
      soundApi(`/api/sounds/${track.id}/version/${ver.v}`, {
        method: "PATCH",
        body: JSON.stringify({ prompt }),
      })
    );
  const toggleLike = () =>
    run(() => soundApi(`/api/sounds/${track.id}/version/${ver.v}/like`, { method: "POST" }));
  const del = () => {
    if (window.confirm(`Delete v${ver.v}?`))
      run(() => soundApi(`/api/sounds/${track.id}/version/${ver.v}`, { method: "DELETE" }));
  };

  return (
    <div className={cn("space-y-2.5 rounded-lg border bg-muted/30 p-3", ver.liked && "border-primary/30")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono">v{ver.v}</Badge>
        {ver.name && <span className="text-sm font-medium">{ver.name}</span>}
        {ver.status === "ready" ? (
          <Badge variant="success">ready</Badge>
        ) : (
          <Badge variant="warning"><Clock size={11} /> needs render</Badge>
        )}
        {ver.duration ? <span className="text-xs text-muted-foreground">{ver.duration.toFixed(1)}s</span> : null}
        <span className="flex-1" />
        {ver.status !== "ready" && (
          <Button
            size="sm"
            onClick={requestRender}
            disabled={agentBusy}
            title={agentBusy ? "Agent is busy — wait for the current turn to finish" : "Render this version with Seed Audio via the studio agent"}
          >
            {agentBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Render
          </Button>
        )}
        <Button
          variant="ghost" size="icon-sm"
          aria-label={ver.liked ? "Unlike this version" : "Like this version"}
          onClick={toggleLike} disabled={busy} title="Like"
        >
          <Heart size={16} fill={ver.liked ? "#e11d48" : "none"} color={ver.liked ? "#e11d48" : "currentColor"} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete this version" onClick={del} disabled={busy} title="Delete version">
          <Trash2 size={15} />
        </Button>
      </div>

      <Textarea
        className="min-h-24 font-mono text-xs"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        spellCheck={false}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-52"
          placeholder="new version name (optional)"
          value={vname}
          onChange={(e) => setVname(e.target.value)}
        />
        <Button size="sm" onClick={saveNewVersion} disabled={busy || !prompt.trim()} title="Save the edited prompt as a new version (starts pending)">
          <Plus size={13} /> Save as new version
        </Button>
        {dirty && (
          <>
            <Button variant="outline" size="sm" onClick={saveInPlace} disabled={busy} title="Overwrite this version's prompt (no new version)">
              <Save size={13} /> Update v{ver.v}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPrompt(ver.prompt)} disabled={busy}>
              <RotateCcw size={13} /> Reset
            </Button>
          </>
        )}
        <span className="text-xs text-muted-foreground">{prompt.length} chars</span>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>

      {ver.status === "ready" && ver.url ? (
        <div className="flex items-center gap-3">
          <audio controls src={ver.url} preload="none" className="flex-1" />
          <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={ver.url} download>
            <Download size={13} /> download
          </a>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Clock size={13} className="shrink-0" />
          <span className="flex-1">
            Pending — hit <span className="font-medium text-foreground">Render</span> and the studio agent runs Seed
            Audio via Higgsfield, then attaches the result here.
          </span>
          <Button size="sm" onClick={requestRender} disabled={agentBusy}>
            {agentBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Render
          </Button>
        </div>
      )}

      {ver.ref?.url && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2">
          <Speech size={13} className="shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-xs text-muted-foreground">reference:</span>
          {ver.ref.name && <span className="shrink-0 text-xs font-medium">{ver.ref.name}</span>}
          <audio controls src={ver.ref.url} preload="none" className="h-8 min-w-48 flex-1" />
          <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={ver.ref.url} download>
            <Download size={13} /> ref
          </a>
        </div>
      )}

      {ver.seedText && (
        <details className="rounded-md border bg-muted/20">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <FileText size={12} className="mr-1 inline" /> Seed Audio prompt &amp; config
          </summary>
          <div className="space-y-2 border-t px-3 py-2">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{ver.seedText}</pre>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(ver.seedText)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Copy size={12} /> copy
              </button>
              {ver.seedUrl && (
                <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={ver.seedUrl} download>
                  <Download size={12} /> download .txt
                </a>
              )}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

function SoundTrack({ track, onChanged }) {
  const [name, setName] = useState(track.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(track.name);
  }, [track.name, track.id]);

  const saveName = async () => {
    if (!name.trim() || name.trim() === track.name) {
      setName(track.name);
      return;
    }
    setBusy(true);
    try {
      await soundApi(`/api/sounds/${track.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      onChanged();
    } catch {
      setName(track.name);
    } finally {
      setBusy(false);
    }
  };
  const delTrack = async () => {
    if (!window.confirm(`Delete “${track.name}” and all its versions?`)) return;
    setBusy(true);
    try {
      await soundApi(`/api/sounds/${track.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const liked = track.versions.some((v) => v.liked);
  const versions = [...track.versions].sort((a, b) => b.v - a.v);

  return (
    <Panel
      id={`snd-${track.id}`}
      className="scroll-mt-24 gap-0"
      bodyClassName="space-y-3"
      title={
        <div className="flex items-center gap-2.5">
          <Music size={18} className="text-primary" />
          <Input
            className="h-8 w-64 font-medium"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            disabled={busy}
            aria-label="Track name"
          />
          {liked && <Heart size={15} fill="#e11d48" color="#e11d48" />}
        </div>
      }
      meta={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {track.versions.length} version{track.versions.length === 1 ? "" : "s"}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Delete track" onClick={delTrack} disabled={busy} title="Delete track">
            <Trash2 size={16} />
          </Button>
        </div>
      }
    >
      {versions.map((v) => (
        <SoundVersion key={v.v} track={track} ver={v} onChanged={onChanged} />
      ))}
    </Panel>
  );
}

const MOODS = [
  "whimsical", "tension", "mystery", "chill", "exploratory", "friendly",
  "frightening", "playful", "tender", "magical", "adventurous", "melancholic",
  "triumphant", "dreamy", "cozy", "suspenseful", "somber", "hopeful",
];
const SEED_AUDIO_CAP = 2048;

function NewSoundBuilder({ bundles, busy, onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [seconds, setSeconds] = useState(15);
  const [moods, setMoods] = useState(() => new Set());
  const [customMood, setCustomMood] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [marks, setMarks] = useState("");
  const [edited, setEdited] = useState(false);
  const [manual, setManual] = useState("");
  const [copied, setCopied] = useState(false);

  const toggleFrom = (set, key) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };
  const toggleMood = (m) => {
    setMoods((s) => toggleFrom(s, m));
    setEdited(false);
  };
  const toggleShot = (k) => {
    setPicked((s) => toggleFrom(s, k));
    setEdited(false);
  };
  const toggleBundle = (b) => {
    const keys = b.shots.map((s) => `${b.id}/${s.id}`);
    const allSel = keys.every((k) => picked.has(k));
    setPicked((s) => {
      const next = new Set(s);
      keys.forEach((k) => (allSel ? next.delete(k) : next.add(k)));
      return next;
    });
    setEdited(false);
  };
  const toggleExpand = (id) => setExpanded((s) => toggleFrom(s, id));

  const moodList = useMemo(
    () => [
      ...moods,
      ...customMood.split(",").map((s) => s.trim()).filter(Boolean),
    ],
    [moods, customMood]
  );

  const composed = useMemo(() => {
    const secs = Number(seconds) || 15;
    let p =
      `Create a background music track that must be ${secs} seconds long. ` +
      `It should have a start, and an ending that finishes the song not abruptly but gracefully.`;
    if (moodList.length) p += `\n\nNotice this track is ${moodList.join(", ")}.`;
    if (picked.size) {
      p += `\n\nUse the following multi-shot prompt as reference for the scene the music plays under:`;
      for (const b of bundles) {
        for (const s of b.shots) {
          if (picked.has(`${b.id}/${s.id}`))
            p += `\n- ${b.id} shot ${s.id} (${s.dur}s): ${s.summary}`;
        }
      }
    }
    if (marks.trim())
      p +=
        `\n\nTry to make some sound design on the track that has some highs or lows ` +
        `at these second marks: ${marks.trim()}.`;
    return p;
  }, [seconds, moodList, picked, marks, bundles]);

  const promptText = edited ? manual : composed;
  const over = promptText.length > SEED_AUDIO_CAP;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-5 p-5">
        <Input
          className="max-w-sm"
          placeholder="name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="space-y-2">
          <Label>Duration</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="w-24"
              min={1}
              max={120}
              value={seconds}
              onChange={(e) => {
                setSeconds(e.target.value);
                setEdited(false);
              }}
            />
            <span className="text-sm text-muted-foreground">seconds</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Mood</Label>
          <div className="flex flex-wrap gap-2">
            {MOODS.map((m) => (
              <Chip key={m} on={moods.has(m)} onClick={() => toggleMood(m)}>{m}</Chip>
            ))}
          </div>
          <Input
            className="max-w-md"
            placeholder="other moods (comma-separated)…"
            value={customMood}
            onChange={(e) => {
              setCustomMood(e.target.value);
              setEdited(false);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label>Scene reference — pick shots (whole MS bundle, or individual shots)</Label>
          {bundles.length === 0 ? (
            <Empty>no multi-shot bundles loaded</Empty>
          ) : (
            <div className="space-y-1.5">
              {bundles.map((b) => {
                const keys = b.shots.map((s) => `${b.id}/${s.id}`);
                const allSel = keys.every((k) => picked.has(k));
                const someSel = keys.some((k) => picked.has(k));
                const open = expanded.has(b.id);
                return (
                  <div className="rounded-lg border bg-muted/30" key={b.id}>
                    <div className="flex items-center gap-2 p-2.5">
                      <Checkbox
                        checked={allSel ? true : someSel ? "indeterminate" : false}
                        onCheckedChange={() => toggleBundle(b)}
                        aria-label={`Select all of ${b.id}`}
                      />
                      <button
                        type="button"
                        className="flex flex-1 items-center gap-2 text-left text-sm"
                        onClick={() => toggleExpand(b.id)}
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <strong className="font-mono">{b.id}</strong>
                        <span className="truncate text-muted-foreground">
                          {b.beatTitle} · shots {b.shots[0]?.id}–{b.shots[b.shots.length - 1]?.id}
                        </span>
                        {someSel && (
                          <Badge variant="success" className="ml-auto">
                            {keys.filter((k) => picked.has(k)).length}/{keys.length}
                          </Badge>
                        )}
                      </button>
                    </div>
                    {open && (
                      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t px-3 py-2.5">
                        {b.shots.map((s) => (
                          <label className="flex items-center gap-1.5 text-xs" key={s.id}>
                            <Checkbox
                              checked={picked.has(`${b.id}/${s.id}`)}
                              onCheckedChange={() => toggleShot(`${b.id}/${s.id}`)}
                            />
                            shot {s.id} <span className="text-muted-foreground">{s.dur}s</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            references use each shot’s short summary to keep the prompt within Seed Audio’s {SEED_AUDIO_CAP}-char limit
          </span>
        </div>

        <div className="space-y-2">
          <Label>Sound design marks (optional)</Label>
          <Input
            className="max-w-lg"
            placeholder="e.g. swell at 0:03, dip at 0:08, sparkle at 0:12"
            value={marks}
            onChange={(e) => {
              setMarks(e.target.value);
              setEdited(false);
            }}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Composed prompt</Label>
            {edited && (
              <Button variant="outline" size="sm" onClick={() => setEdited(false)}>
                <RotateCcw size={12} /> Rebuild from fields
              </Button>
            )}
          </div>
          <Textarea
            className="min-h-32 font-mono text-xs"
            value={promptText}
            spellCheck={false}
            onChange={(e) => {
              setManual(e.target.value);
              setEdited(true);
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => onCreate({ name, prompt: promptText })} disabled={busy || !promptText.trim() || over}>
            <Plus size={13} /> Create (pending render)
          </Button>
          <Button variant="outline" onClick={copy} disabled={!promptText.trim()}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy prompt"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <span className={cn("text-xs", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {promptText.length} / {SEED_AUDIO_CAP} chars
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Sound effects share the /api/sounds store with background music; they're told
// apart by this fixed prompt lead-in (see trackKind).
const SFX_PREFIX =
  "Use the Seed Audio prompt to create a sound effect for an animated series for kids.";
const SFX_OUTRO =
  "Finish it not abruptly but softly, into an end mix of an ending and a fade-out if needed depending on the tune.";
const sfxPrompt = (desc, seconds, smoothOutro) =>
  `${SFX_PREFIX} The sound to create is: ${desc.trim()}.` +
  (seconds ? ` It should be about ${seconds} second${Number(seconds) === 1 ? "" : "s"} long.` : "") +
  (smoothOutro ? ` ${SFX_OUTRO}` : "");
const SFX_RE = /^\s*use the seed audio prompt to create a sound effect/i;

// Voice-acting lines are cloned from a Seed Audio voice reference. They're told
// apart from music/sfx by a leading @AudioN reference or this fixed lead-in.
const VOICE_PREFIX =
  "Use a Seed Audio voice reference to voice-act a dialogue line for an animated series for kids.";
const voicePrompt = (character, lines) =>
  `${VOICE_PREFIX}${character?.trim() ? ` Character: ${character.trim()}.` : ""}` +
  ` Match the uploaded voice reference exactly (timbre, pitch, age, tone). Speak only clean dialogue in that voice — no music, no sound effects, no background.` +
  ` Lines: ${lines.trim()}`;
const VOICE_RE = /^\s*(@audio\d|use a seed audio voice reference to voice-act)/i;

function trackKind(t) {
  const v1 = (t.versions || []).find((v) => v.v === 1) || (t.versions || [])[0];
  const p = v1?.prompt || "";
  if (VOICE_RE.test(p)) return "voice";
  return SFX_RE.test(p) ? "sfx" : "music";
}

// Sound-effect builder: one description field → the fixed SFX prompt (editable).
function SfxBuilder({ busy, onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [seconds, setSeconds] = useState("");
  const [smoothOutro, setSmoothOutro] = useState(false);
  const [edited, setEdited] = useState(false);
  const [manual, setManual] = useState("");
  const [copied, setCopied] = useState(false);

  const composed = useMemo(
    () => sfxPrompt(desc || "…", seconds, smoothOutro),
    [desc, seconds, smoothOutro]
  );
  const promptText = edited ? manual : composed;
  const over = promptText.length > SEED_AUDIO_CAP;
  const canCreate = !busy && !over && promptText.trim() && (edited || desc.trim());

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-5 p-5">
        <Input
          className="max-w-sm"
          placeholder="name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="space-y-2">
          <Label>Sound to create</Label>
          <Textarea
            className="min-h-20"
            placeholder="e.g. a magical sparkle chime as the fairy waves her wand — short, bright, whimsical"
            value={desc}
            onChange={(e) => {
              setDesc(e.target.value);
              setEdited(false);
            }}
          />
          <span className="text-xs text-muted-foreground">
            wrapped into a Seed Audio prompt: “{SFX_PREFIX} The sound to create is: …”
          </span>
        </div>

        <div className="space-y-2">
          <Label>Length <span className="text-xs font-normal text-muted-foreground">(optional)</span></Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="w-24"
              min={1}
              max={60}
              placeholder="e.g. 3"
              value={seconds}
              onChange={(e) => {
                setSeconds(e.target.value);
                setEdited(false);
              }}
            />
            <span className="text-sm text-muted-foreground">seconds</span>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5">
          <Checkbox
            checked={smoothOutro}
            onCheckedChange={(c) => {
              setSmoothOutro(!!c);
              setEdited(false);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="text-sm font-medium">Smooth outro</span>
            <span className="block text-xs text-muted-foreground">
              finish softly — an end mix of an ending and a fade-out if the tune needs it
            </span>
          </span>
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Composed prompt</Label>
            {edited && (
              <Button variant="outline" size="sm" onClick={() => setEdited(false)}>
                <RotateCcw size={12} /> Rebuild from field
              </Button>
            )}
          </div>
          <Textarea
            className="min-h-28 font-mono text-xs"
            value={promptText}
            spellCheck={false}
            onChange={(e) => {
              setManual(e.target.value);
              setEdited(true);
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => onCreate({ name, prompt: promptText })} disabled={!canCreate}>
            <Plus size={13} /> Create (pending render)
          </Button>
          <Button variant="outline" onClick={copy} disabled={!promptText.trim()}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy prompt"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <span className={cn("text-xs", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {promptText.length} / {SEED_AUDIO_CAP} chars
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Voice-acting builder: character + dialogue lines → the fixed voice prompt.
// The actual generation clones an uploaded voice reference (done by the agent).
function VoiceBuilder({ busy, onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [character, setCharacter] = useState("");
  const [lines, setLines] = useState("");
  const [edited, setEdited] = useState(false);
  const [manual, setManual] = useState("");
  const [copied, setCopied] = useState(false);

  const composed = useMemo(() => voicePrompt(character, lines || "…"), [character, lines]);
  const promptText = edited ? manual : composed;
  const over = promptText.length > SEED_AUDIO_CAP;
  const canCreate = !busy && !over && promptText.trim() && (edited || lines.trim());

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-5 p-5">
        <Input
          className="max-w-sm"
          placeholder="name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="space-y-2">
          <Label>Character <span className="text-xs font-normal text-muted-foreground">(voice to match)</span></Label>
          <Input
            className="max-w-sm"
            placeholder="e.g. Helena"
            value={character}
            onChange={(e) => {
              setCharacter(e.target.value);
              setEdited(false);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label>Dialogue lines</Label>
          <Textarea
            className="min-h-24"
            placeholder={'e.g. "Oh!" ... (1s pause) ... "Where is Sara?"  (2s)  "There you are!"'}
            value={lines}
            onChange={(e) => {
              setLines(e.target.value);
              setEdited(false);
            }}
          />
          <span className="text-xs text-muted-foreground">
            cloned from an uploaded voice reference · wrapped into: “{VOICE_PREFIX} … Lines: …”
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Composed prompt</Label>
            {edited && (
              <Button variant="outline" size="sm" onClick={() => setEdited(false)}>
                <RotateCcw size={12} /> Rebuild from fields
              </Button>
            )}
          </div>
          <Textarea
            className="min-h-28 font-mono text-xs"
            value={promptText}
            spellCheck={false}
            onChange={(e) => {
              setManual(e.target.value);
              setEdited(true);
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => onCreate({ name, prompt: promptText })} disabled={!canCreate}>
            <Plus size={13} /> Create (pending render)
          </Button>
          <Button variant="outline" onClick={copy} disabled={!promptText.trim()}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy prompt"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <span className={cn("text-xs", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {promptText.length} / {SEED_AUDIO_CAP} chars
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function TrackList({ loading, tracks, emptyText, onChanged }) {
  if (loading) return <Spinner label="loading…" />;
  if (tracks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <Empty>{emptyText}</Empty>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {tracks.map((t) => (
        <SoundTrack key={t.id} track={t} onChanged={onChanged} />
      ))}
    </div>
  );
}

function SoundStudio({ reloadKey }) {
  const [tracks, setTracks] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("music");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await soundApi("/api/sounds");
      setTracks(data.tracks || []);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  useEffect(() => {
    (async () => {
      try {
        const data = await soundApi("/api/episode");
        setBundles(data.episode?.bundles || []);
      } catch {
        setBundles([]);
      }
    })();
  }, []);

  const createTrack = async ({ name, prompt }) => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await soundApi("/api/sounds", {
        method: "POST",
        body: JSON.stringify({ name, prompt }),
      });
      setShowNew(false);
      load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const music = useMemo(() => tracks.filter((t) => trackKind(t) === "music"), [tracks]);
  const sfx = useMemo(() => tracks.filter((t) => trackKind(t) === "sfx"), [tracks]);
  const voice = useMemo(() => tracks.filter((t) => trackKind(t) === "voice"), [tracks]);
  const pending = tracks.reduce(
    (n, t) => n + t.versions.filter((v) => v.status !== "ready").length,
    0
  );

  const switchTab = (v) => {
    setTab(v);
    setShowNew(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Sound studio</h2>
        {pending > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="warning"><Clock size={11} /> {pending} pending render</Badge>
            <Button
              size="sm"
              onClick={() => agent.send({ message: renderAllPendingMessage(tracks) }).catch(() => {})}
              disabled={agentBusy}
              title={agentBusy ? "Agent is busy — wait for the current turn to finish" : "Render every pending version via the studio agent"}
            >
              {agentBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Render all pending
            </Button>
          </div>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Tabs value={tab} onValueChange={switchTab}>
        <TabsList>
          <TabsTrigger value="music"><Music size={14} /> Background music</TabsTrigger>
          <TabsTrigger value="sfx"><Volume2 size={14} /> Sound effects</TabsTrigger>
          <TabsTrigger value="voice"><Speech size={14} /> Voice acting</TabsTrigger>
        </TabsList>

        <TabsContent value="music" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowNew((s) => !s)}>
              <Plus size={14} /> New background music
            </Button>
          </div>
          {showNew && (
            <NewSoundBuilder
              bundles={bundles}
              busy={busy}
              onCreate={createTrack}
              onCancel={() => setShowNew(false)}
            />
          )}
          <TrackList
            loading={loading}
            tracks={music}
            emptyText="No background music yet — click “New background music”."
            onChanged={load}
          />
        </TabsContent>

        <TabsContent value="sfx" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowNew((s) => !s)}>
              <Plus size={14} /> New sound effect
            </Button>
          </div>
          {showNew && (
            <SfxBuilder busy={busy} onCreate={createTrack} onCancel={() => setShowNew(false)} />
          )}
          <TrackList
            loading={loading}
            tracks={sfx}
            emptyText="No sound effects yet — click “New sound effect”."
            onChanged={load}
          />
        </TabsContent>

        <TabsContent value="voice" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowNew((s) => !s)}>
              <Plus size={14} /> New voice line
            </Button>
          </div>
          {showNew && (
            <VoiceBuilder busy={busy} onCreate={createTrack} onCancel={() => setShowNew(false)} />
          )}
          <TrackList
            loading={loading}
            tracks={voice}
            emptyText="No voice lines yet — click “New voice line”."
            onChanged={load}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * App shell                                                        *
 * ---------------------------------------------------------------- */

const TABS = [
  { value: "script", label: "Script" },
  { value: "shots", label: "Shots" },
  { value: "multishot", label: "Multi-shot" },
  { value: "episode", label: "Episode (48)" },
  { value: "cuts", label: "Complete cuts" },
  { value: "library", label: "Library" },
  { value: "sounds", label: "Sound studio" },
];

// Brand-lime glow (matches the Higgsfield primary) for the "route being edited"
// cue on the Script tab. `colors` alternates the glow hue with black so the
// glowing library's gradient reads as a lime shimmer.
const GLOW_OPTS = {
  colors: ["#cbf74e", "#000000", "#a3e635", "#000000", "#cbf74e"],
  colors2: ["#ffffff", "#000000", "#000000", "#ffffff"],
  width: 3,
  rotationDuration: 2200,
  glowingBlurRatio: 1.4,
};

// Glow the element matching `selector` (a DOM query, since radix TabsTrigger
// doesn't forward refs) while `active` is true — created on activation, removed
// on deactivation / unmount.
function useGlow(selector, active, options) {
  useEffect(() => {
    if (!active) return;
    const el = document.querySelector(selector);
    if (!el) return;
    const glow = new Glowing(el, options);
    return () => glow.remove();
  }, [selector, active, options]);
}

// Subscribe to the Script live-update stream. Returns a counter that bumps on
// every edit made ELSEWHERE (the chat agent) — not this tab's own saves — so the
// Script editor can reload and the tab can glow.
function useScriptLiveEdits() {
  const [edits, setEdits] = useState(0);
  useEffect(() => {
    const es = new EventSource("/api/script/events");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.clientId !== CLIENT_ID) setEdits((n) => n + 1);
      } catch {
        /* ignore malformed frames / heartbeats */
      }
    };
    return () => es.close();
  }, []);
  return edits;
}

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true
  );
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{dark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  );
}

// Account menu — the shadcn avatar in the header opens a dropdown with a link
// to higgsfield.ai and a sign-out that drops the Higgsfield credential and
// re-gates the app (reload → LoginGate re-checks → homepage).
function UserMenu() {
  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* reload re-gates regardless of the request outcome */
    }
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary">
              <User size={16} />
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Higgsfield account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="https://higgsfield.ai" target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> Visit higgsfield.ai
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={signOut}>
          <LogOut size={14} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function App() {
  const [view, setView] = useState("shots");
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [modalImage, setModalImage] = useState(null);

  // Cross-tab jump: the Complete-cut overlay calls navigateTo({ view, anchor })
  // to switch tabs and scroll to a bundle / sound card. The target tab remounts
  // and loads async, so we retry finding the anchor for a few seconds, then
  // flash it. { view, anchor, nonce } — nonce lets the same target re-trigger.
  const [navTarget, setNavTarget] = useState(null);
  const navNonce = useRef(0);
  const navigateTo = useCallback(({ view: v, anchor }) => {
    navNonce.current += 1;
    setNavTarget({ view: v, anchor, nonce: navNonce.current });
    setView(v);
  }, []);
  useEffect(() => {
    if (!navTarget || view !== navTarget.view) return;
    let tries = 0;
    let timer;
    const tryScroll = () => {
      const el = document.getElementById(navTarget.anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("nav-flash");
        void el.offsetWidth; // restart the animation if already applied
        el.classList.add("nav-flash");
        setTimeout(() => el.classList.remove("nav-flash"), 1600);
        setNavTarget(null);
        return;
      }
      if (tries++ < 40) timer = setTimeout(tryScroll, 100); // wait out async load
    };
    tryScroll();
    return () => clearTimeout(timer);
  }, [navTarget, view]);

  // Live Script edits (from the chat agent) → reload the editor + glow the tab.
  const scriptEdits = useScriptLiveEdits();
  const [scriptGlow, setScriptGlow] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (scriptEdits === 0) return; // ignore the initial value
    if (viewRef.current === "script") {
      // Already looking at it (it live-updates) — just a brief pulse.
      setScriptGlow(true);
      const t = setTimeout(() => setScriptGlow(false), 1800);
      return () => clearTimeout(t);
    }
    // Editing happened on another tab — glow until the user opens the Script tab.
    setScriptGlow(true);
  }, [scriptEdits]);
  useEffect(() => {
    if (view === "script") setScriptGlow(false);
  }, [view]);
  useGlow('[data-script-tab="true"]', scriptGlow, GLOW_OPTS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shots");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setShots(data.shots);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <TooltipProvider delayDuration={200}>
      <AgentProvider view={view}>
      <LoginGate>
      <div className="flex h-dvh overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto">
      <Tabs value={view} onValueChange={setView}>
        <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-6">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Clapperboard size={18} />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">shot-studio</div>
                <div className="text-[11px] text-muted-foreground">animation pipeline dashboard</div>
              </div>
            </div>

            <TabsList className="h-9">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="text-xs"
                  {...(t.value === "script" ? { "data-script-tab": "true" } : {})}
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {loading ? "loading…" : `${shots.length} shots`}
              </span>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Refresh
              </Button>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 py-6 md:px-6">
          {view === "script" ? (
            <ScriptEditor reloadKey={reloadKey} liveKey={scriptEdits} />
          ) : view === "sounds" ? (
            <SoundStudio reloadKey={reloadKey} />
          ) : view === "library" ? (
            <Library reloadKey={reloadKey} onView={setModalImage} />
          ) : view === "cuts" ? (
            <CompleteCuts reloadKey={reloadKey} navigateTo={navigateTo} />
          ) : view === "episode" ? (
            <Episode reloadKey={reloadKey} onView={setModalImage} />
          ) : view === "multishot" ? (
            <MultiShot reloadKey={reloadKey} />
          ) : (
            <div className="space-y-4">
              {error && <ErrorNote>{error}</ErrorNote>}
              <div className="overflow-hidden rounded-xl border">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px] table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="w-[6%]" />
                      <col className="w-[30%]" />
                      <col className="w-[26%]" />
                      <col className="w-[20%]" />
                      <col className="w-[18%]" />
                    </colgroup>
                    <thead>
                      <tr className="bg-muted/60 text-left">
                        <th className="border-b px-3 py-2.5 font-semibold">Shot</th>
                        <th className="border-b px-3 py-2.5 font-semibold">Seedance shot</th>
                        <th className="border-b px-3 py-2.5 font-semibold">Audio shot (seed-audio)</th>
                        <th className="border-b px-3 py-2.5 font-semibold">Audio generation</th>
                        <th className="border-b px-3 py-2.5 font-semibold">Video generation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const rows = [];
                        let lastSeg = null;
                        for (const s of shots) {
                          if (s.audioSegmentLabel && s.audioSegment !== lastSeg) {
                            lastSeg = s.audioSegment;
                            rows.push(
                              <tr key={`seg-${s.audioSegment}`}>
                                <td
                                  colSpan={5}
                                  className="border-y border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-500"
                                >
                                  {s.audioSegmentLabel}
                                </td>
                              </tr>
                            );
                          }
                          rows.push(
                            <tr key={s.id} className="align-top odd:bg-muted/20">
                              <td className="border-b px-3 py-3 font-mono font-semibold">shot{s.id}</td>
                              <td className="border-b px-3 py-3">
                                <EditableCell shotId={s.id} kind="seedance" initialText={s.seedanceText} found={s.seedanceFound} />
                              </td>
                              <td className="border-b px-3 py-3">
                                <EditableCell shotId={s.id} kind="audio" initialText={s.audioText} found={s.audioFound} />
                              </td>
                              <td className="border-b px-3 py-3">
                                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                                  <Speech size={13} /> Speech · for lipsync
                                </div>
                                <MediaTakes kind="audio" takes={s.speechTakes} reloadKey={reloadKey} />
                                <div className="mb-1 mt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-500">
                                  <Leaf size={13} /> VFX · layer on video
                                </div>
                                <MediaTakes kind="audio" takes={s.vfxTakes} reloadKey={reloadKey} />
                              </td>
                              <td className="border-b px-3 py-3">
                                <MediaTakes kind="video" takes={s.videoTakes} reloadKey={reloadKey} />
                              </td>
                            </tr>
                          );
                        }
                        return rows;
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </Tabs>
      </div>
      <AgentChat />
      </div>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
      </LoginGate>
      </AgentProvider>
    </TooltipProvider>
  );
}
