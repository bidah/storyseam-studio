import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { X, RefreshCw, Loader2, Layers, Film } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle, useRevalidateOnAgentTool } from "@/lib/swr";
import { useAgent, agentIsBusy } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Command as CommandPrimitive } from "cmdk";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Empty, Panel, ErrorNote, fmtTime } from "@/components/shared";
import { CAMERA_FRAMINGS, CAMERA_MOVES } from "@/lib/cameraOptions";

// PUT one field of shot :n; returns the fresh shot list + pack preview (or null).
async function saveShotField(n, body) {
  try {
    const res = await fetch(`/api/shotlist/shot/${n}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (res.ok) return json;
  } catch { /* ignore — keeps the typed value */ }
  return null;
}

const fieldCls = (mono) => cn(
  "w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-primary focus:bg-background focus:outline-none",
  mono && "font-mono",
);

// One inline-editable shot field. Saves on blur (only when changed) via
// PUT /api/shotlist/shot/:n and hands the fresh pack preview back up.
function ShotField({ n, field, value, onSaved, multiline, mono, placeholder, rows = 2 }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  const commit = async () => {
    if ((v ?? "") === (value ?? "")) return;
    const body = field === "characters"
      ? { characters: v.split(",").map((x) => x.trim()).filter(Boolean) }
      : field === "dur"
        ? { dur: Number(v) || 0 }
        : { [field]: v };
    const json = await saveShotField(n, body);
    if (json) onSaved?.(json);
  };
  return multiline ? (
    <textarea rows={rows} className={fieldCls(mono)} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={commit} />
  ) : (
    <input className={fieldCls(mono)} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={commit} />
  );
}

// The Camera field: the same inline save-on-blur input, plus an autocomplete
// over the generator's camera vocabulary (framings + 2D-friendly moves).
// A camera value is "framing, move", so suggestions match the segment after
// the LAST comma and picking one replaces only that segment — "Medium
// close-up, slo" completes to "Medium close-up, slow push-in". Free text
// still works; the pick just edits the input, and blur commits as usual.
function CameraField({ n, value, onSaved }) {
  const t = useT();
  const [v, setV] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { setV(value ?? ""); }, [value]);

  const commit = async () => {
    if ((v ?? "") === (value ?? "")) return;
    const json = await saveShotField(n, { camera: v });
    if (json) onSaved?.(json);
  };

  // The segment being typed (after the last comma) drives the filter.
  const lastComma = v.lastIndexOf(",");
  const segment = v.slice(lastComma + 1).trim().toLowerCase();
  const match = (opt) => opt.toLowerCase().includes(segment);
  const framings = CAMERA_FRAMINGS.filter(match);
  const moves = CAMERA_MOVES.filter(match);
  const groups = lastComma === -1
    ? [["Framing / angle", framings], ["Move", moves]]
    : [["Move", moves], ["Framing / angle", framings]];
  const hasMatches = framings.length + moves.length > 0;

  const pick = (opt) => {
    setV(lastComma === -1 ? opt : `${v.slice(0, lastComma + 1)} ${opt}`);
    inputRef.current?.focus();
  };

  return (
    // The cmdk root spans the input AND the (portaled) list so arrow keys /
    // Enter navigate the suggestions while typing stays in the inline field.
    <Command shouldFilter={false} className="overflow-visible bg-transparent">
      <Popover open={open && hasMatches} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <CommandPrimitive.Input
            ref={inputRef}
            className={fieldCls(false)}
            value={v}
            placeholder={t("Medium close-up, slow push-in")}
            aria-label={t("Camera")}
            onValueChange={(nv) => { setV(nv); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => { setOpen(false); commit(); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <CommandList>
            {groups.map(([heading, opts]) => opts.length > 0 && (
              <CommandGroup key={heading} heading={t(heading)}>
                {opts.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    // keep focus in the input so picking doesn't blur-commit mid-edit
                    onMouseDown={(e) => e.preventDefault()}
                    onSelect={() => pick(opt)}
                  >
                    {opt}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}

function ShotList() {
  const t = useT();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const data = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("shotlist");
  const [error, setError] = useState(null);   // rebuild (mutation) error
  const [rebuilding, setRebuilding] = useState(false);
  // Which pack the left rail is filtering the body by (null = show every shot).
  const [activePack, setActivePack] = useState(null);

  const revalidate = revalidator.revalidate;
  const refetch = useCallback(() => {
    invalidateTabCache("shotlist");
    revalidate();
  }, [revalidate]);

  // The agent builds the shot list one beat at a time (save_shotlist in append
  // mode). Refresh on EACH completed call so the beats appear live as they land,
  // not only when the whole turn finishes — the idle refresh below is the final
  // catch-up.
  useRevalidateOnAgentTool("shotlist", agent.messages, "save_shotlist");
  useRevalidateOnAgentIdle("shotlist", agent.status);

  const rebuild = useCallback(async () => {
    setRebuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/shotlist/rebuild-from-episode", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error || "Rebuild failed");
      refetch();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRebuilding(false);
    }
  }, [refetch]);

  // A ShotField saved → refetch so the patched shot + fresh packs reflect the edit.
  const onSaved = refetch;

  const shots = data.shots || [];
  const packs = data.packs || [];
  const runtime = shots.reduce((a, s) => a + (Number(s.dur) || 0), 0);
  const packById = new Map();
  packs.forEach((p) => p.shotIds.forEach((id) => packById.set(id, p.id)));

  // Clicking a pack in the left rail filters the body to just that pack's shots;
  // clicking it again shows all. Guard the selection so a pack that vanished
  // after an edit/rebuild falls back to "show all" instead of an empty body.
  const effPack = activePack && packs.some((p) => p.id === activePack) ? activePack : null;
  const visibleShots = effPack ? shots.filter((s) => packById.get(s.id) === effPack) : shots;

  // Group the visible shots by beat, in order.
  const beats = [];
  for (const s of visibleShots) {
    const last = beats[beats.length - 1];
    if (!last || last.beat !== s.beat) beats.push({ beat: s.beat, beatTitle: s.beatTitle, shots: [s] });
    else last.shots.push(s);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Shot list</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={rebuild} disabled={rebuilding}>
              {rebuilding ? <><Loader2 size={13} className="animate-spin" /> rebuilding…</> : <><RefreshCw size={13} /> rebuild from current episode</>}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{shots.length} shots</Badge>
          <Badge variant="success">~{fmtTime(runtime)} total</Badge>
          <Badge variant="info"><Layers size={11} /> {packs.length} multishot packs</Badge>
          {agentBusy && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> agent working…</Badge>}
          <span>the granular shots auto-pack into ≤15s multishots (left rail — click one to filter); generate them from a signed script on the Script tab</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {shots.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <Empty>no shots yet — sign the script and press “generate shot list”, or rebuild from the current episode.</Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          {/* Shots, grouped by beat */}
          <div className="min-w-0 flex-1 space-y-4">
            {beats.map((b) => (
              <Panel
                key={b.beat + b.shots[0].id}
                title={<span className="flex items-center gap-2"><Film size={15} className="text-primary" /> {b.beatTitle || b.beat}</span>}
                meta={<Badge variant="outline">{b.shots.length} shots</Badge>}
              >
                <div className="space-y-3">
                  {b.shots.map((s) => (
                    <div key={s.n} className="rounded-lg border p-2.5">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="secondary" className="font-mono">shot {s.id}</Badge>
                        {packById.get(s.id) && <Badge variant="info" className="font-mono">{packById.get(s.id)}</Badge>}
                        <span className="text-muted-foreground">{s.location}</span>
                        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                          <span className="w-10"><ShotField n={s.n} field="dur" value={s.dur} onSaved={onSaved} /></span>s
                        </span>
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Location
                          <ShotField n={s.n} field="location" value={s.location} onSaved={onSaved} mono /></label>
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Characters
                          <ShotField n={s.n} field="characters" value={(s.characters || []).join(", ")} onSaved={onSaved} placeholder="Sara, Helena" /></label>
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">Camera
                          <CameraField n={s.n} value={s.camera} onSaved={onSaved} /></label>
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">Action
                          <ShotField n={s.n} field="action" value={s.action} onSaved={onSaved} multiline /></label>
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dialogue
                          <ShotField n={s.n} field="dialogue" value={s.dialogue} onSaved={onSaved} multiline /></label>
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Audio sync
                          <ShotField n={s.n} field="audioSync" value={s.audioSync} onSaved={onSaved} multiline /></label>
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">Seedance prompt
                          <ShotField n={s.n} field="prompt" value={s.prompt} onSaved={onSaved} multiline rows={4} /></label>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>

          {/* ≤15s pack rail — pinned on the LEFT within the shot-list wrapper and
              scrollable on its own (the list gets long). Click a pack to filter
              the body to just its shots; click again to show all. */}
          <aside className="shrink-0 md:order-first md:sticky md:top-[73px] md:w-[260px] md:self-start md:max-h-[calc(100dvh-92px)] md:overflow-y-auto lg:w-[300px]">
            <Panel title={<span className="flex items-center gap-2"><Layers size={15} className="text-primary" /> Multishot packs</span>} meta={<Badge variant="outline">{packs.length}</Badge>}>
              {effPack && (
                <button
                  type="button"
                  onClick={() => setActivePack(null)}
                  className="mb-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                >
                  <X size={11} /> showing {effPack} — show all
                </button>
              )}
              <ol className="space-y-1.5">
                {packs.map((p) => {
                  const on = effPack === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setActivePack((cur) => (cur === p.id ? null : p.id))}
                        aria-pressed={on}
                        title={on ? "show all shots" : `show only ${p.id}'s shots`}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                          on ? "border-primary bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted",
                        )}
                      >
                        <Badge variant="secondary" className="font-mono">{p.id}</Badge>
                        <span className="font-mono text-muted-foreground">{p.from}–{p.to}</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="text-muted-foreground">{p.count} shots</span>
                          <Badge variant={p.durationEst > 15 ? "warning" : "success"}>{p.durationEst}s</Badge>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                click a pack to show only its shots. packing is automatic — a pack never crosses a beat/location or exceeds 15s. these become the Episode bundles.
              </p>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}

// Loader: the shot list (shots + auto-packed multishot packs).
export function loader() {
  return swr("shotlist", async () => {
    const res = await fetch("/api/shotlist");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export { ShotList };

export function Component() {
  return <ShotList />;
}
