import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import {
  Radio as RadioIcon, Mic, Loader2, Film, Send, X, AudioLines, CircleAlert,
  Clapperboard, Image as ImageIcon, Check, Plus, Bot, MoreVertical, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy, renderRadioSceneMessage, recreateRadioLineMessage, castVoiceMessage, paceRadioTimelineMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Empty, Panel, Spinner, ErrorNote } from "@/components/shared";

/* ---------------------------------------------------------------- *
 * Casting dialog — one character's casting surface. Opened from its  *
 * compact card: shows the current cast voice (clearable) plus the    *
 * liked Sound Studio voices to pick from, and a shortcut into the    *
 * Sound Studio to create a brand-new voice.                          *
 * ---------------------------------------------------------------- */

const VOICE_RE = /^\s*(@audio\d|use a seed audio voice reference to voice-act)/i;
function isVoiceTrack(t) {
  if (t.kind === "voice") return true;
  if (t.kind === "sfx" || t.kind === "music") return false;
  const v1 = (t.versions || []).find((v) => v.v === 1) || (t.versions || [])[0];
  return VOICE_RE.test(v1?.prompt || "");
}

function CastingDialog({ open, onOpenChange, onCast, onAgentCast, agentBusy, entry }) {
  const navigate = useNavigate();
  const [tracks, setTracks] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const { character, voiceRef, source } = entry;

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

  const pick = (o) => { onCast(character, { trackId: o.trackId, v: o.v, name: o.name, url: o.url }); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Cast a voice for <Badge variant="secondary" className="font-mono">{character}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Currently cast voice — audio + clear live here, off the compact card. */}
        {voiceRef && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-2.5">
            <Badge variant="success" className="gap-1"><Check size={11} /> Casted</Badge>
            <span className="text-sm font-medium">{voiceRef.name || "Voice"}{voiceRef.v != null && <span className="text-muted-foreground"> · v{voiceRef.v}</span>}</span>
            {source === "world" && <Badge variant="muted" className="text-[10px]">from World</Badge>}
            {voiceRef.url && <audio controls src={voiceRef.url} preload="none" className="h-8 max-w-[220px]" />}
            <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => onCast(character, null)}>
              <X size={14} /> Clear
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Your liked voices from the Sound Studio — like a voice take on the Sounds tab to see it here.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={agentBusy}
              title={agentBusy ? "The agent is busy — wait for it to finish" : `Ask the agent to design, render, and cast a voice for ${character}`}
              onClick={() => { onAgentCast(character); onOpenChange(false); }}
            >
              <Bot size={13} /> Voice with agent
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/sounds?new=voice")}>
              <Plus size={13} /> Create voice
            </Button>
          </div>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search liked voices…" className="h-8 text-sm" />
        {error && <ErrorNote>{error}</ErrorNote>}
        {tracks === null && !error ? (
          <div className="py-10"><Spinner /></div>
        ) : voices.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>no liked voices yet — generate a voice on the Sounds tab and tap the heart to like a take, or create one now.</Empty>
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {voices.map((o) => {
              const active = voiceRef && voiceRef.trackId === o.trackId && voiceRef.v === o.v;
              return (
                <div key={`${o.trackId}:${o.v}`} className={cn("flex items-center gap-3 rounded-lg border p-2", active && "border-primary/60 bg-primary/5")}>
                  <Mic size={16} className="shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.name} <span className="text-muted-foreground">v{o.v}</span></div>
                    <audio controls src={o.url} preload="none" className="mt-1 h-8 w-full" />
                  </div>
                  <Button size="sm" variant={active ? "outline" : "default"} className="shrink-0" onClick={() => pick(o)}>
                    {active ? <><Check size={13} /> Cast</> : "Select"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Casting card — one compact row per character so the whole cast      *
 * fits the sidebar without scrolling. Click anywhere to open the      *
 * casting dialog; the right-hand pill doubles as the status: amber    *
 * "Cast" when unassigned, green "Casted" when a voice is set.         *
 * ---------------------------------------------------------------- */

function CastingCard({ entry, onCast, onAgentCast, agentBusy }) {
  const [open, setOpen] = useState(false);
  const { character, voiceRef } = entry;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={voiceRef ? `${voiceRef.name || "Voice"}${voiceRef.v != null ? ` · v${voiceRef.v}` : ""}` : "No voice cast — click to cast"}
        className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <Badge variant="secondary" className="min-w-0 max-w-full truncate font-mono">{character}</Badge>
        {voiceRef ? (
          <Badge variant="success" className="ml-auto shrink-0 gap-1"><Check size={11} /> Casted</Badge>
        ) : (
          <Badge variant="warning" className="ml-auto shrink-0 gap-1"><Mic size={11} /> Cast</Badge>
        )}
      </button>
      <CastingDialog open={open} onOpenChange={setOpen} entry={entry} onCast={onCast} onAgentCast={onAgentCast} agentBusy={agentBusy} />
    </>
  );
}

/* ---------------------------------------------------------------- *
 * Line — inline-editable speaker + text, with its rendered take.    *
 * ---------------------------------------------------------------- */

function RadioLine({ line, onSaveLine, onRecreate, onSelectVersion, agentBusy }) {
  const [speaker, setSpeaker] = useState(line.character || "");
  const [text, setText] = useState(line.text || "");
  useEffect(() => { setSpeaker(line.character || ""); }, [line.character]);
  useEffect(() => { setText(line.text || ""); }, [line.text]);
  const take = line.take;
  const takes = line.takes || [];

  const commit = (patch) => onSaveLine(line.id, patch);
  const field = "rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-primary focus:bg-background focus:outline-none";
  const recreateLabel = takes.length ? "Recreate take" : "Render take";

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
        <div className="ml-auto flex items-center gap-1.5">
          {take?.ready ? (
            <audio controls src={take.url} preload="none" className="h-8 w-[220px]" />
          ) : take && take.status !== "missing" ? (
            <Badge variant="info" className="gap-1"><Loader2 size={10} className="animate-spin" /> {take.status}</Badge>
          ) : (
            <Badge variant="muted">not rendered</Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" aria-label="Line actions">
                <MoreVertical size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={agentBusy || !line.voiceRef}
                onClick={() => onRecreate?.()}
                title={!line.voiceRef ? "Cast a voice for this speaker first" : agentBusy ? "The agent is busy" : undefined}
              >
                <RotateCcw size={14} /> {recreateLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
      {/* Version pills: pick which rendered take is active (plays here + flows to
          Send to editor / pacing). Only shown once there's more than one take. */}
      {takes.length > 1 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">takes</span>
          {takes.map((t, i) => (
            <button
              key={`${t.trackId}:${t.v}`}
              type="button"
              disabled={t.selected || t.status === "missing"}
              onClick={() => onSelectVersion?.(t)}
              title={t.status === "missing" ? "This take's audio is gone" : t.ready ? `Use take ${i + 1}` : `take ${i + 1} — ${t.status}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                t.selected ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/40 hover:bg-accent/40",
                t.status === "missing" && "text-muted-foreground line-through",
                !t.ready && t.status !== "missing" && "opacity-70",
              )}
            >
              {t.selected && <Check size={11} />}
              {!t.ready && t.status !== "missing" && <Loader2 size={10} className="animate-spin" />}
              v{i + 1}
            </button>
          ))}
        </div>
      )}
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
  const [pacing, setPacing] = useState(false);
  const [building, setBuilding] = useState(false);
  // Which scene's "Render scene" was actually launched — so only THAT button
  // shows "working…". Without this, the global agentBusy flag flips every
  // scene's button to "working…" (even for a single-line recreate), which reads
  // as "Beat 2 started rendering" when it didn't. Cleared when the agent idles.
  const [renderingScene, setRenderingScene] = useState(null);
  useEffect(() => { if (!agentBusy) setRenderingScene(null); }, [agentBusy]);
  const sceneKey = (s) => `${s.beat}:${s.lines[0].id}`;

  const revalidate = revalidator.revalidate;
  const refetch = useCallback(() => {
    invalidateTabCache("radio");
    revalidate();
  }, [revalidate]);

  // The agent just rendered/attached takes → refresh when its turn ends.
  useRevalidateOnAgentIdle("radio", agent.status);

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

  // Pick which rendered take is active for a line (the version pills). POSTs the
  // selection; buildRadioView resolves it as line.take, so Send to editor / pacing
  // / the animatic all follow the pick.
  const selectVersion = useCallback(async (id, take) => {
    setError(null);
    try {
      const res = await fetch(`/api/radio/take/${encodeURIComponent(id)}/select`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: take.trackId, v: take.v, selected: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Select failed");
      refetch();
    } catch (e) { setError(String(e.message || e)); }
  }, [refetch]);

  const renderScene = (scene) => {
    setRenderingScene(sceneKey(scene));
    agent.send({ message: renderRadioSceneMessage(scene, scene.lines) }).catch(() => setRenderingScene(null));
  };

  // Re-voice ONE line — the kebab "Recreate". The new take is appended as another
  // version and auto-selected (worker side); the tab refreshes when the agent idles.
  const recreateLine = (scene, line) => agent.send({ message: recreateRadioLineMessage(scene, line) }).catch(() => {});

  // Delegate casting to the agent: it designs, renders, and casts a voice for
  // one or more speakers, picking the right tool per name (attach_character_voice
  // for a World character, cast_radio_voice for a background speaker).
  const voiceWithAgent = useCallback(
    (characters) => { agent.send({ message: castVoiceMessage(characters) }).catch(() => {}); },
    [agent],
  );

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

  // "Send to editor" + the editorial second pass: build the same gapless
  // timeline first (deterministic, exactly what the plain button does), then
  // hand the agent the pacing brief (radio-pacing skill) and jump to the
  // Editor — the re-timed gaps land live when the agent's turn ends.
  const sendToEditorPaced = async () => {
    setPacing(true); setError(null);
    try {
      const res = await fetch("/api/radio/to-editor", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Send failed");
      agent.send({ message: paceRadioTimelineMessage() }).catch(() => {});
      navigate("/editor");
    } catch (e) { setError(String(e.message || e)); }
    finally { setPacing(false); }
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
  const uncastNames = casting.filter((c) => !c.voiceRef).map((c) => c.character);
  const uncast = uncastNames.length;
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
            <Button variant="outline" onClick={sendToEditor} disabled={sending || pacing || building || !data.readyLines}
              title="Send just the voiced dialogue to the Editor as an audio-only timeline (lines laid back-to-back)">
              {sending ? <><Loader2 size={14} className="animate-spin" /> sending…</> : <><Send size={14} /> Send to editor</>}
            </Button>
            <Button variant="outline" onClick={sendToEditorPaced} disabled={sending || pacing || building || agentBusy || !data.readyLines}
              title={agentBusy
                ? "The agent is busy — wait for it to finish"
                : "Send to the Editor, then have the agent pace it: space the lines from the shot timings so the story breathes"}>
              {pacing ? <><Loader2 size={14} className="animate-spin" /> sending…</> : <><Bot size={14} /> Agent pacing</>}
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
              const rendering = agentBusy && renderingScene === sceneKey(scene);
              // Every line has a rendered take → the scene is done. Disable the
              // button and flip it to "Rendered" so it can't be re-launched.
              const sceneRendered = scene.lines.every((l) => l.take);
              return (
                <Panel
                  key={scene.beat + scene.lines[0].id}
                  title={<span className="flex items-center gap-2"><Film size={15} className="text-primary" /> {scene.beatTitle || scene.beat}</span>}
                  meta={
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{scene.lines.length} lines</Badge>
                      <Button size="sm" onClick={() => renderScene(scene)} disabled={agentBusy || sceneUncast || (sceneRendered && !rendering)}
                        title={
                          sceneRendered && !rendering ? "Every line in this scene is rendered"
                            : sceneUncast ? "Cast a voice for every speaker in this scene first"
                            : "Render this scene's dialogue"
                        }>
                        {rendering ? <><Loader2 size={13} className="animate-spin" /> working…</>
                          : sceneRendered ? <><Check size={13} /> Rendered</>
                          : <><Mic size={13} /> Render scene</>}
                      </Button>
                    </div>
                  }
                >
                  <div className="space-y-2.5">
                    {scene.lines.map((line) => (
                      <RadioLine
                        key={line.id}
                        line={line}
                        onSaveLine={saveLine}
                        onRecreate={() => recreateLine(scene, line)}
                        onSelectVersion={(take) => selectVersion(line.id, take)}
                        agentBusy={agentBusy}
                      />
                    ))}
                  </div>
                </Panel>
              );
            })}
          </div>

          {/* Casting rail */}
          <aside className="shrink-0 lg:sticky lg:top-5 lg:w-[340px] lg:self-start lg:max-h-[calc(100dvh-40px)] lg:overflow-y-auto">
            <Panel title={<span className="flex items-center gap-2"><Mic size={15} className="text-primary" /> Casting</span>} meta={<Badge variant="outline">{casting.length}</Badge>}>
              {casting.length === 0 ? (
                <Empty>no speaking characters yet — add a voice on the World tab, or write a shot list with spoken lines.</Empty>
              ) : (
                <div className="space-y-1.5">
                  {casting.map((entry) => <CastingCard key={entry.character} entry={entry} onCast={cast} onAgentCast={voiceWithAgent} agentBusy={agentBusy} />)}
                </div>
              )}
              {uncast > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2 w-full"
                  disabled={agentBusy}
                  onClick={() => voiceWithAgent(uncastNames)}
                  title={agentBusy ? "The agent is busy — wait for it to finish" : `Ask the agent to design, render, and cast a voice for all ${uncast} uncast speaker${uncast > 1 ? "s" : ""}`}
                >
                  {agentBusy ? <><Loader2 size={13} className="animate-spin" /> agent working…</> : <><Bot size={13} /> Voice {uncast} uncast with agent</>}
                </Button>
              )}
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                every speaker plus every character with a voice on the World tab. A voice cast here is shared with the World tab — the two never diverge. Cast from your liked Sound Studio voice takes, or let the agent design and cast one.
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
