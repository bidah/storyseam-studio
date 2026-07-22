// Settings — opened from the header avatar menu (not a top tab). Edits the
// project's image-generation prompts: the visual-world STYLE presets (the house
// look prepended to every generation) and the CHARACTER/LOCATION sheet prompts
// layered on top when a generation is tagged as a design sheet (the composer
// checkboxes on World › Visual, or the agent's sheet-generation skill).
//
// Backed by the same /api/visual-world doc as the Visual tab, so it shares the
// "visual-world" swr cache key and the canonical invalidate+revalidate pair.
import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { Loader2, Save, Plus, Trash2, IdCard, MapPin, Palette, Check } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow, Panel, ErrorNote } from "@/components/shared";

async function put(path, body) {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Request failed");
  return j;
}

// Save button with a transient "Saved" confirmation.
function SaveButton({ onSave, children = "Save" }) {
  const [state, setState] = useState("idle"); // idle | saving | saved
  const click = async () => {
    setState("saving");
    try {
      await onSave();
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  };
  return (
    <Button size="sm" onClick={click} disabled={state === "saving"}>
      {state === "saving" ? <Loader2 size={14} className="animate-spin" />
        : state === "saved" ? <Check size={14} />
        : <Save size={14} />}
      {state === "saved" ? "Saved" : children}
    </Button>
  );
}

function SettingsPage() {
  const world = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("visual-world");

  const [error, setError] = useState(null);
  // Local drafts, seeded from the loader once — saving refetches to re-sync.
  const [prompts, setPrompts] = useState(world.prompts || []);
  const [sheets, setSheets] = useState({
    character: world.sheetPrompts?.character || "",
    location: world.sheetPrompts?.location || "",
  });

  const refetch = () => { invalidateTabCache("visual-world"); revalidator.revalidate(); };

  const editPrompt = (id, key, val) => setPrompts((l) => l.map((p) => (p.id === id ? { ...p, [key]: val } : p)));
  const addPrompt = () => setPrompts((l) => [...l, { id: `prompt-${Date.now().toString(36)}`, name: "New prompt", image: "", video: "", builtin: false }]);
  const removePrompt = (id) => setPrompts((l) => l.filter((p) => p.id !== id));

  const savePrompts = async () => {
    setError(null);
    try { await put("/api/visual-world/prompts", { prompts }); refetch(); }
    catch (e) { setError(String(e.message || e)); throw e; }
  };
  const saveSheets = async () => {
    setError(null);
    try {
      const j = await put("/api/visual-world/sheet-prompts", sheets);
      // The server backfills an emptied prompt with its seed default — show it.
      if (j.sheetPrompts) setSheets(j.sheetPrompts);
      refetch();
    } catch (e) { setError(String(e.message || e)); throw e; }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Project-wide prompts for image generation — the house style, and the sheet
          prompts layered on top when a generation is tagged as a character or location sheet.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Panel title={<span className="flex items-center gap-2"><Palette size={15} className="text-primary" /> Style prompts</span>}>
        <p className="mb-3 text-sm text-muted-foreground">
          The reusable style presets of the visual world generator. The <b>image</b> block
          is prepended to every scene as the house style; the <b>video</b> block is kept
          for later Seedance renders.
        </p>
        <div className="space-y-4">
          {prompts.map((p) => (
            <div key={p.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input value={p.name} onChange={(e) => editPrompt(p.id, "name", e.target.value)} className="h-8 flex-1 text-sm font-medium" placeholder="Preset name" />
                {p.builtin && <Badge variant="muted">seed</Badge>}
                <Button variant="ghost" size="icon-sm" aria-label="Delete preset" onClick={() => removePrompt(p.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={14} />
                </Button>
              </div>
              <div>
                <Eyebrow className="normal-case tracking-normal text-foreground/70">Image style</Eyebrow>
                <Textarea value={p.image} onChange={(e) => editPrompt(p.id, "image", e.target.value)} rows={5} className="text-sm" placeholder="Style, palette, composition…" />
              </div>
              <div>
                <Eyebrow className="normal-case tracking-normal text-foreground/70">Video / motion (optional)</Eyebrow>
                <Textarea value={p.video} onChange={(e) => editPrompt(p.id, "video", e.target.value)} rows={2} className="text-sm" placeholder="Camera & motion clauses for Seedance…" />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addPrompt}><Plus size={13} /> Add preset</Button>
            <SaveButton onSave={savePrompts}>Save style prompts</SaveButton>
          </div>
        </div>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><IdCard size={15} className="text-primary" /> Character sheet prompt</span>}>
        <p className="mb-2 text-sm text-muted-foreground">
          Added on top of the style prompt when a generation is tagged as a <b>character sheet</b> —
          via the checkbox on World › Visual, or when you ask the agent for one.
        </p>
        <Textarea
          value={sheets.character}
          onChange={(e) => setSheets((s) => ({ ...s, character: e.target.value }))}
          rows={5}
          className="text-sm"
          placeholder="Turnaround views, neutral background, consistent proportions…"
        />
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><MapPin size={15} className="text-primary" /> Location sheet prompt</span>}>
        <p className="mb-2 text-sm text-muted-foreground">
          Added on top of the style prompt when a generation is tagged as a <b>location sheet</b>.
        </p>
        <Textarea
          value={sheets.location}
          onChange={(e) => setSheets((s) => ({ ...s, location: e.target.value }))}
          rows={5}
          className="text-sm"
          placeholder="Establishing wide view plus key-angle vignettes, no characters…"
        />
        <div className="mt-3 flex justify-end">
          <SaveButton onSave={saveSheets}>Save sheet prompts</SaveButton>
        </div>
      </Panel>
    </div>
  );
}

export function loader() {
  return swr("visual-world", async () => {
    const res = await fetch("/api/visual-world");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export function Component() { return <SettingsPage />; }
