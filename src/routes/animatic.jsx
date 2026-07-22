// Animatic tab — the scene-grouped "first-reference" pass. It joins the two
// halves of the episode that never met in one view: each shot's voiced line
// (from Radio) and its storyboard still (from db.stills), grouped by beat so you
// can render, review and iterate the PICTURES that pair with the audio before
// building the watchable cut in the Editor.
//
// "Render Scene" mirrors Radio's per-scene render, but for pictures: it drives
// the generate-storyboard agent for every shot in the scene, auto-supplying each
// shot's character + location reference sheets from the World roster (Phase 1).
// "Send to editor" is the old Build-Animatic (POST /api/animatic/to-editor),
// moved here off the Radio tab.
import { useCallback, useEffect, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import {
  Clapperboard, Film, Send, Loader2, Image as ImageIcon, AudioLines,
  MapPin, CircleAlert, Sparkles, Users, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy, renderAnimaticSceneMessage } from "@/components/AgentProvider";
import { useShell } from "@/lib/shellContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, Panel, ErrorNote } from "@/components/shared";

/* ---------------------------------------------------------------- *
 * One shot's picture cell — still thumbnail or slate placeholder.   *
 * ---------------------------------------------------------------- */

function ShotCell({ shot, reloadKey, onView }) {
  const loc = shot.refs?.location;
  const still = shot.still;
  return (
    <div className="flex flex-col gap-1.5">
      {still ? (
        <button
          type="button"
          onClick={() => onView({ url: still.url + (reloadKey ? `?v=${reloadKey}` : ""), name: `${shot.id} · ${shot.action || ""}`, role: "storyboard" })}
          className="group relative aspect-video overflow-hidden rounded-md border bg-muted transition-colors hover:border-primary/60"
          title="View full still"
        >
          <img
            src={still.url + (reloadKey ? `?v=${reloadKey}` : "")}
            loading="lazy"
            alt={shot.action || shot.id}
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 text-muted-foreground">
          <Clapperboard size={16} />
          <span className="text-[10px]">no still yet</span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="font-mono text-[10px]">{shot.id}</Badge>
        {shot.voiced ? (
          <span title="Line voiced" className="text-primary"><AudioLines size={12} /></span>
        ) : shot.dialogue && !/\(no dialogue\)/i.test(shot.dialogue) ? (
          <span title="Has dialogue, not voiced yet" className="text-muted-foreground/60"><AudioLines size={12} /></span>
        ) : null}
        {!shot.bundle && (
          <span title="This shot is in no bundle — rebuild the episode plan" className="text-amber-500"><CircleAlert size={12} /></span>
        )}
      </div>
      {loc && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground" title={loc.known ? (loc.hasSheet ? "Location has reference art" : "Location has no reference sheet") : "Location not in the World roster"}>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", loc.hasSheet ? "bg-emerald-500" : loc.known ? "bg-amber-500" : "bg-muted-foreground/40")} />
          <span className="truncate font-mono">{loc.slug}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Route                                                             *
 * ---------------------------------------------------------------- */

function AnimaticStudio() {
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const data = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { setModalImage, reloadKey } = useShell();
  useRevalidateOnMount("animatic");
  useRevalidateOnAgentIdle("animatic", agent.status);

  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [addingLocs, setAddingLocs] = useState(false);
  // Which scene's "Render scene" was launched — so only that button shows "working…".
  const [renderingScene, setRenderingScene] = useState(null);
  useEffect(() => { if (!agentBusy) setRenderingScene(null); }, [agentBusy]);

  const scenes = data.scenes || [];

  const renderScene = (scene) => {
    // Only shots that belong to a bundle can be keyed back via attach_still.
    const renderable = scene.shots.filter((s) => s.bundle);
    if (!renderable.length) return;
    setRenderingScene(scene.beat);
    agent.send({ message: renderAnimaticSceneMessage(scene, renderable) }).catch(() => setRenderingScene(null));
  };

  const sendToEditor = async () => {
    setSending(true); setError(null);
    try {
      const res = await fetch("/api/animatic/to-editor", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Build failed");
      navigate("/editor");
    } catch (e) { setError(String(e.message || e)); }
    finally { setSending(false); }
  };

  // Location coverage: places used by shots that have no reference sheet yet.
  const locGaps = (data.locations || []).filter((l) => !l.hasSheet);
  const hasShots = scenes.length > 0;

  // "Add in World": seed a roster card for every gap slug that isn't on the World
  // roster yet (the `?` badges), then jump to the Locations panel so the user
  // lands on a populated list ready for reference art — instead of an empty one.
  // POST /api/world/location is read-modify-write, so create them SEQUENTIALLY;
  // parallel writes would race and drop all but one.
  const addLocationsInWorld = async () => {
    const missing = locGaps.filter((l) => !l.known);
    if (missing.length) {
      setAddingLocs(true);
      try {
        for (const l of missing) {
          await fetch("/api/world/location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug: l.slug, name: l.slug }),
          });
        }
        invalidateTabCache("world"); // so the World tab's loader fetches the new cards
      } catch {
        /* best-effort — still take them to the World tab to add places by hand */
      } finally {
        setAddingLocs(false);
      }
    }
    navigate("/world#locations");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Film size={18} className="text-primary" /> Animatic
            </h2>
            <p className="text-sm text-muted-foreground">
              The picture pass — a still for every shot, paired with its voiced line, so the episode can be seen and felt before any video is rendered.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={sendToEditor}
              disabled={sending || !hasShots}
              title={hasShots ? "Build the animatic (stills + voiced lines) and open it in the Editor" : "Write a shot list first"}
            >
              {sending ? <><Loader2 size={14} className="animate-spin" /> building…</> : <><Send size={14} /> Send to editor</>}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{scenes.length} scenes</Badge>
          <Badge variant={data.withStill ? "info" : "muted"}>
            <ImageIcon size={11} /> {data.withStill || 0}/{data.shots || 0} shots with a still
          </Badge>
          {data.voiced > 0 && <Badge variant="info"><AudioLines size={11} /> {data.voiced} voiced</Badge>}
          {data.unmatched > 0 && (
            <Badge variant="warning" title="These shots belong to no bundle — rebuild the episode plan on the Episode tab so they can hold a still.">
              <CircleAlert size={11} /> {data.unmatched} not in any bundle
            </Badge>
          )}
          {agentBusy && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> agent working…</Badge>}
          <span>render each scene's stills, review, then send the whole thing to the Editor.</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Locations pass — nudge to give each place reference art. */}
      {locGaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <MapPin size={15} className="text-amber-500" />
          <span className="text-muted-foreground">
            {locGaps.length} location{locGaps.length > 1 ? "s" : ""} used by your shots {locGaps.length > 1 ? "have" : "has"} no reference art —
            stills will drift without a locked background.
          </span>
          <div className="flex flex-wrap gap-1">
            {locGaps.slice(0, 8).map((l) => (
              <Badge key={l.slug} variant="outline" className="font-mono text-[10px]" title={l.known ? "In the roster, no sheet linked" : "Not in the World roster"}>
                {l.slug}{!l.known ? " ?" : ""}
              </Badge>
            ))}
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={addLocationsInWorld} disabled={addingLocs}>
            {addingLocs
              ? <><Loader2 size={13} className="animate-spin" /> adding…</>
              : <><ExternalLink size={13} /> Add in World</>}
          </Button>
        </div>
      )}

      {!hasShots ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <Empty>no shots yet — write a Shot list first, then render its scenes here.</Empty>
        </div>
      ) : (
        <div className="space-y-4">
          {scenes.map((scene) => {
            const withStill = scene.shots.filter((s) => s.still).length;
            const renderable = scene.shots.filter((s) => s.bundle).length;
            const rendering = agentBusy && renderingScene === scene.beat;
            return (
              <Panel
                key={scene.beat || scene.beatTitle}
                title={
                  <span className="flex items-center gap-2">
                    <Sparkles size={15} className="text-primary" />
                    {scene.beatTitle || scene.beat || "Scene"}
                  </span>
                }
                meta={
                  <div className="flex items-center gap-2">
                    <Badge variant={withStill === scene.shots.length ? "success" : "muted"}>
                      {withStill}/{scene.shots.length} stills
                    </Badge>
                    <Button
                      size="sm"
                      onClick={() => renderScene(scene)}
                      disabled={agentBusy || renderable === 0}
                      title={renderable === 0 ? "No shot in this scene belongs to a bundle — rebuild the episode plan first" : "Generate a still for every shot in this scene"}
                    >
                      {rendering ? <><Loader2 size={13} className="animate-spin" /> rendering…</> : <><ImageIcon size={13} /> Render scene</>}
                    </Button>
                  </div>
                }
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {scene.shots.map((shot) => (
                    <ShotCell key={shot.id} shot={shot} reloadKey={reloadKey} onView={setModalImage} />
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function loader() {
  return swr("animatic", async () => {
    const res = await fetch("/api/animatic/view");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export function Component() { return <AnimaticStudio />; }
