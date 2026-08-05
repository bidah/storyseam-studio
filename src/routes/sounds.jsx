import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { Check, Plus, ChevronDown, ChevronRight, RotateCcw, Volume2, Speech, Copy, Heart, Music, Save, Clock, Download, Trash2, FileText, Loader2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { useT } from "@/lib/i18n";
import { useAgent, agentIsBusy, renderSoundMessage, renderAllPendingMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, Chip, Panel, Spinner, ErrorNote, IconSwap } from "@/components/shared";

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
  const t = useT();
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
    if (window.confirm(t("Delete v{v}?", { v: ver.v })))
      run(() => soundApi(`/api/sounds/${track.id}/version/${ver.v}`, { method: "DELETE" }));
  };

  return (
    <div className={cn("space-y-2.5 rounded-lg border bg-muted/30 p-3", ver.liked && "border-primary/30")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono">v{ver.v}</Badge>
        {ver.name && <span className="text-sm font-medium">{ver.name}</span>}
        {ver.status === "ready" ? (
          <Badge variant="success">{t("ready")}</Badge>
        ) : (
          <Badge variant="warning"><Clock size={11} /> {t("needs render")}</Badge>
        )}
        {ver.duration ? <span className="text-xs text-muted-foreground">{ver.duration.toFixed(1)}s</span> : null}
        <span className="flex-1" />
        {ver.status !== "ready" && (
          <Button
            size="sm"
            onClick={requestRender}
            disabled={agentBusy}
            title={agentBusy ? t("Agent is busy — wait for the current turn to finish") : t("Render this version with Seed Audio via the studio agent")}
          >
            {agentBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {t("Render")}
          </Button>
        )}
        <Button
          variant="ghost" size="icon-sm"
          aria-label={ver.liked ? t("Unlike this version") : t("Like this version")}
          onClick={toggleLike} disabled={busy} title={t("Like")}
        >
          <Heart size={16} fill={ver.liked ? "#e11d48" : "none"} color={ver.liked ? "#e11d48" : "currentColor"} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("Delete this version")} onClick={del} disabled={busy} title={t("Delete version")}>
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
          placeholder={t("new version name (optional)")}
          value={vname}
          onChange={(e) => setVname(e.target.value)}
        />
        <Button size="sm" onClick={saveNewVersion} disabled={busy || !prompt.trim()} title={t("Save the edited prompt as a new version (starts pending)")}>
          <Plus size={13} /> {t("Save as new version")}
        </Button>
        {dirty && (
          <>
            <Button variant="outline" size="sm" onClick={saveInPlace} disabled={busy} title={t("Overwrite this version's prompt (no new version)")}>
              <Save size={13} /> {t("Update v{v}", { v: ver.v })}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPrompt(ver.prompt)} disabled={busy}>
              <RotateCcw size={13} /> {t("Reset")}
            </Button>
          </>
        )}
        <span className="text-xs text-muted-foreground">{t("{n} chars", { n: prompt.length })}</span>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>

      {ver.status === "ready" && ver.url ? (
        <div className="flex items-center gap-3">
          <audio controls src={ver.url} preload="none" className="flex-1" />
          <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={ver.url} download>
            <Download size={13} /> {t("download")}
          </a>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Clock size={13} className="shrink-0" />
          <span className="flex-1">
            {t("Pending — hit")} <span className="font-medium text-foreground">{t("Render")}</span> {t("and the studio agent runs Seed Audio via Higgsfield, then attaches the result here.")}
          </span>
          <Button size="sm" onClick={requestRender} disabled={agentBusy}>
            {agentBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {t("Render")}
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
                        <IconSwap active={open} on={<ChevronDown size={14} />} off={<ChevronRight size={14} />} />
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
            <IconSwap active={copied} on={<Check size={13} />} off={<Copy size={13} />} /> {copied ? "Copied" : "Copy prompt"}
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
  // Tracks store their tab explicitly since the `kind` field landed; older
  // tracks fall back to sniffing the v1 prompt for the builders' fixed lead-ins
  // (fragile — agent-authored prompts rarely match, which is why kind exists).
  if (t.kind === "voice" || t.kind === "sfx" || t.kind === "music") return t.kind;
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
            <IconSwap active={copied} on={<Check size={13} />} off={<Copy size={13} />} /> {copied ? "Copied" : "Copy prompt"}
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
            <IconSwap active={copied} on={<Check size={13} />} off={<Copy size={13} />} /> {copied ? "Copied" : "Copy prompt"}
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

function SoundStudio() {
  const { tracks, bundles } = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("sounds");
  const [error, setError] = useState(null); // createTrack (mutation) error
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep link: `/sounds?new=<kind>` (e.g. the Radio casting modal's "Create
  // voice" button) opens that kind's tab with its builder already expanded.
  const initialNew = searchParams.get("new");
  const [tab, setTab] = useState(
    initialNew === "voice" || initialNew === "sfx" || initialNew === "music" ? initialNew : "music",
  );
  const [showNew, setShowNew] = useState(
    initialNew === "voice" || initialNew === "sfx" || initialNew === "music",
  );
  const [busy, setBusy] = useState(false);
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);

  // Consume the `?new=` param once it has seeded the initial tab/builder, so a
  // refresh or later navigation doesn't keep forcing the builder back open.
  useEffect(() => {
    if (searchParams.has("new")) {
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any track/version mutation (create/rename/delete/like, agent renders) →
  // refetch the sounds loader so the list reflects the change.
  const refetch = () => {
    invalidateTabCache("sounds");
    revalidator.revalidate();
  };

  const createTrack = async ({ name, prompt, kind }) => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await soundApi("/api/sounds", {
        method: "POST",
        body: JSON.stringify({ name, prompt, kind }),
      });
      setShowNew(false);
      refetch();
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
              onCreate={(t) => createTrack({ ...t, kind: "music" })}
              onCancel={() => setShowNew(false)}
            />
          )}
          <TrackList
            loading={false}
            tracks={music}
            emptyText="No background music yet — click “New background music”."
            onChanged={refetch}
          />
        </TabsContent>

        <TabsContent value="sfx" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowNew((s) => !s)}>
              <Plus size={14} /> New sound effect
            </Button>
          </div>
          {showNew && (
            <SfxBuilder
              busy={busy}
              onCreate={(t) => createTrack({ ...t, kind: "sfx" })}
              onCancel={() => setShowNew(false)}
            />
          )}
          <TrackList
            loading={false}
            tracks={sfx}
            emptyText="No sound effects yet — click “New sound effect”."
            onChanged={refetch}
          />
        </TabsContent>

        <TabsContent value="voice" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowNew((s) => !s)}>
              <Plus size={14} /> New voice line
            </Button>
          </div>
          {showNew && (
            <VoiceBuilder
              busy={busy}
              onCreate={(t) => createTrack({ ...t, kind: "voice" })}
              onCancel={() => setShowNew(false)}
            />
          )}
          <TrackList
            loading={false}
            tracks={voice}
            emptyText="No voice lines yet — click “New voice line”."
            onChanged={refetch}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Loader: sound tracks (+ episode bundles, used by the "new music" builder to
// offer per-scene reference). Episode is best-effort — a failure just omits the
// bundle picker, it doesn't fail the tab.
export function loader() {
  return swr("sounds", async () => {
    const [sounds, episode] = await Promise.all([
      soundApi("/api/sounds"),
      soundApi("/api/episode").catch(() => ({})),
    ]);
    return { tracks: sounds.tracks || [], bundles: episode.episode?.bundles || [] };
  });
}

export { SoundStudio };

export function Component() {
  return <SoundStudio />;
}
