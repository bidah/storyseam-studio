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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tip, Empty, Panel, Spinner, ErrorNote } from "@/components/shared";
import { useT, t as staticT } from "@/lib/i18n";

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
  const t = useT();
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
          .map((v) => ({ trackId: t.id, v: v.v, name: t.name || v.name || t("Untitled voice"), url: v.url })),
      );
    const term = q.trim().toLowerCase();
    return term ? all.filter((o) => o.name.toLowerCase().includes(term)) : all;
  }, [tracks, q, t]);

  const pick = (o) => { onCast(character, { trackId: o.trackId, v: o.v, name: o.name, url: o.url }); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("Cast a voice for ")}<Badge variant="secondary" className="font-mono">{character}</Badge>
          </DialogTitle>
        </DialogHeader>

        {voiceRef && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-2.5">
            <Badge variant="success" className="gap-1"><Check size={11} /> {t("Casted")}</Badge>
            <span className="text-sm font-medium">{voiceRef.name || t("Voice")}{voiceRef.v != null && <span className="text-muted-foreground">{t(" · v{version}", { version: voiceRef.v })}</span>}</span>
            {source === "world" && <Badge variant="muted" className="text-[10px]">{t("from World")}</Badge>}
            {voiceRef.url && <audio controls src={voiceRef.url} preload="none" className="h-8 max-w-[220px]" />}
            <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => onCast(character, null)}>
              <X size={14} /> {t("Clear")}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {t("Your liked voices from the Sound Studio — like a voice take on the Sounds tab to see it here.")}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Tip content={agentBusy ? t("The agent is busy — wait for it to finish") : t("Ask the agent to design, render, and cast a voice for {character}", { character })}>
              <Button
                variant="secondary"
                size="sm"
                disabled={agentBusy}
                onClick={() => { onAgentCast(character); onOpenChange(false); }}
              >
                <Bot size={13} /> {t("Voice with agent")}
              </Button>
            </Tip>
            <Button variant="outline" size="sm" onClick={() => navigate("/sounds?new=voice")}>
              <Plus size={13} /> {t("Create voice")}
            </Button>
          </div>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search liked voices…")} className="h-8 text-sm" />
        {error && <ErrorNote>{error}</ErrorNote>}
        {tracks === null && !error ? (
          <div className="py-10"><Spinner /></div>
        ) : voices.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>{t("no liked voices yet — generate a voice on the Sounds tab and tap the heart to like a take, or create one now.")}</Empty>
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
                    {active ? <><Check size={13} /> {t("Cast")}</> : t("Select")}
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
  const t = useT();
  const { character, voiceRef } = entry;
  return (
    <>
      <Tip content={voiceRef ? `${voiceRef.name || t("Voice")}${voiceRef.v != null ? t(" · v{version}", { version: voiceRef.v }) : ""}` : t("No voice cast — click to cast")}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <Badge variant="secondary" className="min-w-0 max-w-full truncate font-mono">{character}</Badge>
        {voiceRef ? (
          <Badge variant="success" className="ml-auto shrink-0 gap-1"><Check size={11} /> {t("Casted")}</Badge>
        ) : (
          <Badge variant="warning" className="ml-auto shrink-0 gap-1"><Mic size={11} /> {t("Cast")}</Badge>
        )}
      </button>
      </Tip>
      <CastingDialog open={open} onOpenChange={setOpen} entry={entry} onCast={onCast} onAgentCast={onAgentCast} agentBusy={agentBusy} />
    </>
  );
}

/* ---------------------------------------------------------------- *
 * Line — inline-editable speaker + text, with its rendered take.    *
 * ---------------------------------------------------------------- */

function RadioLine({ line, onSaveLine, onRecreate, onSelectVersion, agentBusy }) {
  const t = useT();
  const [speaker, setSpeaker] = useState(line.character || "");
  const [text, setText] = useState(line.text || "");
  useEffect(() => { setSpeaker(line.character || ""); }, [line.character]);
  useEffect(() => { setText(line.text || ""); }, [line.text]);
  const take = line.take;
  const takes = line.takes || [];

  const commit = (patch) => onSaveLine(line.id, patch);
  const field = "rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-primary focus:bg-background focus:outline-none";
  const recreateLabel = takes.length ? t("Recreate take") : t("Render take");

  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">{t("shot {id}", { id: line.shotId })}</Badge>
        <input
          className={cn(field, "w-32 font-semibold")}
          value={speaker}
          placeholder={t("Speaker")}
          onChange={(e) => setSpeaker(e.target.value)}
          onBlur={() => speaker !== (line.character || "") && commit({ character: speaker })}
        />
        {line.voiceRef ? (
          <Badge variant="success" className="gap-1 text-[10px]"><Mic size={10} /> {line.voiceRef.name || t("voice")}</Badge>
        ) : (
          <Badge variant="warning" className="gap-1 text-[10px]"><CircleAlert size={10} /> {t("no voice")}</Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {take?.ready ? (
            <audio controls src={take.url} preload="none" className="h-8 w-[220px]" />
          ) : take && take.status !== "missing" ? (
            <Badge variant="info" className="gap-1"><Loader2 size={10} className="animate-spin" /> {take.status}</Badge>
          ) : (
            <Badge variant="muted">{t("not rendered")}</Badge>
          )}
          <DropdownMenu>
            <Tip content={t("Line actions")}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" aria-label={t("Line actions")}>
                  <MoreVertical size={15} />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={agentBusy || !line.voiceRef}
                onClick={() => onRecreate?.()}
                title={!line.voiceRef ? t("Cast a voice for this speaker first") : agentBusy ? t("The agent is busy") : undefined}
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
        placeholder={t("Dialogue line")}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== (line.text || "") && commit({ text })}
      />
      {takes.length > 1 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("takes")}</span>
          {takes.map((tk, i) => (
            <Tip
              key={`${tk.trackId}:${tk.v}`}
              content={
                tk.status === "missing" ? t("This take's audio is gone")
                  : tk.selected ? t("The active take")
                  : tk.ready ? t("Use take {n}", { n: i + 1 })
                  : t("take {n} — {status}", { n: i + 1, status: tk.status })
              }
            >
            <button
              type="button"
              disabled={tk.selected || tk.status === "missing"}
              onClick={() => onSelectVersion?.(tk)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                tk.selected && "border-primary bg-primary/10 text-primary",
                tk.status === "missing" && "text-muted-foreground line-through",
                !tk.ready && tk.status !== "missing" && "opacity-70",
              )}
            >
              {tk.selected && <Check size={11} />}
              {!tk.ready && tk.status !== "missing" && <Loader2 size={10} className="animate-spin" />}
              v{i + 1}
            </button>
            </Tip>
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
  const t = useT();
  const agentBusy = agentIsBusy(agent);
  const data = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  useRevalidateOnMount("radio");
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [pacing, setPacing] = useState(false);
  const [pacingOn, setPacingOnState] = useState(() => {
    try { return localStorage.getItem("radioAgentPacing") !== "off"; } catch { return true; }
  });
  const setPacingOn = (on) => {
    setPacingOnState(on);
    try { localStorage.setItem("radioAgentPacing", on ? "on" : "off"); } catch { /* ignore */ }
  };
  const [renderingScene, setRenderingScene] = useState(null);
  useEffect(() => { if (!agentBusy) setRenderingScene(null); }, [agentBusy]);
  const sceneKey = (s) => `${s.beat}:${s.lines[0].id}`;

  const revalidate = revalidator.revalidate;
  const refetch = useCallback(() => {
    invalidateTabCache("radio");
    revalidate();
  }, [revalidate]);

  useRevalidateOnAgentIdle("radio", agent.status);

  const mutate = useCallback(async (path, body) => {
    setError(null);
    try {
      const res = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t("Save failed"));
      refetch();
    } catch (e) { setError(String(e.message || e)); }
  }, [refetch, t]);

  const cast = (character, voiceRef) => mutate("/api/radio/casting", { character, voiceRef });
  const saveLine = (id, patch) => mutate(`/api/radio/line/${encodeURIComponent(id)}`, patch);

  const selectVersion = useCallback(async (id, take) => {
    setError(null);
    try {
      const res = await fetch(`/api/radio/take/${encodeURIComponent(id)}/select`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: take.trackId, v: take.v, selected: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t("Select failed"));
      refetch();
    } catch (e) { setError(String(e.message || e)); }
  }, [refetch, t]);

  const renderScene = (scene) => {
    setRenderingScene(sceneKey(scene));
    agent.send({ message: renderRadioSceneMessage(scene, scene.lines) }).catch(() => setRenderingScene(null));
  };

  const recreateLine = (scene, line) => agent.send({ message: recreateRadioLineMessage(scene, line) }).catch(() => {});

  const voiceWithAgent = useCallback(
    (characters) => { agent.send({ message: castVoiceMessage(characters) }).catch(() => {}); },
    [agent],
  );

  const sendToEditor = async () => {
    setSending(true); setError(null);
    try {
      const res = await fetch("/api/radio/to-editor", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("Send failed"));
      navigate("/editor");
    } catch (e) { setError(String(e.message || e)); }
    finally { setSending(false); }
  };

  const sendToEditorPaced = async () => {
    setPacing(true); setError(null);
    try {
      const res = await fetch("/api/radio/to-editor", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("Send failed"));
      agent.send({ message: paceRadioTimelineMessage() }).catch(() => {});
      navigate("/editor");
    } catch (e) { setError(String(e.message || e)); }
    finally { setPacing(false); }
  };

  const scenes = data.scenes || [];
  const casting = data.casting || [];
  const uncastNames = casting.filter((c) => !c.voiceRef).map((c) => c.character);
  const uncast = uncastNames.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <RadioIcon size={18} className="text-primary" /> {t("Radio version")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("The audio-only pass — every line is voiced here, rendered, and sent to the Editor.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tip content={pacingOn
              ? (agentBusy
                  ? t("The agent is busy — wait for it to finish")
                  : t("Send to the Editor, then have the agent pace it: space the lines from the shot timings so the story breathes"))
              : t("Send just the voiced dialogue to the Editor as an audio-only timeline (lines laid back-to-back)")}>
              <Button variant="outline" onClick={pacingOn ? sendToEditorPaced : sendToEditor}
                disabled={sending || pacing || (pacingOn && agentBusy) || !data.readyLines}>
                {(sending || pacing)
                  ? <><Loader2 size={14} className="animate-spin" /> {t("sending…")}</>
                  : <><Send size={14} /> {t("Send to editor")}</>}
              </Button>
            </Tip>
            <Tip content={t("When on, the agent paces the timeline from the shot timings after sending")}>
              <label className="flex cursor-pointer items-center gap-2 pl-1 pr-2 text-sm select-none">
                <span className="text-muted-foreground">{t("Agent pacing")}</span>
                <Switch checked={pacingOn} onCheckedChange={setPacingOn} disabled={sending || pacing} />
              </label>
            </Tip>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{t("{n} scenes", { n: scenes.length })}</Badge>
          <Badge variant="info"><AudioLines size={11} /> {t("{ready}/{total} lines rendered", { ready: data.readyLines || 0, total: data.totalLines || 0 })}</Badge>
          {uncast > 0 && <Badge variant="warning"><CircleAlert size={11} /> {t("{n} characters without a voice", { n: uncast })}</Badge>}
          {agentBusy && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> {t("agent working…")}</Badge>}
          <span>{t("scenes come from the Shot list; cast a favorited voice per character, render a scene, then send the whole thing to the Editor.")}</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <Empty>{t("no dialogue yet — generate a Shot list with spoken lines first, then cast voices and render here.")}</Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            {scenes.map((scene) => {
              const sceneUncast = scene.lines.some((l) => !l.voiceRef);
              const rendering = agentBusy && renderingScene === sceneKey(scene);
              const sceneRendered = scene.lines.every((l) => l.take);
              return (
                <Panel
                  key={scene.beat + scene.lines[0].id}
                  title={<span className="flex items-center gap-2"><Film size={15} className="text-primary" /> {scene.beatTitle || scene.beat}</span>}
                  meta={
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{t("{n} lines", { n: scene.lines.length })}</Badge>
                      <Tip content={
                        sceneRendered && !rendering ? t("Every line in this scene is rendered")
                          : sceneUncast ? t("Cast a voice for every speaker in this scene first")
                          : agentBusy ? t("The agent is busy — wait for it to finish")
                          : t("Render this scene's dialogue")
                      }>
                        <Button size="sm" onClick={() => renderScene(scene)} disabled={agentBusy || sceneUncast || (sceneRendered && !rendering)}>
                          {rendering ? <><Loader2 size={13} className="animate-spin" /> {t("working…")}</>
                            : sceneRendered ? <><Check size={13} /> {t("Rendered")}</>
                            : <><Mic size={13} /> {t("Render scene")}</>}
                        </Button>
                      </Tip>
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

          <aside className="shrink-0 lg:sticky lg:top-5 lg:w-[340px] lg:self-start lg:max-h-[calc(100dvh-40px)] lg:overflow-y-auto">
            <Panel title={<span className="flex items-center gap-2"><Mic size={15} className="text-primary" /> {t("Casting")}</span>} meta={<Badge variant="outline">{casting.length}</Badge>}>
              {casting.length === 0 ? (
                <Empty>{t("no speaking characters yet — add a voice on the World tab, or write a shot list with spoken lines.")}</Empty>
              ) : (
                <div className="space-y-1.5">
                  {casting.map((entry) => <CastingCard key={entry.character} entry={entry} onCast={cast} onAgentCast={voiceWithAgent} agentBusy={agentBusy} />)}
                </div>
              )}
              {uncast > 0 && (
                <div className="mt-2">
                  <Tip
                    wrapClassName="w-full"
                    content={agentBusy ? t("The agent is busy — wait for it to finish") : t("Ask the agent to design, render, and cast a voice for all {n} uncast speakers", { n: uncast })}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      disabled={agentBusy}
                      onClick={() => voiceWithAgent(uncastNames)}
                    >
                      {agentBusy ? <><Loader2 size={13} className="animate-spin" /> {t("agent working…")}</> : <><Bot size={13} /> {t("Voice {n} uncast with agent", { n: uncast })}</>}
                    </Button>
                  </Tip>
                </div>
              )}
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                {t("every speaker plus every character with a voice on the World tab. A voice cast here is shared with the World tab — the two never diverge. Cast from your liked Sound Studio voice takes, or let the agent design and cast one.")}
              </p>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}

export function loader() {
  return swr("radio", async () => {
    const res = await fetch("/api/radio");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || staticT("Failed to load"));
    return json;
  });
}

export { RadioStudio };

export function Component() {
  return <RadioStudio />;
}