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
  MapPin, CircleAlert, Sparkles, Users, ExternalLink, ImagePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy, renderAnimaticSceneMessage, renderLocationSheetsMessage } from "@/components/AgentProvider";
import { useShell } from "@/lib/shellContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  // The banner's state is DERIVED, not stored: "Add in World" only exists while
  // some gap slug is missing from the roster; once every slug is a roster card
  // the button gives way to "Generate images", and once every card has art the
  // banner disappears. No "was it clicked" flag to persist or get stale.
  const locGaps = (data.locations || []).filter((l) => !l.hasSheet);
  const unknownLocs = locGaps.filter((l) => !l.known);
  const hasShots = scenes.length > 0;
  // "Add in World" wrapper toggle: also have the agent generate the sheets.
  const [genImages, setGenImages] = useState(true);

  // Seed a roster card for every slug that isn't on the World roster yet.
  // POST /api/world/location is read-modify-write, so create them SEQUENTIALLY;
  // parallel writes would race and drop all but one.
  const seedRoster = async (missing) => {
    for (const l of missing) {
      await fetch("/api/world/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: l.slug, name: l.name || l.slug }),
      });
    }
  };

  // "Add in World": seed the missing roster cards, then either hand off to the
  // agent to generate every gap's reference sheet (toggle on) or jump to the
  // World Locations panel to link art by hand (toggle off).
  const addLocationsInWorld = async () => {
    const missing = unknownLocs;
    if (missing.length) {
      setAddingLocs(true);
      try {
        await seedRoster(missing);
        invalidateTabCache("world"); // so the World tab's loader fetches the new cards
        invalidateTabCache("animatic"); // so the gap badges flip from "not in roster" to "no art"
        revalidator.revalidate();
      } catch {
        /* best-effort — the World tab still lets them add places by hand */
      } finally {
        setAddingLocs(false);
      }
    }
    if (genImages) {
      agent.send({ message: renderLocationSheetsMessage(locGaps) }).catch(() => {});
    } else {
      navigate("/world#locations");
    }
  };

  // Once every gap slug is on the roster, the remaining work is pictures only.
  const generateLocationImages = () => {
    agent.send({ message: renderLocationSheetsMessage(locGaps) }).catch(() => {});
  };

  // Scene-scoped version of the same pass: seed this scene's unknown slugs, then
  // have the agent generate sheets for just the places its shots film at.
  const prepSceneLocations = async (scene, locs) => {
    const missing = locs.filter((l) => !l.known);
    if (missing.length) {
      setAddingLocs(true);
      try {
        await seedRoster(missing);
        invalidateTabCache("world");
        invalidateTabCache("animatic");
        revalidator.revalidate();
      } catch {
        /* best-effort */
      } finally {
        setAddingLocs(false);
      }
    }
    const sheetless = locs.filter((l) => !l.hasSheet);
    if (!sheetless.length) return;
    agent.send({ message: renderLocationSheetsMessage(sheetless, scene.beatTitle || scene.beat) }).catch(() => {});
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

      {/* Locations pass — nudge to give each place reference art. Two stages,
          derived from the roster itself: slugs not on the roster yet get the
          "Add in World" group (with the agent-generation toggle); once all are
          roster cards, only the picture gap remains and the button becomes
          "Generate images". */}
      {locGaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <MapPin size={15} className="text-amber-500" />
          <span className="text-muted-foreground">
            {locGaps.length} location{locGaps.length > 1 ? "s" : ""} used by your shots {locGaps.length > 1 ? "have" : "has"} no reference art —
            stills will drift without a locked background.
          </span>
          <div className="flex flex-wrap gap-1">
            {locGaps.slice(0, 8).map((l) => (
              <Badge key={l.slug} variant="outline" className="font-mono text-[10px]" title={l.known ? "On the World roster — no reference art yet" : "Not in the World roster"}>
                <span className={cn("h-1.5 w-1.5 rounded-full", l.known ? "bg-amber-500" : "bg-red-500")} />
                {l.slug}
              </Badge>
            ))}
            {locGaps.length > 8 && <Badge variant="outline" className="text-[10px]">+{locGaps.length - 8}</Badge>}
          </div>
          {unknownLocs.length > 0 ? (
            <div className="ml-auto flex items-center gap-2 rounded-lg border bg-muted/50 p-1">
              <Button
                size="sm"
                variant="outline"
                onClick={addLocationsInWorld}
                disabled={addingLocs || (genImages && agentBusy)}
                title={genImages
                  ? (agentBusy ? "The agent is busy — wait for it to finish" : "Add the missing places to the World roster, then have the agent generate each one's reference sheet (you pick the reference image in chat)")
                  : "Add the missing places to the World roster and open it to link art by hand"}
              >
                {addingLocs
                  ? <><Loader2 size={13} className="animate-spin" /> adding…</>
                  : <><ExternalLink size={13} /> Add in World</>}
              </Button>
              <label className="flex cursor-pointer items-center gap-2 pr-1.5 text-xs select-none" title="When on, the agent generates each added location's reference sheet after adding">
                <span className="text-muted-foreground">Generate images</span>
                <Switch checked={genImages} onCheckedChange={setGenImages} disabled={addingLocs} />
              </label>
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={generateLocationImages}
                disabled={agentBusy}
                title={agentBusy ? "The agent is busy — wait for it to finish" : "Have the agent generate a reference sheet for each of these places — you pick the reference image in chat"}
              >
                <ImagePlus size={13} /> Generate {locGaps.length} image{locGaps.length > 1 ? "s" : ""}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate("/world#locations")} title="Open the World roster to link reference art by hand">
                <ExternalLink size={13} /> Open in World
              </Button>
            </div>
          )}
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
            // This scene's location batch: the unique places its shots film at,
            // each with the two readiness facts (on the roster? has art?).
            const locs = [...new Map(
              scene.shots.map((s) => s.refs?.location).filter(Boolean).map((l) => [l.slug, l]),
            ).values()];
            const locsMissingRoster = locs.filter((l) => !l.known);
            const locsMissingArt = locs.filter((l) => l.known && !l.hasSheet);
            const locsOk = locsMissingRoster.length === 0 && locsMissingArt.length === 0;
            const locProblems = [
              locsMissingRoster.length ? `${locsMissingRoster.map((l) => l.slug).join(", ")} not in the World roster` : null,
              locsMissingArt.length ? `${locsMissingArt.map((l) => l.slug).join(", ")} without reference art` : null,
            ].filter(Boolean).join("; ");
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
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {locs.map((l) => (
                      <Badge
                        key={l.slug}
                        variant="outline"
                        className="hidden font-mono text-[10px] md:inline-flex"
                        title={l.hasSheet ? "Location reference art in place" : l.known ? "On the World roster — no reference art yet" : "Not in the World roster"}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", l.hasSheet ? "bg-emerald-500" : l.known ? "bg-amber-500" : "bg-red-500")} />
                        {l.slug}
                      </Badge>
                    ))}
                    <Badge variant={withStill === scene.shots.length ? "success" : "muted"}>
                      {withStill}/{scene.shots.length} stills
                    </Badge>
                    {!locsOk && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => prepSceneLocations(scene, locs)}
                        disabled={agentBusy || addingLocs}
                        title="Set up this scene's locations: add missing ones to the World roster and have the agent generate their reference sheets"
                      >
                        <MapPin size={13} /> Generate locations
                      </Button>
                    )}
                    {/* Red/green readiness lives on the Render button itself:
                        primary (emerald) when every location is set up, tinted
                        outline when the backgrounds would render unlocked. */}
                    <Button
                      size="sm"
                      variant={locsOk ? "default" : "outline"}
                      className={cn(
                        !locsOk && (locsMissingRoster.length
                          ? "border-red-500/40 text-red-400 hover:text-red-300"
                          : "border-amber-500/40 text-amber-500 hover:text-amber-400"),
                      )}
                      onClick={() => renderScene(scene)}
                      disabled={agentBusy || renderable === 0}
                      title={renderable === 0
                        ? "No shot in this scene belongs to a bundle — rebuild the episode plan first"
                        : locsOk
                          ? "Generate a still for every shot in this scene"
                          : `Locations not ready — ${locProblems}. Stills would render without a locked background.`}
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
