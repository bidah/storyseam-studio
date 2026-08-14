import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { X, Check, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Maximize2, Volume2, VolumeX, Speech, Play, Pause, Copy, Pencil, Sparkles, PenLine, FileText, Film, Image as ImageIcon, Loader2, Wand2, Scissors, Boxes, CircleAlert, MapPin, User, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { invalidateTabCache } from "@/lib/tabCache";
import { useAgent, agentIsBusy, renderEpisodeMessage, renderStoryboardMessage, renderStoryboardAllMessage, trimMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, Chip, ErrorNote, ConfirmModal, IconSwap } from "@/components/shared";
import { ProductionTypeBadge } from "@/components/ProductionType";
import MediaPicker from "@/components/MediaPicker";
import { useShell } from "@/lib/shellContext";

/* ---------------------------------------------------------------- *
 * Reference-label + copy helpers                                   *
 * ---------------------------------------------------------------- */

function refLabel(rel) {
  const base = rel.split("/").pop().toLowerCase();
  const night = base.includes("night");
  const fmtLabel = (n) => (night ? `${n} (night)` : n);
  if (base.includes("kids")) return "Elf kids";
  if (base.includes("king") && base.includes("house")) return "King's house";
  if (base.includes("king")) return fmtLabel("Forest King");
  if (base.includes("sara")) return fmtLabel("Sara");
  if (base.includes("helena")) return fmtLabel("Helena");
  if (base.includes("mote") || base.includes("glow")) return fmtLabel("Mote");
  if (base.includes("deep") && base.includes("forest")) return fmtLabel("deep wood");
  if (base.includes("school")) return "school";
  if (base.includes("classroom")) return "classroom";
  if (base.includes("forest")) return fmtLabel("forest");
  return base.replace(/\.[a-z0-9]+$/, "");
}

function CopyButton({ text, label = "copy prompt" }) {
  const t = useT();
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
      <IconSwap active={copied} on={<Check size={13} />} off={<Copy size={13} />} /> {copied ? t("copied") : t(label)}
    </Button>
  );
}

/* ---------------------------------------------------------------- *
 * Scene needs                                                      *
 * ---------------------------------------------------------------- */

// Re-derive a bundle's needs fulfillment from the CURRENT (optimistic) picks so
// the checklist updates instantly on toggle, without waiting for a revalidate.
// Mirrors the worker's needsStateFor: an image need is covered by its World
// sheet being picked (auto) or by an explicitly linked pick; a voice need by a
// picked audio ref whose speakers include the name.
function computeNeeds(state, picked, audioPicked, audioMap) {
  if (!state) return null;
  const needs = (state.needs || []).map((n) => {
    const link = n.link && picked.has(n.link) ? n.link : null;
    const auto = n.sheetRel && picked.has(n.sheetRel) ? n.sheetRel : null;
    return { ...n, fulfilled: !!(link || auto), via: link || auto };
  });
  const covered = new Set();
  for (const rel of audioPicked) {
    const a = audioMap.get(rel);
    const names = a?.order?.length ? a.order : a?.character ? [a.character] : [];
    for (const nm of names) covered.add(String(nm).trim().toUpperCase());
  }
  // A cast voice covers its speaker on its own; an uncast Sound Studio take
  // covers one only while linked to it AND still picked (mirrors the worker).
  const voice = (state.voice || []).map((v) => {
    const link = v.link && audioPicked.has(v.link) ? v.link : null;
    const auto = covered.has(String(v.name).trim().toUpperCase());
    return { ...v, fulfilled: auto || !!link, via: auto ? "cast voice" : link };
  });
  return {
    ...state, needs, voice,
    complete: { images: needs.every((n) => n.fulfilled), audio: voice.every((v) => v.fulfilled) },
  };
}

const roleIcon = { location: MapPin, character: User, voice: Volume2 };

function NeedChip({ role, label, fulfilled, title }) {
  const t = useT();
  const Icon = roleIcon[role] || User;
  return (
    <Badge variant={fulfilled ? "success" : "warning"} className="gap-1" title={title}>
      {fulfilled ? <Check size={11} /> : <Icon size={11} />}
      {label}
      {role === "voice" && <span className="opacity-70">{t("(voice)")}</span>}
    </Badge>
  );
}

// The live scene-needs checklist shown on each bundle card (and echoed by the
// pickers): every location/character/voice the scene requires, green when a
// chosen reference covers it.
function NeedsChecklist({ ns }) {
  const t = useT();
  if (!ns) return null;
  const total = ns.needs.length + ns.voice.length;
  if (!total) return <Empty>{t("no scene needs detected — rebuild the plan after writing the shot list")}</Empty>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t("scene needs")}</span>
      {ns.needs.map((n) => (
        <NeedChip
          key={n.id}
          role={n.role}
          label={n.key}
          fulfilled={n.fulfilled}
          title={
            n.fulfilled
              ? t("covered by {via}", { via: n.via })
              : n.sheetRel
              ? t("not covered yet — choose its World sheet as a reference (or auto-assign)")
              : t("no World sheet linked — choose any reference and link it to this need")
          }
        />
      ))}
      {ns.voice.map((v) => (
        <NeedChip
          key={v.id}
          role="voice"
          label={v.name}
          fulfilled={v.fulfilled}
          title={v.fulfilled ? t("voice reference chosen") : t("no voice reference chosen for this speaker yet")}
        />
      ))}
    </div>
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

function SigningModal({ bundle, signoff, ns, open, onSign, onClose }) {
  const t = useT();
  const [signedBy, setSignedBy] = useState(() => {
    try { return localStorage.getItem("shotStudioSigner") || ""; } catch { return ""; }
  });
  const [err, setErr] = useState(null);
  const so = signoff || { images: null, prompt: null, audio: null };
  const name = signedBy.trim();
  // Scene-needs gate: images can't be signed while an image need is uncovered,
  // audio while a speaker has no voice pick. (The worker enforces this too.)
  const gated = ns?.enforced
    ? {
        images: ns.complete.images ? null : ns.needs.filter((n) => !n.fulfilled).map((n) => n.key),
        audio: ns.complete.audio ? null : ns.voice.filter((v) => !v.fulfilled).map((v) => v.name),
      }
    : {};
  const toggle = async (section, signed) => {
    if (signed) {
      if (!name || gated[section]) return;
      try { localStorage.setItem("shotStudioSigner", name); } catch { /* ignore */ }
    }
    setErr(null);
    const e = await onSign(bundle.id, section, signed, name);
    if (e) setErr(e);
  };
  const fmt = (at) => { try { return new Date(at).toLocaleString(); } catch { return at; } };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <PenLine size={16} className="shrink-0" /> {t("Revision signing")}
            <Badge variant="secondary" className="shrink-0 font-mono">{bundle.id}</Badge>
            <span className="font-normal text-muted-foreground">{bundle.beatTitle}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="signed-by">{t("Signed by")}</Label>
          <Input
            id="signed-by"
            value={signedBy}
            placeholder={t("your name")}
            onChange={(e) => setSignedBy(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          {SIGN_SECTIONS.map(({ key, label, hint, Icon }) => {
            const sig = so[key];
            const on = !!sig;
            const unmet = gated[key] || null;
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
                  disabled={!on && (!name || !!unmet)}
                  onCheckedChange={(c) => toggle(key, !!c)}
                  aria-label={on ? t("unsign {label}", { label }) : t("sign {label}", { label })}
                  className="size-5"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon size={13} /> {label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {on ? t("signed by {by} · {at}", { by: sig.by, at: fmt(sig.at) }) : hint}
                  </div>
                  {!on && unmet && (
                    <div className="mt-0.5 flex items-start gap-1 text-xs text-amber-500">
                      <CircleAlert size={12} className="mt-0.5 shrink-0" />
                      <span>{t("can't sign yet — uncovered scene needs: {unmet}", { unmet: unmet.join(", ") })}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {err && <ErrorNote>{err}</ErrorNote>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Rendered generations rail (per episode bundle)                   *
 * ---------------------------------------------------------------- */

// Format seconds as m:ss.d for the trim readout.
const fmtDur = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

function EpVideoRail({ bundleId, vids, reloadKey, onToggleVideo }) {
  const t = useT();
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
  const isTrim = g.kind === "trim";

  // Trim controls — drive the shared agent to run the ffmpeg cut (trim-video skill).
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const videoRef = useRef(null);
  const [dur, setDur] = useState(0);
  const [trimOpen, setTrimOpen] = useState(false);
  const [range, setRange] = useState([0, 0]);
  const [trimErr, setTrimErr] = useState(null);

  // Reset the trim panel whenever the shown clip changes.
  useEffect(() => {
    setTrimOpen(false);
    setTrimErr(null);
    setDur(0);
    setRange([0, 0]);
  }, [g.url]);

  const onMeta = (e) => {
    const d = e.currentTarget.duration;
    if (Number.isFinite(d) && d > 0) {
      setDur(d);
      setRange([0, d]);
    }
  };

  // Drag either handle → scrub the <video> to that frame so the in/out point is
  // visible. Seeks to whichever handle moved (the out frame while dragging right,
  // the in frame while dragging left).
  const onScrub = ([a, b]) => {
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    if (hi - lo < 0.1) hi = Math.min(dur, lo + 0.1);
    const target = Math.abs(hi - range[1]) >= Math.abs(lo - range[0]) ? hi : lo;
    setRange([lo, hi]);
    const v = videoRef.current;
    if (v) {
      v.pause();
      try { v.currentTime = Math.min(target, Math.max(0, dur - 0.05)); } catch { /* not seekable yet */ }
    }
  };

  const trimLen = range[1] - range[0];
  const canTrim = dur > 0 && trimLen >= 0.1 && !agentBusy;
  const doTrim = async () => {
    setTrimErr(null);
    try {
      await agent.send({ message: trimMessage(bundleId, g.file, range[0], range[1], g.name) });
      setTrimOpen(false);
    } catch (e) {
      setTrimErr(String(e.message || e));
    }
  };

  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <span className="truncate">{bundleId} · {g.name || t("gen {n}", { n: idx + 1 })}</span>
          {selCount > 0 && (
            <Badge variant="success" className="shrink-0">{selCount} <Check size={11} /> {t("stitch")}</Badge>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant={trimOpen ? "default" : "outline"}
            size="icon-xs"
            onClick={() => setTrimOpen((o) => !o)}
            aria-label={trimOpen ? t("Close trim") : t("Trim this take")}
            title={t("Trim this take")}
          >
            <Scissors size={14} />
          </Button>
          <Button variant="outline" size="icon-xs" onClick={prev} disabled={vids.length < 2} aria-label={t("Previous")}><ChevronLeft size={14} /></Button>
          <span className="text-xs tabular-nums text-muted-foreground">{idx + 1} / {vids.length}</span>
          <Button variant="outline" size="icon-xs" onClick={next} disabled={vids.length < 2} aria-label={t("Next")}><ChevronRight size={14} /></Button>
        </div>
      </div>
      <div className={cn("relative overflow-hidden rounded-lg", g.selected && "ring-2 ring-primary")}>
        <video ref={videoRef} key={`${g.url}?v=${reloadKey}-${idx}`} controls preload="metadata" playsInline className="bg-black" onLoadedMetadata={onMeta}>
          <source src={`${g.url}?v=${reloadKey}`} type="video/mp4" />
        </video>
        <button
          className={cn(
            "absolute left-2 top-2 flex size-6 items-center justify-center rounded-full border-2 border-white/80 shadow transition-colors",
            g.selected ? "bg-primary text-primary-foreground" : "bg-black/50 text-transparent hover:bg-black/70"
          )}
          title={g.selected ? t("selected for stitching — click to unselect") : t("select this take for stitching")}
          onClick={() => onToggleVideo(bundleId, g.file, !g.selected)}
        >
          <Check size={14} />
        </button>
        {isTrim && (
          <Badge variant="warning" className="absolute left-1/2 top-2 -translate-x-1/2 shrink-0 gap-1">
            <Scissors size={11} /> {t("trim version")}
          </Badge>
        )}
        {g.selected && (
          <Badge className="absolute right-2 top-2">{t("selected")}</Badge>
        )}
      </div>

      {trimOpen && (
        <div className="mt-3 rounded-lg border bg-background/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-medium"><Scissors size={12} /> {t("Trim")}</span>
            <span className="tabular-nums text-muted-foreground">
              {fmtDur(range[0])} <span className="text-muted-foreground/60">–</span> {fmtDur(range[1])}
              <span className="ml-1.5 text-primary">({trimLen.toFixed(1)}s)</span>
            </span>
          </div>
          <Slider
            min={0}
            max={dur || 0}
            step={0.05}
            value={range}
            onValueChange={onScrub}
            disabled={!dur}
            aria-label={t("Trim in and out points")}
            className="my-3"
          />
          <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
            {t("Drag the handles to set the start and end — the video scrubs to that frame. Creating a trim keeps the original and adds a new selectable version.")}
          </p>
          {trimErr && <ErrorNote>{trimErr}</ErrorNote>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setTrimOpen(false)}>{t("Cancel")}</Button>
            <Button size="sm" onClick={doTrim} disabled={!canTrim}>
              {agentBusy ? <><Loader2 size={13} className="animate-spin" /> {t("Trimming…")}</> : <><Scissors size={13} /> {t("Create trim")}</>}
            </Button>
          </div>
        </div>
      )}

      {vids.length > 1 && (
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {vids.map((v, k) => (
            <button
              key={v.file || k}
              className={cn(
                "size-2 rounded-full transition-colors",
                v.kind === "trim" && "rotate-45 rounded-[1px]",
                k === idx ? "bg-primary" : v.selected ? "bg-primary/50" : "bg-muted-foreground/30 hover:bg-muted-foreground/60"
              )}
              onClick={() => setI(k)}
              title={`${v.name || t("gen {n}", { n: k + 1 })}${v.kind === "trim" ? t(" (trim)") : ""}${v.selected ? t(" — selected") : ""}`}
              aria-label={v.name || t("gen {n}", { n: k + 1 })}
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
  const t = useT();
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
            <span className="font-normal">{bundle.beatTitle} — {t("edit prompt")}</span>
            {edited ? (
              <Badge variant="warning"><Pencil size={11} /> {t("edited")}</Badge>
            ) : (
              <Badge variant="success">{t("live")}</Badge>
            )}
          </DialogTitle>
          <div className="flex items-center gap-2 pr-8">
            {edited && (
              <Button variant="outline" size="sm" onClick={onReset} title={t("discard edits, return to the auto-composed prompt")}>
                <RotateCcw size={13} /> {t("reset to live")}
              </Button>
            )}
            <CopyButton text={fullPrefix + serializePrompt(sec)} />
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <section className="space-y-2">
            <Label>{t("Audio / VFX restrictions")}</Label>
            <div className="flex flex-wrap gap-2">
              {RESTRICTIONS.map((r) => (
                <Chip key={r.key} on={restr[r.key]} onClick={() => toggleRestriction(r.key)}>
                  {restr[r.key] && <Check size={13} />}
                  {t(r.label)}
                </Chip>
              ))}
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
              {sec.restrictionLine || t("(no restrictions — Seedance may add music, VFX & sound)")}
            </div>
          </section>

          <section className="space-y-2">
            <Label className="flex items-center gap-2">
              {t("References")}
              <span className="text-xs font-normal text-muted-foreground">
                {t("managed with the pickers behind this modal · click a thumbnail to preview")}
              </span>
            </Label>
            {assigned.length === 0 && audioAssigned.length === 0 ? (
              <Empty>{t("no references chosen")}</Empty>
            ) : (
              <div className="flex flex-wrap items-start gap-3">
                {assigned.map((im) => (
                  <figure key={im.rel} className="w-20 space-y-1">
                    <button
                      type="button"
                      className="block w-full overflow-hidden rounded-md border bg-muted"
                      onClick={() => onView({ url: im.display || im.url, name: im.rel, role: "reference" })}
                      title={t("click to view full image")}
                    >
                      <img src={im.thumb || im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
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
            <Label>{t("Style")}</Label>
            <Textarea rows={6} className="font-mono text-xs" value={sec.styleLine} onChange={(e) => setField("styleLine", e.target.value)} />
          </section>

          <section className="space-y-2">
            <Label>{t("Directives")}</Label>
            <Textarea rows={7} className="font-mono text-xs" value={sec.directives} onChange={(e) => setField("directives", e.target.value)} />
          </section>

          <section className="space-y-2">
            <Label>{t("Shots ({n})", { n: sec.shots.length })}</Label>
            <div className="space-y-3">
              {sec.shots.map((s, i) => (
                <div key={i} className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs font-semibold text-muted-foreground">{t("Shot {n}", { n: i + 1 })}</div>
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
 * Storyboard stills (per shot) — the image stage before video      *
 * ---------------------------------------------------------------- */

// A carousel of the generated stills for ONE shot (multiple angle takes), with
// select + preview. The image counterpart of EpVideoRail (no trim/scrub).
function EpStillRail({ stills, reloadKey, onView, onToggle }) {
  const t = useT();
  const selFile = stills.find((v) => v.selected)?.file;
  const [i, setI] = useState(() => {
    const s = stills.findIndex((v) => v.selected);
    return s >= 0 ? s : stills.length - 1;
  });
  useEffect(() => {
    const s = stills.findIndex((v) => v.selected);
    setI(s >= 0 ? s : stills.length - 1);
  }, [selFile, stills.length]);
  const idx = Math.min(i, stills.length - 1);
  const g = stills[idx];
  const prev = () => setI((n) => (n - 1 + stills.length) % stills.length);
  const next = () => setI((n) => (n + 1) % stills.length);
  // The viewer shows the ~1600px webp, not the multi-MB original PNG.
  const src = `${g.display || g.url}?v=${reloadKey}`;

  return (
    <div className="rounded-xl border bg-muted/30 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium">
          {g.name}
          {g.angle ? <span className="text-muted-foreground"> · {g.angle}</span> : null}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="icon-xs" onClick={prev} disabled={stills.length < 2} aria-label={t("Previous")}><ChevronLeft size={13} /></Button>
          <span className="text-[11px] tabular-nums text-muted-foreground">{idx + 1} / {stills.length}</span>
          <Button variant="outline" size="icon-xs" onClick={next} disabled={stills.length < 2} aria-label={t("Next")}><ChevronRight size={13} /></Button>
        </div>
      </div>
      <div className={cn("relative overflow-hidden rounded-lg", g.selected && "ring-2 ring-primary")}>
        <button className="block w-full" onClick={() => onView({ url: src, name: g.name, role: "still" })}>
          <img src={src} loading="lazy" alt={g.name} className="aspect-video w-full bg-black object-cover" />
        </button>
        <button
          className={cn(
            "absolute left-2 top-2 flex size-6 items-center justify-center rounded-full border-2 border-white/80 shadow transition-colors",
            g.selected ? "bg-primary text-primary-foreground" : "bg-black/50 text-transparent hover:bg-black/70"
          )}
          title={g.selected ? t("selected still — click to unselect") : t("select this still")}
          onClick={() => onToggle(g.file, !g.selected)}
        >
          <Check size={14} />
        </button>
        {g.selected && <Badge className="absolute right-2 top-2">{t("selected")}</Badge>}
      </div>
      {stills.length > 1 && (
        <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
          {stills.map((v, k) => (
            <button
              key={v.file || k}
              className={cn(
                "size-2 rounded-full transition-colors",
                k === idx ? "bg-primary" : v.selected ? "bg-primary/50" : "bg-muted-foreground/30 hover:bg-muted-foreground/60"
              )}
              onClick={() => setI(k)}
              title={`${v.name}${v.angle ? t(" — {angle}", { angle: v.angle }) : ""}${v.selected ? t(" (selected)") : ""}`}
              aria-label={v.name}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One shot row in Images mode: the shot details + an optional angle hint + the
// render control ("Render still" / "New angle") and this shot's stills carousel.
function StoryboardShot({ s, stills, reloadKey, onView, onToggleStill, onRender, agentBusy }) {
  const t = useT();
  const [angle, setAngle] = useState("");
  const hasStills = stills.length > 0;
  const dlg = s.dialogue && !/\(no dialogue\)/i.test(s.dialogue) ? s.dialogue : null;
  const doRender = () => onRender(s, angle.trim());

  return (
    <li className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary" className="font-mono">{s.id}</Badge>
        <span className="text-muted-foreground">{s.dur}s</span>
        <span className="text-muted-foreground">{s.location}</span>
        <span className="text-muted-foreground">{s.camera}</span>
        {hasStills && <Badge variant="success"><ImageIcon size={11} /> {stills.length}</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <div className="text-sm">{s.summary}</div>
          {dlg && (
            <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Speech size={13} className="mt-0.5 shrink-0" /> {dlg}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !agentBusy) doRender(); }}
              placeholder={hasStills ? t("new angle / variation…") : t("angle (optional)")}
              className="h-8 max-w-[220px] text-xs"
            />
            <Button
              size="sm"
              onClick={doRender}
              disabled={agentBusy}
              title={agentBusy ? t("Agent is busy — wait for the current turn to finish") : hasStills ? t("Generate another take (e.g. a different angle)") : t("Generate a storyboard still for this shot with Nano Banana Pro")}
            >
              {agentBusy ? <Loader2 size={13} className="animate-spin" /> : hasStills ? <RotateCcw size={13} /> : <ImageIcon size={13} />}
              {hasStills ? t("New angle") : t("Render still")}
            </Button>
          </div>
        </div>
        {hasStills && (
          <EpStillRail
            stills={stills}
            reloadKey={reloadKey}
            onView={onView}
            onToggle={(file, selected) => onToggleStill(s.id, file, selected)}
          />
        )}
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- *
 * Episode bundle card                                              *
 * ---------------------------------------------------------------- */

// Pick the still the Seedance clip opens on (start_image), from any of the
// bundle's shot stills. Selecting the current one clears it (toggle).
function FirstFrameModal({ bundle, open, stills, reloadKey, current, onPick, onClose }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ImageIcon size={16} className="text-primary" /> {t("First frame — {id}", { id: bundle.id })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("Choose the still the clip should open on. Seedance uses it as the start image, then animates into the rest of the bundle.")}
        </p>
        {stills.length === 0 ? (
          <Empty>{t("no stills yet — render some in Images mode first.")}</Empty>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {stills.map((st) => {
              const sel = st.file === current;
              return (
                <button
                  key={st.file}
                  type="button"
                  onClick={() => onPick(sel ? null : st)}
                  className={cn(
                    "group relative aspect-video overflow-hidden rounded-md border transition-colors",
                    sel ? "border-primary ring-2 ring-primary/40" : "hover:border-primary/60",
                  )}
                  title={sel ? t("Click to clear") : t("Open on {shotId}", { shotId: st.shotId })}
                >
                  <img src={(st.thumb || st.url) + (reloadKey ? `?v=${reloadKey}` : "")} alt={st.shotId} className="h-full w-full object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-background/80 px-1 font-mono text-[9px]">{st.shotId}</span>
                  {sel && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check size={10} /></span>}
                </button>
              );
            })}
          </div>
        )}
        <DialogFooter>
          {current && <Button variant="ghost" onClick={() => onPick(null)}>{t("Clear first frame")}</Button>}
          <Button variant="outline" onClick={onClose}>{t("Done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Pick the VIDEO STYLE CONTINUITY REFERENCE for a bundle's render: any already-
// rendered generation (from any bundle) whose style/colors/feeling the new clip
// should continue. Selecting the current one clears it (toggle).
function RefVideoModal({ bundle, open, takes, reloadKey, current, onPick, onClose }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Film size={16} className="text-primary" /> {t("Video style continuity reference — {id}", { id: bundle.id })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("Choose an already-generated video whose style, colors, and feeling the new render should continue. It is passed to Seedance as a video reference alongside the image references.")}
        </p>
        {takes.length === 0 ? (
          <Empty>{t("no rendered videos yet — render a bundle first.")}</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {takes.map((tk) => {
              const sel = tk.file === current;
              return (
                <button
                  key={tk.file}
                  type="button"
                  onClick={() => onPick(sel ? null : tk)}
                  className={cn(
                    "group relative aspect-video overflow-hidden rounded-md border transition-colors",
                    sel ? "border-primary ring-2 ring-primary/40" : "hover:border-primary/60",
                  )}
                  title={sel ? t("Click to clear") : t("Use {from} · {name} as the style reference", { from: tk.fromBundle, name: tk.name })}
                >
                  <video src={tk.url + (reloadKey ? `?v=${reloadKey}` : "")} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-background/80 px-1 font-mono text-[9px]">{tk.fromBundle} · {tk.name}</span>
                  {sel && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check size={10} /></span>}
                </button>
              );
            })}
          </div>
        )}
        <DialogFooter>
          {current && <Button variant="ghost" onClick={() => onPick(null)}>{t("Clear style reference")}</Button>}
          <Button variant="outline" onClick={onClose}>{t("Done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Render style selection                                           *
 * ---------------------------------------------------------------- */

// Radix Select items can't carry an empty value, so the "clear" choices use
// client-side sentinels; the API speaks presetId "" (no style) and — per scene
// only — "none" (explicitly style-free while the episode has a style).
const NO_STYLE = "__none";
const EPISODE_STYLE = "__episode";

// Per-scene style pick: defaults to the episode-wide choice, overridable to a
// specific preset or to explicitly no style.
function SceneStyleSelect({ bundleId, style, onSetStyle }) {
  const t = useT();
  const override = style.scenes?.[bundleId] || "";
  const value = override === "none" ? NO_STYLE : override || EPISODE_STYLE;
  const epName = style.presets.find((p) => p.id === style.episode)?.name;
  return (
    <Select
      value={value}
      onValueChange={(v) =>
        onSetStyle(bundleId, v === EPISODE_STYLE ? "" : v === NO_STYLE ? "none" : v)
      }
    >
      <SelectTrigger
        size="sm"
        className={cn("h-7 gap-1.5 px-2 text-xs", value === EPISODE_STYLE && "text-muted-foreground")}
        title={t("Render style for this scene — follows the episode style unless overridden")}
      >
        <Palette size={12} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EPISODE_STYLE}>{t("Episode style")}{epName ? ` (${epName})` : t(" (none)")}</SelectItem>
        <SelectItem value={NO_STYLE}>{t("No style — references only")}</SelectItem>
        {style.presets.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ---------------------------------------------------------------- *
 * Audio reference preview                                          *
 * ---------------------------------------------------------------- */

// One-playing-at-a-time across every preview pill on the page, same rule as
// the genui AudioItem's shared activeClip (a row of voice refs should never
// overlap). The <audio> element is only built on the first tap.
let activePreview = null;

function useAudioPreview(src) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(
    () => () => {
      const el = ref.current;
      if (!el) return;
      el.pause();
      if (activePreview === el) activePreview = null;
    },
    []
  );

  const toggle = () => {
    let el = ref.current;
    if (!el) {
      el = new Audio(src);
      el.preload = "auto";
      el.addEventListener("timeupdate", () => {
        if (el.duration) setProgress(el.currentTime / el.duration);
      });
      el.addEventListener("play", () => {
        if (activePreview && activePreview !== el) activePreview.pause();
        activePreview = el;
        setPlaying(true);
      });
      el.addEventListener("pause", () => setPlaying(false));
      el.addEventListener("ended", () => {
        el.currentTime = 0;
        setProgress(0);
      });
      ref.current = el;
    }
    if (el.paused) el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  return { playing, progress, toggle };
}

// A compact play/pause pill for one selected voice reference — the "simple
// play button" gesture, so the author can preview a voice before rendering.
function AudioRefPlayer({ a }) {
  const t = useT();
  const src = a.url || a.refUrl;
  const { playing, progress, toggle } = useAudioPreview(src);
  if (!src) {
    return (
      <Badge variant="destructive" className="h-7" title={a.rel}>
        <VolumeX size={12} /> {a.label}
      </Badge>
    );
  }
  return (
    <span
      className="relative flex h-7 items-center gap-1.5 overflow-hidden rounded-full border bg-secondary pl-1 pr-2 text-secondary-foreground"
      title={a.rel}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 bg-primary/20 transition-[width] duration-200",
          playing ? "block" : "hidden"
        )}
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? "Pause" : "Play"} ${a.label}`}
        className={cn(
          "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          playing
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-card text-foreground hover:bg-accent/60"
        )}
      >
        {playing ? <Pause size={10} /> : <Play size={10} className="translate-x-px" />}
      </button>
      <span className="relative z-10 flex min-w-0 items-center gap-1 text-xs">
        <span className="truncate">{a.label}</span>
        {a.order && a.order.length > 1 && (
          <em className="shrink-0 not-italic text-muted-foreground">({a.order.map((n, i) => `${i + 1}=${n}`).join(", ")})</em>
        )}
      </span>
    </span>
  );
}

function EpisodeBundle({ b, flat, picked, onOpenPicker, onRemove, onView, audioMap, audioPicked, onOpenAudio, vids, allVideos, reloadKey, onToggleVideo, stills, onToggleStill, firstFrame, onSetFirstFrame, refVideo, onSetRefVideo, override, onEditPrompt, onResetPrompt, signoff, onSign, needsState, onLinkNeed, style, onSetStyle, productionType }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [ffOpen, setFfOpen] = useState(false);
  const [rvOpen, setRvOpen] = useState(false);
  const [renderErr, setRenderErr] = useState(null);
  const signedCount = signoff ? ["images", "prompt", "audio"].filter((k) => signoff[k]).length : 0;
  const fullySigned = signedCount === 3;
  const hasVid = Array.isArray(vids) && vids.length > 0;
  // Storyboard (Images) vs Video mode. Default to Video when takes already exist
  // (don't hide finished work), else Images — the storyboard step comes first.
  const [mode, setMode] = useState(() => (hasVid ? "video" : "images"));
  const isImg = mode === "images";
  const stillsFor = (shotId) => (stills && stills[shotId]) || [];
  const stillCount = stills ? Object.values(stills).reduce((n, arr) => n + (arr?.length || 0), 0) : 0;
  const edited = typeof override === "string";
  const assigned = [...picked].map((rel) => flat.get(rel)).filter(Boolean);
  const audioAssigned = [...audioPicked].map((rel) => audioMap.get(rel)).filter(Boolean);

  // Live scene-needs state, recomputed from the optimistic picks.
  const ns = useMemo(
    () => computeNeeds(needsState, picked, audioPicked, audioMap),
    [needsState, picked, audioPicked, audioMap]
  );
  const needAll = ns ? [...ns.needs, ...ns.voice] : [];
  const needDone = needAll.filter((x) => x.fulfilled).length;
  const needsComplete = !ns || !ns.enforced || needDone === needAll.length;

  const refBlock = assigned.length
    ? "IMAGE REFERENCES (pass each file as an image_references entry):\n" +
      assigned.map((im) => `- ${refLabel(im.rel)}: ${im.abs || im.rel}`).join("\n")
    : "IMAGE REFERENCES: (none selected yet — use “choose character and location refs” above)";
  const audioBlock = audioAssigned.length
    ? "\n\nVOICE / SOUND REFERENCES (pass as the audio reference — voice identity, NOT dialogue):\n" +
      audioAssigned
        .map(
          (a) =>
            `- ${a.label}: ${a.refUrl || a.abs || a.url || a.rel}` +
            (a.order && a.order.length > 1
              ? ` — voices appear in this order: ${a.order.map((n, i) => `${i + 1}=${n}`).join(", ")}`
              : "")
        )
        .join("\n")
    : "";
  // The chosen video style continuity reference: an already-rendered generation
  // (from any bundle) the new clip should match in style/colors/feeling. Its
  // ungated refUrl is what the model can fetch (video_references).
  const allTakes = Object.entries(allVideos || {}).flatMap(([bid, arr]) =>
    (arr || []).map((t) => ({ ...t, fromBundle: bid }))
  );
  const refVideoTake = refVideo?.file ? allTakes.find((t) => t.file === refVideo.file) : null;
  const refVideoUrl = refVideoTake?.refUrl || null;

  const videoBlock = refVideoUrl
    ? "\n\nVIDEO STYLE CONTINUITY REFERENCE (pass as a video_references entry):\n" +
      `- ${refVideoTake.fromBundle} · ${refVideoTake.name}: ${refVideoUrl}\n` +
      "This is a video reference for you to continue — keep its video style, colors, and feeling so our new generation has continuity."
    : "";
  const bodyPrompt = edited ? override : b.skillPrompt;
  const fullPrefix = refBlock + audioBlock + videoBlock + "\n\n";
  const displayPrompt = fullPrefix + bodyPrompt;

  // The chosen first frame: a still the Seedance clip opens on (start_image). Its
  // ungated refUrl is what the model can fetch. Flatten all the bundle's stills
  // (across its shots) so any of them can be the opener.
  const allStills = b.shots.flatMap((s) => stillsFor(s.id).map((t) => ({ ...t, shotId: s.id })));
  const firstFrameTake = firstFrame?.file ? allStills.find((t) => t.file === firstFrame.file) : null;
  const firstFrameRefUrl = firstFrameTake?.refUrl || null;

  // Drive the shared studio agent to render this bundle once its revision is
  // signed off (generate-multishot skill → Higgsfield → attach_episode_video) —
  // same as asking it in chat.
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const requestRender = async () => {
    setRenderErr(null);
    try {
      await agent.send({ message: renderEpisodeMessage(b, displayPrompt, firstFrameRefUrl, refVideoUrl) });
    } catch (e) {
      setRenderErr(String(e.message || e));
    }
  };
  // Storyboard: generate a still for one shot (optionally a specific angle) or
  // for every shot in the bundle. Reuses the composed image-reference block so
  // the agent locks the same character/location refs as the video render.
  const requestStill = async (shot, angle) => {
    setRenderErr(null);
    try {
      await agent.send({ message: renderStoryboardMessage(b, shot, refBlock, angle) });
    } catch (e) {
      setRenderErr(String(e.message || e));
    }
  };
  const requestAllStills = async () => {
    setRenderErr(null);
    try {
      await agent.send({ message: renderStoryboardAllMessage(b, refBlock) });
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
          <ProductionTypeBadge value={productionType} />
          <Badge variant="outline">{b.shots.length} {t("shots")}</Badge>
          <Badge variant={b.durationEst > 15 ? "warning" : "muted"}>~{b.durationEst}s → {b.duration}s</Badge>
          {assigned.length > 0 && <Badge variant="success">{assigned.length} {t("refs")}</Badge>}
          {isImg
            ? stillCount > 0 && <Badge variant="success"><ImageIcon size={11} /> {stillCount} {t("stills")}</Badge>
            : hasVid && <Badge variant="success"><Play size={11} fill="currentColor" /> {vids.length} {t("rendered")}</Badge>}

          <SceneStyleSelect bundleId={b.id} style={style} onSetStyle={onSetStyle} />

          {/* Images (storyboard) vs Video (Seedance) mode for this bundle */}
          <div className="flex items-center rounded-md border p-0.5">
            <Button variant={isImg ? "default" : "ghost"} size="sm" className="h-7 gap-1.5 px-2.5" onClick={() => setMode("images")} title={t("Storyboard stills (Nano Banana Pro)")}>
              <ImageIcon size={13} /> {t("Images")}
            </Button>
            <Button variant={!isImg ? "default" : "ghost"} size="sm" className="h-7 gap-1.5 px-2.5" onClick={() => setMode("video")} title={t("Seedance video render")}>
              <Play size={11} fill="currentColor" /> {t("Video")}
            </Button>
          </div>

          {isImg ? (
            <Button
              size="sm"
              onClick={requestAllStills}
              disabled={agentBusy}
              title={agentBusy ? t("Agent is busy — wait for the current turn to finish") : t("Generate a storyboard still for every shot in this bundle")}
            >
              {agentBusy ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />} {t("Render all stills")}
            </Button>
          ) : (
            <>
              {ns && ns.enforced && needAll.length > 0 && (
                <Badge
                  variant={needsComplete ? "success" : "warning"}
                  title={needsComplete ? t("every scene need is covered by a reference") : t("signing unlocks when every scene need is covered")}
                >
                  {needsComplete && <Check size={11} />} {t("needs {done}/{total}", { done: needDone, total: needAll.length })}
                </Badge>
              )}
              {signedCount === 3 ? (
                <Badge variant="success"><Check size={11} /> {t("signed")}</Badge>
              ) : signedCount > 0 ? (
                <Badge variant="warning">{signedCount}/3 {t("signed")}</Badge>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFfOpen(true)}
                disabled={allStills.length === 0}
                title={allStills.length === 0 ? t("Render some stills first — a first frame is one of them") : t("Choose the frame the clip opens on (Seedance start_image)")}
              >
                {firstFrameTake ? (
                  <img src={(firstFrameTake.thumb || firstFrameTake.url) + (reloadKey ? `?v=${reloadKey}` : "")} alt={t("first frame")} className="h-4 w-7 rounded-sm border object-cover" />
                ) : (
                  <ImageIcon size={13} />
                )}
                {t("First frame")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRvOpen(true)}
                disabled={allTakes.length === 0}
                title={allTakes.length === 0 ? t("Render a bundle first — the style reference is one of the generated videos") : t("Choose a generated video whose style, colors, and feeling this render should continue (video reference)")}
              >
                {refVideoTake ? <Check size={13} className="text-primary" /> : <Film size={13} />}
                {t("Style ref")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSignOpen(true)} title={t("revision signing")}>
                <PenLine size={13} /> {t("revision signing")}
              </Button>
              <Button
                size="sm"
                onClick={requestRender}
                disabled={!fullySigned || agentBusy}
                title={
                  !fullySigned
                    ? t("Sign off images, prompt, and audio before rendering")
                    : agentBusy
                    ? t("Agent is busy — wait for the current turn to finish")
                    : t("Render this bundle with Seedance via the studio agent")
                }
              >
                {agentBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {t("Render")}
              </Button>
            </>
          )}
          {renderErr && <span className="w-full text-xs text-destructive">{renderErr}</span>}
        </div>
      </CardHeader>

      <CardContent className={cn("grid gap-4 p-4", !isImg && hasVid && "lg:grid-cols-[2fr_1fr]")}>
        <div className="min-w-0 space-y-4">
          {ns ? (
            <NeedsChecklist ns={ns} />
          ) : (
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide">{t("scene needs:")}</span>{" "}
              {[
                ...(b.images || []).map((im) => im.key),
                ...(b.speakers || []).map((n) => `${n} ${t("(voice)")}`),
              ].join(" · ") || t("nothing detected — rebuild the plan after writing the shot list")}
            </div>
          )}

          <div className="space-y-3">
            {assigned.length === 0 ? (
              <Empty>{t("no references chosen for this shot")}</Empty>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {assigned.map((im) => {
                  // What this reference covers: the need whose World sheet it IS
                  // (auto), or the need the user linked it to.
                  const autoNeed = ns?.needs.find((n) => n.sheetRel && n.sheetRel === im.rel);
                  const linkedNeed = !autoNeed && ns?.needs.find((n) => n.link === im.rel);
                  return (
                    <figure key={im.rel} className="relative overflow-hidden rounded-lg border border-primary bg-muted ring-1 ring-primary/40">
                      <button className="block w-full" onClick={() => onView({ url: im.display || im.url, name: im.rel, role: "reference" })}>
                        <img src={im.thumb || im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
                      </button>
                      <Button
                        variant="destructive" size="icon-xs"
                        className="absolute right-1.5 top-1.5 rounded-full opacity-90"
                        title={t("remove from this shot")} aria-label={t("remove from this shot")}
                        onClick={() => onRemove(b.id, im)}
                      >
                        <X size={13} />
                      </Button>
                      {ns?.enforced && (autoNeed ? (
                        <div className="flex items-center gap-1 truncate px-2 pt-1 text-[11px] text-emerald-500" title={t("This is the World sheet for this need")}>
                          <Check size={11} className="shrink-0" /> {autoNeed.key}
                        </div>
                      ) : (
                        <select
                          className="mx-1.5 mt-1 h-6 w-[calc(100%-12px)] truncate rounded border bg-background px-1 text-[11px] text-muted-foreground"
                          value={linkedNeed?.id || ""}
                          aria-label={t("Scene need covered by {name}", { name: im.name })}
                          title={t("Link this reference to the scene need it covers")}
                          onChange={(e) => {
                            const next = e.target.value || null;
                            if (linkedNeed && linkedNeed.id !== next) onLinkNeed(b.id, linkedNeed.id, null);
                            if (next) onLinkNeed(b.id, next, im.rel);
                          }}
                        >
                          <option value="">{t("covers…")}</option>
                          {ns.needs.map((n) => (
                            <option key={n.id} value={n.id}>{n.key}</option>
                          ))}
                        </select>
                      ))}
                      <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">{im.name}</figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => onOpenPicker(b)}>
              <Plus size={14} /> {t("choose character and location refs")}
            </Button>
          </div>

          {!isImg && (
            <div className="flex flex-wrap items-center gap-2">
              {audioAssigned.length === 0 ? (
                <Empty>{t("no voice reference chosen")}</Empty>
              ) : (
                audioAssigned.map((a) => (
                  <AudioRefPlayer key={a.rel} a={a} />
                ))
              )}
              <Button variant="outline" size="sm" onClick={() => onOpenAudio(b)}>
                <Volume2 size={14} /> {t("choose audio references")}
              </Button>
            </div>
          )}

          {isImg ? (
            <ol className="space-y-2">
              {b.shots.map((s) => (
                <StoryboardShot
                  key={s.id}
                  s={s}
                  stills={stillsFor(s.id)}
                  reloadKey={reloadKey}
                  onView={onView}
                  onToggleStill={(shotId, file, selected) => onToggleStill(b.id, shotId, file, selected)}
                  onRender={requestStill}
                  agentBusy={agentBusy}
                />
              ))}
            </ol>
          ) : (
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
          )}

          {!isImg && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("skill prompt — click to edit, auto-saves")}
                  {edited ? (
                    <Badge variant="warning"><Pencil size={11} /> {t("edited")}</Badge>
                  ) : (
                    <Badge variant="success">{t("live")}</Badge>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {edited && (
                    <Button variant="outline" size="sm" onClick={() => onResetPrompt(b.id)} title={t("discard edits, return to the auto-composed prompt")}>
                      <RotateCcw size={13} /> {t("reset to live")}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} title={t("open the full-screen prompt editor")}>
                    <Maximize2 size={13} /> {t("edit")}
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
                title={t("click to open the full-screen editor")}
              />
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen((o) => !o)}>
                {open ? <><ChevronUp size={13} /> {t("collapse")}</> : <><ChevronDown size={13} /> {t("expand prompt")}</>}
              </Button>
            </div>
          )}
        </div>

        {!isImg && hasVid && (
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
        ns={ns}
        open={signOpen}
        onSign={onSign}
        onClose={() => setSignOpen(false)}
      />
      <FirstFrameModal
        bundle={b}
        open={ffOpen}
        stills={allStills}
        reloadKey={reloadKey}
        current={firstFrame?.file || null}
        onPick={(tk) => { onSetFirstFrame(b.id, tk?.shotId || null, tk?.file || null); setFfOpen(false); }}
        onClose={() => setFfOpen(false)}
      />
      <RefVideoModal
        bundle={b}
        open={rvOpen}
        takes={allTakes}
        reloadKey={reloadKey}
        current={refVideo?.file || null}
        onPick={(tk) => { onSetRefVideo(b.id, tk?.fromBundle || null, tk?.file || null); setRvOpen(false); }}
        onClose={() => setRvOpen(false)}
      />
    </Card>
  );
}

function AudioPickerModal({ bundle, audioRefs, picked, voiceNeeds, open, onToggle, onLinkNeed, onClose }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[min(94vw,640px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            {t("Voice / sound references")}
            <Badge variant="secondary" className="font-mono">{bundle.id}</Badge>
            <span className="font-normal text-muted-foreground">{bundle.beatTitle}</span>
          </DialogTitle>
          {voiceNeeds && voiceNeeds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t("speakers")}</span>
              {voiceNeeds.map((v) => (
                <NeedChip key={v.id} role="voice" label={v.name} fulfilled={v.fulfilled}
                  title={v.fulfilled ? t("voice reference chosen") : t("pick a reference below, then tell it which speaker it is the voice of")} />
              ))}
            </div>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {audioRefs.length === 0 ? (
            <div className="space-y-3 py-6 text-center">
              <Empty>
                {t("no voice or sound references yet — every rendered Sound Studio take shows up here, and a voice cast to a character on the Radio tab arrives already matched to its speaker.")}
              </Empty>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate("/sounds?new=voice")}>
                  <Plus size={13} /> {t("Create a voice")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/radio")}>
                  <Volume2 size={13} /> {t("Cast voices")}
                </Button>
              </div>
            </div>
          ) : audioRefs.map((a) => {
            const on = picked.has(a.rel);
            // Which speaker this ref is standing in for. A ref that names its
            // characters (a cast world voice, a legacy combined clip) covers
            // them on its own; anything else — an uncast Sound Studio take —
            // needs the author to say who it is, exactly like an image need.
            const names = a.order?.length ? a.order : a.character ? [a.character] : [];
            const linkedNeed = voiceNeeds?.find((v) => v.link === a.rel) || null;
            const showLink = on && names.length === 0 && voiceNeeds?.length > 0;
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
                  title={on ? t("remove from this shot") : t("use in this shot")}
                  onClick={() => onToggle(bundle.id, a.rel, !on)}
                >
                  <IconSwap active={on} on={<Check size={14} />} off={<Plus size={14} />} />
                </Button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {a.label}
                    {a.source === "sounds" && (
                      <Badge variant="muted" title={t("from the Sound Studio")}>{t(a.kind || "sound")}</Badge>
                    )}
                    {!a.exists && <Badge variant="destructive">{t("missing file")}</Badge>}
                  </div>
                  {a.order && a.order.length > 1 && (
                    <div className="text-xs text-muted-foreground">{t("voice order:")} {a.order.map((n, i) => `${i + 1}=${n}`).join(", ")}</div>
                  )}
                  <audio controls preload="none" src={a.url} />
                  {showLink && (
                    <select
                      className="h-7 max-w-full truncate rounded border bg-background px-1 text-xs text-muted-foreground"
                      value={linkedNeed?.id || ""}
                      aria-label={t("Speaker voiced by {name}", { name: a.label })}
                      title={t("Say which speaker this reference is the voice of")}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        if (linkedNeed && linkedNeed.id !== next) onLinkNeed(bundle.id, linkedNeed.id, null);
                        if (next) onLinkNeed(bundle.id, next, a.rel);
                      }}
                    >
                      <option value="">{t("is the voice of…")}</option>
                      {voiceNeeds.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The dynamic build surface shown while the shot list is still being generated
// one ~15s multishot pass at a time: one row per pack the current shots yield,
// a per-pack build button for the ones without an episode card yet, and a
// "Build all (n)" shortcut. The single whole-plan button only appears once the
// shot list is complete.
function PackBuildList({ packs, rebuilding, onBuild }) {
  const t = useT();
  const unbuilt = packs.filter((p) => !p.built);
  return (
    <div className="w-full space-y-2">
      <div className="divide-y rounded-md border">
        {packs.map((p) => (
          <div key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <Badge variant="outline" className="font-mono">{p.id}</Badge>
            <span className="min-w-0 flex-1 truncate">
              {p.beatTitle || p.beat}
              <span className="ml-2 text-xs text-muted-foreground">
                {p.from}–{p.to} · {p.count} {p.count === 1 ? t("shot") : t("shots")} · ~{p.durationEst}s
              </span>
            </span>
            {p.built ? (
              <Badge variant="success">{t("built")}</Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBuild([p.id], p.id)}
                disabled={!!rebuilding}
                title={t("Build the episode card for {id} only", { id: p.id })}
              >
                {rebuilding === p.id ? <Loader2 size={13} className="animate-spin" /> : <Boxes size={13} />} {t("build")}
              </Button>
            )}
          </div>
        ))}
      </div>
      {unbuilt.length > 1 && (
        <Button
          className="w-full"
          onClick={() => onBuild(unbuilt.map((p) => p.id), "rest")}
          disabled={!!rebuilding}
        >
          {rebuilding === "rest"
            ? <><Loader2 size={14} className="animate-spin" /> {t("building…")}</>
            : <><Boxes size={14} /> {t("Build all ({n})", { n: unbuilt.length })}</>}
        </Button>
      )}
    </div>
  );
}

function Episode({ reloadKey, onView }) {
  const t = useT();
  // The 4-endpoint payload comes from the loader (swr paints the cache instantly
  // on a revisit). We mirror it into local slices so the many optimistic
  // mutations below can update the UI immediately; a following revalidate
  // reconciles with the server.
  const payload = useLoaderData(); // { ep, lib, fn, au }
  useRevalidateOnMount("episode");
  const setsFrom = (obj) => { const m = {}; for (const [k, v] of Object.entries(obj || {})) m[k] = new Set(v); return m; };
  const [data, setData] = useState(payload.ep.episode);
  const [folders, setFolders] = useState(payload.lib.folders || []);
  const [picks, setPicks] = useState(setsFrom(payload.fn.episode));
  const [error, setError] = useState(null); // mutation errors (loads use the route ErrorBoundary)
  const [confirm, setConfirm] = useState(null);
  const [pickerBundle, setPickerBundle] = useState(null);
  const [audioRefs, setAudioRefs] = useState(payload.au.audio || []);
  const [audioPicks, setAudioPicks] = useState(setsFrom(payload.au.episode));
  const [audioPicker, setAudioPicker] = useState(null);
  const [videos, setVideos] = useState(payload.ep.video || {});
  const [prompts, setPrompts] = useState(payload.ep.prompts || {});
  const [signoffs, setSignoffs] = useState(payload.ep.signoffs || {});
  const [stills, setStills] = useState(payload.st?.stills || {}); // { bundle: { shot: [takes] } }
  const [firstFrames, setFirstFrames] = useState(payload.ep.firstFrames || {}); // { bundle: { shot, file } }
  const [refVideos, setRefVideos] = useState(payload.ep.refVideos || {}); // { bundle: { from, file } }
  const [needsMap, setNeedsMap] = useState(payload.ep.needs || {}); // { bundle: scene-needs state }
  const [style, setStyle] = useState(payload.ep.style || { episode: "", scenes: {}, presets: [] });
  // Which <=15s packs the current shot list yields + whether the list is
  // complete — drives the dynamic build button while shots are still being
  // generated one ~15s pass at a time on the Shot list tab.
  const [shotlist, setShotlist] = useState(payload.ep.shotlist || { complete: false, packs: [] });
  // A project property, not a manifest one, so it sits beside `episode` in the
  // response rather than inside it.
  const [productionType, setProductionType] = useState(payload.ep.productionType);
  const promptTimers = useRef({});
  const agent = useAgent();

  // Apply one fetched payload to every state slice.
  const applyPayload = useCallback(({ ep, lib, fn, au, st }) => {
    setData(ep.episode);
    setVideos(ep.video || {});
    setPrompts(ep.prompts || {});
    setSignoffs(ep.signoffs || {});
    setStills(st?.stills || {});
    setFirstFrames(ep.firstFrames || {});
    setRefVideos(ep.refVideos || {});
    setNeedsMap(ep.needs || {});
    setStyle(ep.style || { episode: "", scenes: {}, presets: [] });
    setShotlist(ep.shotlist || { complete: false, packs: [] });
    setProductionType(ep.productionType);
    setFolders(lib.folders || []);
    const m = {};
    for (const [k, v] of Object.entries(fn.episode || {})) m[k] = new Set(v);
    setPicks(m);
    setAudioRefs(au.audio || []);
    const am = {};
    for (const [k, v] of Object.entries(au.episode || {})) am[k] = new Set(v);
    setAudioPicks(am);
  }, []);

  // Adopt fresh loader data whenever it changes — mount and every revalidation
  // (SSE firehose, Refresh, project switch, agent-turn below).
  useEffect(() => { applyPayload(payload); }, [payload, applyPayload]);

  // After the agent finishes a turn it may have created a trim take, attached a
  // render, or changed a selection → refetch so new cards appear without a manual
  // Refresh. (The SSE firehose also covers this; a double revalidate is harmless.)
  useRevalidateOnAgentIdle("episode", agent.status);

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

  // Pick one still take for a shot (single-selection per shot, like video).
  const onToggleStill = useCallback((bundle, shot, file, selected) => {
    setStills((all) => {
      const bag = { ...(all[bundle] || {}) };
      const arr = (bag[shot] || []).map((g) =>
        g.file === file ? { ...g, selected } : selected ? { ...g, selected: false } : g
      );
      bag[shot] = arr;
      return { ...all, [bundle]: bag };
    });
    fetch("/api/storyboard/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, shot, file, selected }),
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

  // Returns an error string on failure (the SigningModal shows it) — the sign
  // endpoint 409s when a gated section's scene needs aren't covered yet.
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
      return null;
    } catch (e) {
      return String(e.message || e);
    }
  }, []);

  // Link (or unlink) one chosen reference to a scene need — an image need
  // ("character:Kid") or a speaker's voice ("voice:Trini"), which share the one
  // link map. Optimistic on the needs slice; the worker stores it in
  // db.needLinks[bundle][needId].
  const onLinkNeed = useCallback(async (bundle, need, rel) => {
    setNeedsMap((m) => {
      const st = m[bundle];
      if (!st) return m;
      const relink = (n) => (n.id === need ? { ...n, link: rel || null } : n);
      return { ...m, [bundle]: { ...st, needs: (st.needs || []).map(relink), voice: (st.voice || []).map(relink) } };
    });
    try {
      await fetch("/api/episode/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, need, rel }),
      });
    } catch {
      /* keep optimistic state */
    }
  }, []);

  // null when idle, "all" for the episode-wide run, or a beat id ("B1") for a
  // beat-scoped run — one run at a time either way.
  const [assigning, setAssigning] = useState(null);
  // null when idle, else the key of the build button that was pressed ("all",
  // "rest", or a pack id) — so the spinner shows only on that button.
  const [rebuilding, setRebuilding] = useState(null);
  const { revalidate } = useRevalidator();

  // MediaPicker → bundle picks. Library items carry a rel already; a Visual
  // World generation or a fresh upload is first imported into the asset library
  // (episode picks are library rels) and then assigned. Items tagged with a
  // `need` in the picker get linked to it.
  const onPickerAdd = useCallback(async (items) => {
    const bundle = pickerBundle?.id;
    if (!bundle) return;
    let imported = false;
    for (const item of items || []) {
      let rel = item.rel || null;
      try {
        if (!rel && item.source === "generation" && item.genId) {
          const r = await fetch("/api/visual-world/save-to-library", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.genId, folder: "episode-refs" }),
          }).then((x) => x.json());
          if (r.error) throw new Error(r.error);
          rel = r.rel;
          imported = true;
        } else if (!rel && item.source === "upload" && item.refUrl) {
          const key = decodeURIComponent(new URL(item.refUrl, window.location.origin).pathname.replace(/^\/files\//, ""));
          const r = await fetch("/api/library/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, folder: "episode-refs" }),
          }).then((x) => x.json());
          if (r.error) throw new Error(r.error);
          rel = r.rel;
          imported = true;
        }
      } catch (e) {
        setError(String(e.message || e));
        continue;
      }
      if (!rel) continue;
      await setPick(bundle, rel, true);
      if (item.need) await onLinkNeed(bundle, item.need, rel);
    }
    // Imports added new library rels — refetch so `flat` can resolve them.
    if (imported) {
      invalidateTabCache("episode");
      revalidate();
    }
  }, [pickerBundle, setPick, onLinkNeed, revalidate]);

  // Choose (or clear) a bundle's video first frame — the still the Seedance clip
  // opens on (start_image). Optimistic; persisted to db.episodeFirstFrame.
  const onSetFirstFrame = useCallback(async (bundle, shot, file) => {
    setFirstFrames((f) => {
      const next = { ...f };
      if (file) next[bundle] = { shot: shot || null, file };
      else delete next[bundle];
      return next;
    });
    try {
      await fetch("/api/episode/first-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, shot: shot || null, file: file || null }),
      });
    } catch (e) { setError(String(e.message || e)); }
  }, []);

  // Choose (or clear) a bundle's video style continuity reference — an already-
  // rendered generation (from any bundle) the new clip should match in style/
  // colors/feeling. Optimistic; persisted to db.episodeRefVideo.
  const onSetRefVideo = useCallback(async (bundle, from, file) => {
    setRefVideos((r) => {
      const next = { ...r };
      if (file) next[bundle] = { from: from || null, file };
      else delete next[bundle];
      return next;
    });
    try {
      await fetch("/api/episode/ref-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, from: from || null, file: file || null }),
      });
    } catch (e) { setError(String(e.message || e)); }
  }, []);

  // Re-pack the current shot list into bundles (Phase 0). The server preserves
  // stills (re-keyed by shot id) and renders; re-packed bundles need re-review.
  // No `ids` = full rebuild; an array of pack ids builds just those cards (the
  // server never drops existing ones); [] refreshes existing coverage only.
  // `key` names the button that shows the spinner.
  const rebuild = useCallback(async (ids, key = "all") => {
    setRebuilding(key);
    setError(null);
    try {
      const res = await fetch("/api/episode/rebuild", {
        method: "POST",
        ...(Array.isArray(ids) && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundles: ids }),
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "Rebuild failed");
      invalidateTabCache("episode");
      revalidate();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRebuilding(null);
    }
  }, [revalidate]);
  // Choose the render style — episode-wide (bundle null) or a per-scene
  // override. `presetId` speaks the API's language: a visual-world preset id,
  // "" to clear, or "none" (scene only) for explicitly style-free. Optimistic
  // on the style slice, then a revalidate pulls the re-composed skillPrompts
  // (the STYLE line is assembled server-side at read time).
  const onSetStyle = useCallback(async (bundle, presetId) => {
    setStyle((s) => {
      if (!bundle) return { ...s, episode: presetId };
      const scenes = { ...s.scenes };
      if (presetId) scenes[bundle] = presetId;
      else delete scenes[bundle];
      return { ...s, scenes };
    });
    try {
      const res = await fetch("/api/episode/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle: bundle || null, presetId }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "Style change failed");
      invalidateTabCache("episode");
      revalidate();
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [revalidate]);

  // Auto-assign refs + voice picks; pass a beat id to scope the run to that
  // beat's bundles (everything else keeps its picks), omit for the whole episode.
  const autoAssign = useCallback(async (beat) => {
    setAssigning(beat || "all");
    try {
      const res = await fetch("/api/episode/auto-assign", {
        method: "POST",
        ...(beat && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beat }),
        }),
      });
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
      setAssigning(null);
    }
  }, []);

  // Consecutive bundles of the same beat, for the per-beat header rows.
  const beatGroups = useMemo(() => {
    const groups = [];
    for (const b of data?.bundles || []) {
      const last = groups[groups.length - 1];
      if (last && last.beat === b.beat) last.bundles.push(b);
      else groups.push({ beat: b.beat, beatTitle: b.beatTitle, bundles: [b] });
    }
    return groups;
  }, [data]);

  // Packs the current shot list yields that have no episode card yet — offered
  // as one-click builds while the shot list is still in progress.
  const unbuiltPacks = useMemo(() => (shotlist.packs || []).filter((p) => !p.built), [shotlist]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) {
    // No plan yet. What we offer depends on the shot list: nothing without
    // shots; per-pack builds while the list is still being generated pass by
    // pass; the single whole-plan button only once the list is complete.
    if (!shotlist.packs.length)
      return (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Empty>{t("No shot list yet — generate shots on the Shot list tab first.")}</Empty>
        </div>
      );
    if (!shotlist.complete)
      return (
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 py-16">
          <Empty>{t("No episode plan yet — the shot list is still in progress. Build a card for each ~15s multishot pass as it lands, or generate the rest of the shots first.")}</Empty>
          <PackBuildList packs={shotlist.packs} rebuilding={rebuilding} onBuild={rebuild} />
        </div>
      );
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Empty>{t("No episode plan yet — pack the current shot list into ≤15s bundles to begin.")}</Empty>
        <Button onClick={() => rebuild()} disabled={!!rebuilding}>
          {rebuilding === "all" ? <><Loader2 size={14} className="animate-spin" /> {t("building…")}</> : <><Boxes size={14} /> {t("Build episode plan")}</>}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{data.title}</h2>
          <div className="flex items-center gap-2">
            <ProductionTypeBadge value={productionType} long />
            <Select
              value={style.episode || NO_STYLE}
              onValueChange={(v) => onSetStyle(null, v === NO_STYLE ? "" : v)}
            >
              <SelectTrigger
                size="sm"
                title={t("Render style prepended to every scene's prompt — each scene can override it on its card")}
              >
                <Palette size={14} />
                <SelectValue placeholder={t("Style")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_STYLE}>{t("No style — references only")}</SelectItem>
                {style.presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              // While the shot list is still in progress, `[]` re-packs only
              // the cards already built — new passes are added from the strip
              // below, not swept in by a header click.
              onClick={() => rebuild(shotlist.complete ? undefined : [])}
              disabled={!!rebuilding}
              title={shotlist.complete
                ? t("Re-pack the current shot list into bundles (stills & renders are preserved; re-packed bundles need re-review)")
                : t("Re-pack the already-built cards from the current shot list — new multishot passes are built from the list below")}
            >
              {rebuilding === "all" ? <><Loader2 size={14} className="animate-spin" /> {t("rebuilding…")}</> : <><Boxes size={14} /> {t("rebuild plan")}</>}
            </Button>
            <Button onClick={() => autoAssign()} disabled={!!assigning || selCount === 0}>
              {assigning === "all" ? <><Loader2 size={14} className="animate-spin" /> {t("assigning…")}</> : <><Sparkles size={14} /> {t("auto-assign references")}</>}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{data.bundles.length} {t("multishot bundles")}</Badge>
          <Badge variant="outline">{data.totalShots} {t("shots total")}</Badge>
          {!shotlist.complete && <Badge variant="warning">{t("shot list in progress")}</Badge>}
          <Badge variant="success">{selCount} {t("library-selected refs")}</Badge>
          <span>{t("auto-assign matches your library picks to each shot by character + location")}</span>
        </div>
        {!shotlist.complete && unbuiltPacks.length > 0 && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <div className="text-xs text-muted-foreground">
              {unbuiltPacks.length === 1
                ? t("A new multishot pass is ready to build:")
                : t("{n} new multishot passes are ready to build:", { n: unbuiltPacks.length })}
            </div>
            <PackBuildList packs={unbuiltPacks} rebuilding={rebuilding} onBuild={rebuild} />
          </div>
        )}
      </div>

      <div className="space-y-6">
        {beatGroups.map((g) => (
          <div key={g.beat} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">{g.beat}</Badge>
                <span className="text-sm font-medium">{g.beatTitle}</span>
                <span className="text-xs text-muted-foreground">
                  {g.bundles.length} {g.bundles.length === 1 ? t("bundle") : t("bundles")}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => autoAssign(g.beat)}
                disabled={!!assigning || selCount === 0}
                title={t("Auto-assign references + voice picks for {beat} only — other beats keep their picks", { beat: g.beat })}
              >
                {assigning === g.beat ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t("auto-assign {beat}", { beat: g.beat })}
              </Button>
            </div>
            {g.bundles.map((b) => (
              <EpisodeBundle
                key={b.id}
                b={b}
                productionType={productionType}
                flat={flat}
                picked={picks[b.id] || new Set()}
                onOpenPicker={setPickerBundle}
                onRemove={onRemove}
                onView={onView}
                audioMap={audioMap}
                audioPicked={audioPicks[b.id] || new Set()}
                onOpenAudio={setAudioPicker}
                vids={videos[b.id] || []}
                allVideos={videos}
                reloadKey={reloadKey}
                onToggleVideo={onToggleVideo}
                stills={stills[b.id] || {}}
                onToggleStill={onToggleStill}
                firstFrame={firstFrames[b.id]}
                onSetFirstFrame={onSetFirstFrame}
                refVideo={refVideos[b.id]}
                onSetRefVideo={onSetRefVideo}
                override={prompts[b.id]}
                onEditPrompt={onEditPrompt}
                onResetPrompt={onResetPrompt}
                signoff={signoffs[b.id]}
                onSign={onSign}
                needsState={needsMap[b.id]}
                onLinkNeed={onLinkNeed}
                style={style}
                onSetStyle={onSetStyle}
              />
            ))}
          </div>
        ))}
      </div>

      {audioPicker && (
        <AudioPickerModal
          bundle={audioPicker}
          audioRefs={audioRefs}
          picked={audioPicks[audioPicker.id] || new Set()}
          voiceNeeds={
            computeNeeds(
              needsMap[audioPicker.id],
              picks[audioPicker.id] || new Set(),
              audioPicks[audioPicker.id] || new Set(),
              audioMap
            )?.voice || null
          }
          open={!!audioPicker}
          onToggle={onAudioToggle}
          onLinkNeed={onLinkNeed}
          onClose={() => setAudioPicker(null)}
        />
      )}

      {pickerBundle && (
        <MediaPicker
          open={!!pickerBundle}
          onOpenChange={(o) => !o && setPickerBundle(null)}
          onAdd={onPickerAdd}
          title={`References — ${pickerBundle.id} · ${pickerBundle.beatTitle}`}
          needs={
            computeNeeds(
              needsMap[pickerBundle.id],
              picks[pickerBundle.id] || new Set(),
              audioPicks[pickerBundle.id] || new Set(),
              audioMap
            )?.needs || null
          }
        />
      )}

      <ConfirmModal
        open={!!confirm}
        title={t("Remove reference from this shot?")}
        message={confirm ? t("\"{name}\" will no longer be used to generate {bundle}.", { name: confirm.f.name, bundle: confirm.bundle }) : ""}
        confirmLabel={t("Remove from shot")}
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
 * Shot list (granular shots → auto-packed ≤15s multishots)         *
 * ---------------------------------------------------------------- */

// Loader: the episode plan + library + final selection + audio refs, in one
// Promise.all (mirrors the old 4-endpoint mount fetch). reloadKey still flows
// from the shell for the EpVideoRail <video> ?v= cache-bust.
export function loader() {
  return swr("episode", async () => {
    const [ep, lib, fn, au, st] = await Promise.all([
      fetch("/api/episode").then((r) => r.json()),
      fetch("/api/library").then((r) => r.json()),
      fetch("/api/final").then((r) => r.json()),
      fetch("/api/audio").then((r) => r.json()),
      fetch("/api/storyboard").then((r) => r.json()),
    ]);
    if (ep.error) throw new Error(ep.error);
    return { ep, lib, fn, au, st };
  });
}

export { Episode };

export function Component() {
  const { reloadKey, setModalImage } = useShell();
  return <Episode reloadKey={reloadKey} onView={setModalImage} />;
}
