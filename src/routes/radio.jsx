import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import {
  Radio as RadioIcon, Mic, Loader2, Film, Send, X, AudioLines, CircleAlert,
  Clapperboard, Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { useAgent, agentIsBusy, renderRadioSceneMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Panel, Spinner, ErrorNote } from "@/components/shared";

/* ---------------------------------------------------------------- *
 * Voice picker — pick a liked Sound Studio voice for a character.    *
 * Mirrors the World tab's VoicePicker (kind "voice", liked takes).   *
 * ---------------------------------------------------------------- */

const VOICE_RE = /^\s*(@audio\d|use a seed audio voice reference to voice-act)/i;
function isVoiceTrack(t) {
  if (t.kind === "voice") return true;
  if (t.kind === "sfx" || t.kind === "music") return false;
  const v1 = (t.versions || []).find((v) => v.v === 1) || (t.versions || [])[0];
  return VOICE_RE.test(v1?.prompt || "");
}

function VoicePicker({ open, onOpenChange, onPick, character }) {
  const [tracks, setTracks] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTracks(null); setError(null); setQ("");
    fetch("/api/sounds")
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { if (j.error) throw new Error(j.error); setTracks(j.tracks || []); } })
      .catch((e) => { if (!cancelled) setError(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [open]);

  const voices = useMemo(() => {
    const all = (tracks || [])
      .filter(isVoiceTrack)
      .flatMap((t) =>
        (t.versions || [])
          .filter((v) => v.liked && v.url)
          .map((v) => ({ trackId: t.id, v: v.v, name: t.name || v.name || "Untitled voice", url: v.url })),
      );
    const term = q.trim().toLowerCase();
    return term ? all.filter((o) => o.name.toLowerCase().includes(term)) : all;
  }, [tracks, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cast a voice{character ? ` for ${character}` : ""}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Your liked voices from the Sound Studio — like a voice take on the Sounds tab to see it here.
        </p>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search liked voices…" className="h-8 text-sm" />
        {error && <ErrorNote>{error}</ErrorNote>}
        {tracks === null && !error ? (
          <div className="py-10"><Spinner /></div>
        ) : voices.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>no liked voices yet — generate a voice on the Sounds tab and tap the heart to like a take.</Empty>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {voices.map((o) => (
              <div key={`${o.trackId}:${o.v}`} className="flex items-center gap-3 rounded-lg border p-2">
                <Mic size={16} className="shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{o.name} <span className="text-muted-foreground">v{o.v}</span></div>
                  <audio controls src={o.url} preload="none" className="mt-1 h-8 w-full" />
                </div>
                <Button size="sm" className="shrink-0" onClick={() => onPick(o)}>Select</Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Casting row — one character + its cast voice.                     *
 * ---------------------------------------------------------------- */

function CastingRow({ entry, onCast }) {
  const [open, setOpen] = useState(false);
  const { character, voiceRef, source } = entry;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5">
      <Badge variant="secondary" className="font-mono">{character}</Badge>
      {voiceRef ? (
        <>
          <Mic size={15} className="shrink-0 text-primary" />
          <span className="text-sm font-medium">{voiceRef.name || "Voice"}{voiceRef.v != null && <span className="text-muted-foreground"> · v{voiceRef.v}</span>}</span>
          {source === "world" && <Badge variant="muted" className="text-[10px]">from World</Badge>}
          {voiceRef.url && <audio controls src={voiceRef.url} preload="none" className="h-8 max-w-[220px]" />}
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Mic size={13} /> Change</Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => onCast(character, null)}>
              <X size={14} /> Clear
            </Button>
          </div>
        </>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">no voice cast</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setOpen(true)}><Mic size={13} /> Cast voice</Button>
        </>
      )}
      <VoicePicker open={open} onOpenChange={setOpen} character={character}
        onPick={(o) => { onCast(character, { trackId: o.trackId, v: o.v, name: o.name, url: o.url }); setOpen(false); }} />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Line — inline-editable speaker + text, with its rendered take.    *
 * ---------------------------------------------------------------- */

function RadioLine({ line, onSaveLine }) {
  const [speaker, setSpeaker] = useState(line.character || "");
  const [text, setText] = useState(line.text || "");
  useEffect(() => { setSpeaker(line.character || ""); }, [line.character]);
  useEffect(() => { setText(line.text || ""); }, [line.text]);
  const take = line.take;

  const commit = (patch) => onSaveLine(line.id, patch);
  const field = "rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-primary focus:bg-background focus:outline-none";

  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">shot {line.shotId}</Badge>
        <input
          className={cn(field, "w-32 font-semibold")}
          value={speaker}
          placeholder="Speaker"
          onChange={(e) => setSpeaker(e.target.value)}
          onBlur={() => speaker !== (line.character || "") && commit({ character: speaker })}
        />
        {line.voiceRef ? (
          <Badge variant="success" className="gap-1 text-[10px]"><Mic size={10} /> {line.voiceRef.name || "voice"}</Badge>
        ) : (
          <Badge variant="warning" className="gap-1 text-[10px]"><CircleAlert size={10} /> no voice</Badge>
        )}
        <div className="ml-auto">
          {take?.ready ? (
            <audio controls src={take.url} preload="none" className="h-8 w-[220px]" />
          ) : take && take.status !== "missing" ? (
            <Badge variant="info" className="gap-1"><Loader2 size={10} className="animate-spin" /> {take.status}</Badge>
          ) : (
            <Badge variant="muted">not rendered</Badge>
          )}
        </div>
      </div>
      <textarea
        rows={2}
        className={cn(field, "mt-1.5 w-full resize-y")}
        value={text}
        placeholder="Dialogue line"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== (line.text || "") && commit({ text })}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Route                                                             *
 * ---------------------------------------------------------------- */

function RadioStudio() {
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const data = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  useRevalidateOnMount("radio");
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);

  const refetch = useCallback(() => {
    invalidateTabCache("radio");
    revalidator.revalidate();
  }, [revalidator]);

  // The agent just rendered/attached takes → refresh when its turn ends.
  useEffect(() => { if (agent.status === "ready") refetch(); }, [agent.status, refetch]);

  const mutate = useCallback(async (path, body) => {
    setError(null);
    try {
      const res = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      refetch();
    } catch (e) { setError(String(e.message || e)); }
  }, [refetch]);

  const cast = (character, voiceRef) => mutate("/api/radio/casting", { character, voiceRef });
  const saveLine = (id, patch) => mutate(`/api/radio/line/${encodeURIComponent(id)}`, patch);

  const renderScene = (scene) => agent.send({ message: renderRadioSceneMessage(scene, scene.lines) }).catch(() => {});

  const sendToEditor = async () => {
    setSending(true); setError(null);
    try {
      const res = await fetch("/api/radio/to-editor", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Send failed");
      navigate("/editor");
    } catch (e) { setError(String(e.message || e)); }
    finally { setSending(false); }
  };

  // The animatic: this radio pass PLUS each shot's storyboard still on a picture
  // track. Unlike "Send to editor" it covers every shot (silent ones included),
  // so it works — as an all-slate outline — before any still exists.
  const buildAnimatic = async () => {
    setBuilding(true); setError(null);
    try {
      const res = await fetch("/api/animatic/to-editor", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Build failed");
      navigate("/editor");
    } catch (e) { setError(String(e.message || e)); }
    finally { setBuilding(false); }
  };

  const scenes = data.scenes || [];
  const casting = data.casting || [];
  const uncast = casting.filter((c) => !c.voiceRef).length;
  const animatic = data.animatic || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <RadioIcon size={18} className="text-primary" /> Radio version
            </h2>
            <p className="text-sm text-muted-foreground">
              The audio-only pass — every scene's dialogue voiced with each character's cast voice, then sent to the Editor as its own timeline.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={sendToEditor} disabled={sending || building || !data.readyLines}
              title="Send just the voiced dialogue to the Editor as an audio-only timeline">
              {sending ? <><Loader2 size={14} className="animate-spin" /> sending…</> : <><Send size={14} /> Send to editor</>}
            </Button>
            <Button onClick={buildAnimatic} disabled={building || sending || !animatic?.shots}
              title={
                animatic?.shots
                  ? `Build the animatic: ${animatic.shots} shots — ${animatic.withStill} with a still, ${animatic.slates} slate${animatic.slates === 1 ? "" : "s"}`
                  : "Write a shot list first"
              }>
              {building ? <><Loader2 size={14} className="animate-spin" /> building…</> : <><Clapperboard size={14} /> Build animatic</>}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{scenes.length} scenes</Badge>
          <Badge variant="info"><AudioLines size={11} /> {data.readyLines || 0}/{data.totalLines || 0} lines rendered</Badge>
          {animatic?.shots > 0 && (
            <Badge variant={animatic.withStill ? "info" : "muted"}>
              <ImageIcon size={11} /> {animatic.withStill}/{animatic.shots} shots with a still
            </Badge>
          )}
          {uncast > 0 && <Badge variant="warning"><CircleAlert size={11} /> {uncast} character{uncast > 1 ? "s" : ""} without a voice</Badge>}
          {/* A shot that belongs to no bundle can't be matched to a still. In
              practice this means the shot list's ids have drifted away from the
              episode manifest's — show it rather than quietly building slates. */}
          {animatic?.unmatched > 0 && (
            <Badge variant="warning">
              <CircleAlert size={11} /> {animatic.unmatched} shot{animatic.unmatched > 1 ? "s" : ""} not in any bundle
            </Badge>
          )}
          {agentBusy && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> agent working…</Badge>}
          <span>scenes come from the Shot list; cast a favorited voice per character, render a scene, then send the whole thing to the Editor.</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <Empty>no dialogue yet — generate a Shot list with spoken lines first, then cast voices and render here.</Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* Scenes */}
          <div className="min-w-0 flex-1 space-y-4">
            {scenes.map((scene) => {
              const sceneUncast = scene.lines.some((l) => !l.voiceRef);
              return (
                <Panel
                  key={scene.beat + scene.lines[0].id}
                  title={<span className="flex items-center gap-2"><Film size={15} className="text-primary" /> {scene.beatTitle || scene.beat}</span>}
                  meta={
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{scene.lines.length} lines</Badge>
                      <Button size="sm" onClick={() => renderScene(scene)} disabled={agentBusy || sceneUncast}
                        title={sceneUncast ? "Cast a voice for every speaker in this scene first" : "Render this scene's dialogue"}>
                        {agentBusy ? <><Loader2 size={13} className="animate-spin" /> working…</> : <><Mic size={13} /> Render scene</>}
                      </Button>
                    </div>
                  }
                >
                  <div className="space-y-2.5">
                    {scene.lines.map((line) => <RadioLine key={line.id} line={line} onSaveLine={saveLine} />)}
                  </div>
                </Panel>
              );
            })}
          </div>

          {/* Casting rail */}
          <aside className="shrink-0 lg:sticky lg:top-[73px] lg:w-[340px] lg:self-start lg:max-h-[calc(100dvh-92px)] lg:overflow-y-auto">
            <Panel title={<span className="flex items-center gap-2"><Mic size={15} className="text-primary" /> Casting</span>} meta={<Badge variant="outline">{casting.length}</Badge>}>
              {casting.length === 0 ? (
                <Empty>no speaking characters found in the shot list.</Empty>
              ) : (
                <div className="space-y-2">
                  {casting.map((entry) => <CastingRow key={entry.character} entry={entry} onCast={cast} />)}
                </div>
              )}
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                voices are seeded from the World tab (a character's attached voice) and can be overridden here. Cast from your liked Sound Studio voice takes.
              </p>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}

// Loader: the derived radio view (scenes from the shot list + casting + takes),
// plus the animatic's coverage counts (how many shots have a still yet) so the
// build button can say what it will produce. The animatic view is derived from
// the same shot list, so it never disagrees with the scenes below it.
export function loader() {
  return swr("radio", async () => {
    const [radioRes, animaticRes] = await Promise.all([
      fetch("/api/radio"),
      // Coverage is a nice-to-have: a failure here must not break the tab.
      fetch("/api/animatic").catch(() => null),
    ]);
    const json = await radioRes.json();
    if (!radioRes.ok) throw new Error(json.error || "Failed to load");
    let animatic = null;
    if (animaticRes?.ok) animatic = await animaticRes.json().catch(() => null);
    return { ...json, animatic };
  });
}

export { RadioStudio };

export function Component() {
  return <RadioStudio />;
}
