import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  AlertTriangle, Clapperboard, Film, Image as ImageIcon, Loader2, Music,
  Pin, PinOff, Plus, Scissors, Trash2, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Empty, Panel, ErrorNote, Eyebrow, fmtTime } from "@/components/shared";
import {
  MAX_DIRECTIONS, MAX_END_IMAGES, MIN_END_IMAGE_GAP_SECONDS,
  MIN_OPENING_END_IMAGE_SECONDS, sectionOrder,
} from "@/lib/series";

/* ------------------------------------------------------------------ *
 * Director — the cue sheet a live Director plans a whole film from.   *
 *                                                                     *
 * Everywhere else here you render a shot, then the next shot, then    *
 * cut them together. This is the other way: one recipe, and the       *
 * Stage generates the piece continuously against it.                  *
 *                                                                     *
 * THE THING THIS SCREEN IS FOR. The endpoint does not refuse a bad     *
 * beat — it refuses the whole session, at the door, and bills its      *
 * sixty-second minimum anyway. So every write comes back with the      *
 * refusals on it and they are shown HERE, next to the sheet, while it  *
 * is still being typed. Nothing else on this tab matters as much.      *
 * ------------------------------------------------------------------ */

async function dirApi(url, opts) {
  const res = await fetch(url, {
    headers: opts?.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status}`), { issues: data.issues });
  return data;
}

const post = (url, body) => dirApi(url, { method: "POST", body: JSON.stringify(body) });
const put = (url, body) => dirApi(url, { method: "PUT", body: JSON.stringify(body) });

/** `0:00` from whole seconds — a beat's offset is on the film's own clock. */
const at = (s) => fmtTime(s);

/* ---- the refusal list ---------------------------------------------------- */

// Shown wherever a Series is, not tucked behind a save button. An author who
// finds out at the door has paid for the discovery.
function Issues({ issues }) {
  const entries = Object.entries(issues || {});
  if (!entries.length) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-amber-500 text-xs font-medium uppercase tracking-wide">
        <AlertTriangle size={13} />
        The Director would refuse this
      </div>
      {entries.map(([field, message]) => (
        <p key={field} className="text-sm text-muted-foreground">
          <span className="font-mono text-xs text-foreground/70">{field}</span> — {message}
        </p>
      ))}
    </div>
  );
}

/* ---- the Series list ----------------------------------------------------- */

function SeriesList({ series, selectedId, onSelect, onCreate, creating }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Eyebrow>Series</Eyebrow>
        <Button size="sm" variant="ghost" onClick={onCreate} disabled={creating}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          New
        </Button>
      </div>
      {series.length === 0 ? (
        <Empty>No Series yet. One recipe, one continuous take — start with “New”.</Empty>
      ) : (
        <div className="space-y-1">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left transition-colors",
                s.id === selectedId ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{s.title}</span>
                <Badge variant={s.status === "published" ? "success" : "muted"}>{s.status}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                <span>{s.aspectRatio}</span>
                <span>·</span>
                <span>{s.beats} beats</span>
                <span>·</span>
                <span>{s.pins} pinned</span>
                {s.sheets ? <><span>·</span><span>{s.sheets} sheets</span></> : null}
                {s.hasTargetAudio ? <><span>·</span><Music size={11} className="inline" /></> : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- the Series form ----------------------------------------------------- */

function SeriesForm({ view, onPatch, busy }) {
  const s = view.series;
  const [draft, setDraft] = useState(null);
  const value = draft ?? s;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(s);
  const edit = (patch) => setDraft({ ...value, ...patch });

  return (
    <Panel>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="d-title">Title</Label>
          <Input id="d-title" value={value.title} onChange={(e) => edit({ title: e.target.value })} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="d-prompt">Opening prompt</Label>
          <Textarea
            id="d-prompt"
            rows={6}
            value={value.prompt}
            onChange={(e) => edit({ prompt: e.target.value })}
          />
          {/* Said here because it is the mistake: the field looks like a place
              to describe the first shot, and it governs every beat under it. */}
          <p className="text-xs text-muted-foreground">
            The standing brief — style, film stock, identity locks. What is true for the whole
            film, not the first shot.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="d-shape">Shape</Label>
            <select
              id="d-shape"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={value.aspectRatio}
              onChange={(e) => edit({ aspectRatio: e.target.value })}
            >
              <option value="16:9">16:9 — landscape</option>
              <option value="9:16">9:16 — vertical</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-res">Resolution</Label>
            <select
              id="d-res"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={value.resolution}
              onChange={(e) => edit({ resolution: e.target.value })}
            >
              <option value="480p">480p — cheapest to look at</option>
              <option value="768p">768p</option>
              <option value="1080p">1080p</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-status">Status</Label>
            <select
              id="d-status"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={value.status}
              onChange={(e) => edit({ status: e.target.value })}
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="d-image">First frame</Label>
          <Input
            id="d-image"
            value={value.imageUrl || ""}
            placeholder="/visual-media/… or an absolute url"
            onChange={(e) => edit({ imageUrl: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            The EXACT image the film starts on — every frame after it is generated from this one.
            Make it on the Images tab, or pick it from the Library.
          </p>
          {value.imageUrl ? (
            <img
              src={value.imageUrl}
              alt=""
              className="mt-2 max-h-40 rounded-md border border-border object-contain"
            />
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || busy}
            onClick={() => onPatch({
              title: value.title,
              prompt: value.prompt,
              imageUrl: value.imageUrl,
              aspectRatio: value.aspectRatio,
              resolution: value.resolution,
              status: value.status,
            }).then(() => setDraft(null))}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Save
          </Button>
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/* ---- the cue sheet ------------------------------------------------------- */

// A beat's sections, shown as what they are. `range` first because it is the
// one that stops a beat inventing three shots, and it is the one an author
// forgets to write.
function BeatSections({ prompt, include }) {
  if (!prompt) return <span className="text-muted-foreground">— no prompt</span>;
  if (typeof prompt === "string") return <span>{prompt}</span>;
  const keys = sectionOrder(prompt, include);
  return (
    <div className="space-y-1">
      {keys.map((key) => (
        <div key={key} className="flex gap-2">
          <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground pt-0.5">{key}</span>
          <span className="text-sm">{prompt[key]}</span>
        </div>
      ))}
    </div>
  );
}

function CueSheet({ view, onSave, onPin, busy }) {
  const s = view.series;
  const beats = useMemo(
    () => [...(s.directions || [])].sort((a, b) => a.offset - b.offset),
    [s.directions],
  );
  const pins = beats.filter((b) => b.endImageUrl);
  const include = s.prompts?.sections ?? null;

  const [adding, setAdding] = useState(false);
  const [newOffset, setNewOffset] = useState("");
  const [newText, setNewText] = useState("");

  const addBeat = async () => {
    const offset = Number(newOffset);
    if (!Number.isFinite(offset)) return;
    await onSave("merge", [{ offset, prompt: { scene: newText } }]);
    setAdding(false);
    setNewOffset("");
    setNewText("");
  };

  return (
    <Panel>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Cue sheet</Eyebrow>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{beats.length}/{MAX_DIRECTIONS} beats</span>
            <span>·</span>
            <span>{pins.length}/{MAX_END_IMAGES} pinned</span>
            {view.reels?.length > 1 ? (
              <>
                <span>·</span>
                <Badge variant="info">{view.reels.length} reels</Badge>
              </>
            ) : null}
          </div>
        </div>

        {/* The spacing rules, stated where beats are typed rather than in a doc
            nobody opens on the way to a refusal. */}
        <p className="text-xs text-muted-foreground">
          A beat is a second on the film’s own clock. Pinned frames sit at least{" "}
          {MIN_END_IMAGE_GAP_SECONDS}s apart, and a reel’s first pin no earlier than{" "}
          {MIN_OPENING_END_IMAGE_SECONDS}s in. Every ceiling is per reel.
        </p>

        {beats.length === 0 ? (
          <Empty>
            No beats. The film will drift from the opening prompt rather than follow an arc —
            “Derive from shot list” turns this project’s shots into beats in one go.
          </Empty>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {beats.map((beat) => (
              <div key={beat.offset} className="flex gap-3 p-3">
                <div className="w-14 shrink-0">
                  <div className="font-mono text-sm">{at(beat.offset)}</div>
                  <div className="text-[10px] text-muted-foreground">{beat.offset}s</div>
                </div>
                <div className="min-w-0 flex-1">
                  <BeatSections prompt={beat.prompt} include={include} />
                  {beat.audioUrl ? (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Music size={11} /> shot against its own bed
                    </div>
                  ) : null}
                </div>
                <div className="w-28 shrink-0 text-right">
                  {beat.endImageUrl ? (
                    <div className="space-y-1">
                      <img
                        src={beat.endImageUrl}
                        alt=""
                        className="ml-auto h-14 rounded border border-border object-cover"
                      />
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => onPin({ offset: beat.offset, clear: true })}
                        disabled={busy}
                      >
                        <PinOff size={11} className="inline" /> unpin
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      <Pin size={11} className="inline opacity-40" /> no pin
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove the beat at ${beat.offset}s`}
                  className="shrink-0 self-start text-muted-foreground hover:text-destructive"
                  onClick={() => onSave("remove", [{ offset: beat.offset }])}
                  disabled={busy}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {adding ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex gap-2">
              <Input
                className="w-28"
                placeholder="offset (s)"
                value={newOffset}
                onChange={(e) => setNewOffset(e.target.value)}
              />
              <Input
                placeholder="what is in frame from this second"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addBeat} disabled={busy}>Add beat</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add a beat
          </Button>
        )}
      </div>
    </Panel>
  );
}

/* ---- model sheets -------------------------------------------------------- */

function ModelSheets({ view, onSheet, busy }) {
  const sheets = view.series.modelSheets || [];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ kind: "character", name: "", imageUrl: "", prompt: "" });

  return (
    <Panel>
      <div className="space-y-3">
        <Eyebrow>Model sheets</Eyebrow>
        <p className="text-xs text-muted-foreground">
          The reference art every frame is drawn against — and the one part of a Series that is
          never sent to the Director. Make the picture on the Images tab; name it here.
        </p>

        {sheets.length === 0 ? (
          <Empty>No sheets. Nothing is holding a character or a place still across the piece.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sheets.map((sheet) => (
              <div key={sheet.name} className="rounded-md border border-border p-2">
                {sheet.imageUrl ? (
                  <img src={sheet.imageUrl} alt="" className="mb-2 w-full rounded object-cover" />
                ) : (
                  <div className="mb-2 flex h-20 items-center justify-center rounded bg-muted/40 text-muted-foreground">
                    <ImageIcon size={18} />
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{sheet.name}</div>
                    <Badge variant="muted">{sheet.kind}</Badge>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove the ${sheet.name} sheet`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onSheet({ remove: sheet.name })}
                    disabled={busy}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {open ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex gap-2">
              <select
                className="h-9 w-32 rounded-md border border-input bg-transparent px-2 text-sm"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              >
                <option value="character">Character</option>
                <option value="location">Location</option>
                <option value="style">Style</option>
              </select>
              <Input
                placeholder="what it is a sheet of"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <Input
              placeholder="/visual-media/… or an absolute url"
              value={draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
            />
            <Textarea
              rows={3}
              placeholder="the prompt that made it, verbatim — a sheet without it is a look that cannot be extended"
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!draft.name || busy}
                onClick={() => onSheet({ sheet: draft }).then(() => {
                  setOpen(false);
                  setDraft({ kind: "character", name: "", imageUrl: "", prompt: "" });
                })}
              >
                Add sheet
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus size={14} /> Add a sheet
          </Button>
        )}
      </div>
    </Panel>
  );
}

/* ---- target audio -------------------------------------------------------- */

function TargetAudio({ view, onAudio, busy }) {
  const version = view.series.audioVersion;
  const past = view.series.pastAudioVersions || [];
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");

  return (
    <Panel>
      <div className="space-y-3">
        <Eyebrow>Target audio</Eyebrow>
        {/* The distinction the whole feature turns on, said in one sentence. */}
        <p className="text-xs text-muted-foreground">
          Audio the Director generates <em>against</em>, not a layer played over the film — every
          chunk is shaped by the next window of it. Render it in Sound Studio or cast it in Radio,
          then point at it here.
        </p>

        {version?.audioUrl ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <audio controls src={version.audioUrl} className="w-full" />
            <p className="text-xs text-muted-foreground line-clamp-3">{version.prompt}</p>
            <Button size="sm" variant="ghost" onClick={() => onAudio({ clear: true })} disabled={busy}>
              Clear
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="/sound-media/take_3.mp3"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Textarea
              rows={2}
              placeholder="the prompt that made it, verbatim"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!url || !prompt || busy}
              onClick={() => onAudio({ audioUrl: url, prompt }).then(() => { setUrl(""); setPrompt(""); })}
            >
              Shoot against this
            </Button>
          </div>
        )}

        {past.length ? (
          <p className="text-[11px] text-muted-foreground">
            {past.length} earlier {past.length === 1 ? "version" : "versions"} kept — a replaced
            render is archived, never overwritten.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/* ---- the tab ------------------------------------------------------------- */

function DirectorTab() {
  const initial = useLoaderData();
  const { revalidate } = useRevalidator();
  useRevalidateOnMount("director");

  const [selectedId, setSelectedId] = useState(initial.selectedId);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    invalidateTabCache("director");
    revalidate();
  }, [revalidate]);

  const load = useCallback(async (id) => {
    if (!id) { setView(null); return; }
    setError("");
    try {
      setView(await dirApi(`/api/director/series/${encodeURIComponent(id)}`));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // The open Series follows the selection, and the selection is project-level:
  // two authors on one project are working on the same film.
  const select = useCallback(async (id) => {
    setSelectedId(id);
    await load(id);
    put("/api/director/selected", { seriesId: id }).catch(() => {});
  }, [load]);

  // The open Series is fetched in full on mount and whenever the selection
  // moves — the list only carries counts, and every refusal lives on the row.
  useEffect(() => { load(selectedId); }, [selectedId, load]);

  const run = useCallback(async (fn) => {
    setBusy(true);
    setError("");
    try {
      const next = await fn();
      if (next?.series) setView(next);
      refresh();
      return next;
    } catch (e) {
      setError(e.issues ? `${e.message}: ${Object.values(e.issues).join("; ")}` : e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const create = () => run(async () => {
    const made = await post("/api/director/series", {
      title: "Untitled Series",
      prompt: "",
      aspectRatio: "16:9",
    });
    setSelectedId(made.series.id);
    return made;
  });

  const id = view?.series?.id;
  const url = (suffix) => `/api/director/series/${encodeURIComponent(id)}${suffix}`;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4">
      <div className="flex items-center gap-2">
        <Clapperboard size={18} />
        <h1 className="text-lg font-semibold">Director</h1>
        <span className="text-sm text-muted-foreground">
          One recipe, generated as one continuous take.
        </span>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <SeriesList
          series={initial.series || []}
          selectedId={selectedId}
          onSelect={select}
          onCreate={create}
          creating={busy}
        />

        {view ? (
          <div className="space-y-4">
            <Issues issues={view.issues} />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => post(url("/derive"), { pin: true }))}
              >
                <Wand2 size={14} /> Derive from shot list
              </Button>
              <span className="text-xs text-muted-foreground">
                Each shot becomes a beat, with its storyboard still pinned where one fits.
              </span>
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Film size={12} /> {view.screening?.filmSeconds ?? 0}s of film</span>
              {view.reels?.map((reel) => (
                <span key={reel.reel} className="flex items-center gap-1">
                  <Scissors size={12} /> reel {reel.reel}: {reel.beats} beats, {reel.pins} pins
                </span>
              ))}
            </div>

            <SeriesForm view={view} busy={busy} onPatch={(patch) => run(() => put(url(""), patch))} />
            <CueSheet
              view={view}
              busy={busy}
              onSave={(mode, beats) => run(() => post(url("/cue"), { mode, beats }))}
              onPin={(body) => run(() => post(url("/pin"), body))}
            />
            <ModelSheets view={view} busy={busy} onSheet={(body) => run(() => post(url("/sheets"), body))} />
            <TargetAudio view={view} busy={busy} onAudio={(body) => run(() => post(url("/audio"), body))} />
          </div>
        ) : (
          <Empty>Pick a Series, or start one.</Empty>
        )}
      </div>
    </div>
  );
}

export function loader() {
  return swr("director", async () => {
    const res = await fetch("/api/director");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load the Director tab");
    return json;
  });
}

export function Component() {
  return <DirectorTab />;
}
