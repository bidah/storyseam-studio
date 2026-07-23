// Settings — opened from the header avatar menu (not a top tab). Edits the
// project's image-generation prompts: the visual-world STYLE presets (the house
// look prepended to every generation) and the CHARACTER/LOCATION sheet prompts
// layered on top when a generation is tagged as a design sheet (the composer
// checkboxes on World › Visual, or the agent's sheet-generation skill).
//
// Backed by the same /api/visual-world doc as the Visual tab, so it shares the
// "visual-world" swr cache key and the canonical invalidate+revalidate pair.
import { useEffect, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { Loader2, Save, Plus, Trash2, IdCard, MapPin, Package, Palette, Check, SlidersHorizontal, KeyRound, ExternalLink } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { useFalKey, setFalKey, clearFalKey } from "@/lib/falKey";
import { useAtlasKey, setAtlasKey, clearAtlasKey } from "@/lib/atlasKey";
import { PROVIDERS, useProviderPrefs, setActiveProvider } from "@/lib/providers";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Eyebrow, Panel, ErrorNote } from "@/components/shared";
import { ASPECTS } from "@/components/ImageStudio";

// Radix Select forbids empty-string item values — sentinel maps back to ""
// (empty model = the server default, Nano Banana Pro).
const DEFAULT_MODEL = "__default__";

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

// One BYOK key editor row (fal.ai / Atlas Cloud). The key is client-side only —
// localStorage, sent per-request as a header, never saved on our servers.
function ByokKeyEditor({ label, keyValue, save, clear, placeholder, keysUrl }) {
  const [draft, setDraft] = useState("");
  const plausible = /^[\w:.-]{10,200}$/.test(draft.trim());
  const masked = keyValue ? `••••••••${keyValue.slice(-4)}` : "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="password"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={masked || placeholder}
        className="h-8 w-[260px] font-mono text-xs"
        aria-label={`${label} API key`}
      />
      <Button size="sm" disabled={!plausible} onClick={() => { save(draft); setDraft(""); }}>
        {keyValue ? "Replace key" : "Save key"}
      </Button>
      {keyValue ? (
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={clear}>
          Remove
        </Button>
      ) : null}
      <a
        href={keysUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Get a key <ExternalLink size={11} />
      </a>
    </div>
  );
}

// Render providers: credentials for all three backends can coexist, but
// exactly ONE provider is in use at a time — the Switches behave like a radio
// group (turning one on turns the others off; the selected one can't be turned
// off). The selection is the backend the composer AND the agent render with;
// in-flight jobs from a previously selected provider still finish.
function ProvidersPanel() {
  const prefs = useProviderPrefs();
  const falKey = useFalKey();
  const atlasKey = useAtlasKey();

  const rows = {
    higgsfield: {
      status: <span className="text-xs text-muted-foreground">Connected through your Higgsfield sign-in — no key needed.</span>,
      hasCred: true,
    },
    fal: {
      status: (
        <ByokKeyEditor
          label="fal.ai" keyValue={falKey} save={setFalKey} clear={clearFalKey}
          placeholder="key_id:key_secret" keysUrl="https://fal.ai/dashboard/keys"
        />
      ),
      hasCred: !!falKey,
    },
    atlas: {
      status: (
        <ByokKeyEditor
          label="Atlas Cloud" keyValue={atlasKey} save={setAtlasKey} clear={clearAtlasKey}
          placeholder="Atlas API key" keysUrl="https://www.atlascloud.ai/console/api-keys"
        />
      ),
      hasCred: !!atlasKey,
    },
  };

  return (
    <Panel title={<span className="flex items-center gap-2"><KeyRound size={15} className="text-primary" /> Render providers</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        Renders bill <b>your</b> accounts. Keys are stored only in this browser (localStorage)
        and sent per-request to the generators — never saved on our servers. You can keep
        credentials for all three, but <b>one provider is in use at a time</b> — switching
        one on switches the others off. Jobs already running on another provider still finish.
      </p>
      <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const row = rows[p.id];
          const isActive = prefs.active === p.id;
          return (
            <div key={p.id} className={`rounded-lg border p-3 ${isActive ? "border-primary/40" : "opacity-70"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                {isActive ? <Badge variant="success">In use</Badge> : null}
                <div className="ml-auto">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(on) => { if (on) setActiveProvider(p.id); }}
                    aria-label={`Use ${p.label}`}
                  />
                </div>
              </div>
              <div className="mt-2">{row.status}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
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
    prop: world.sheetPrompts?.prop || "",
  });
  // Generation defaults the composer AND the agent use (model "" = Nano Banana Pro).
  const [gen, setGen] = useState({
    model: world.settings?.model || "",
    aspectRatio: world.settings?.aspectRatio || "16:9",
  });
  // Live image-model catalog (same source as the World › Visual composer).
  const [models, setModels] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/visual-world/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.models) setModels(j.models); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
  const saveGen = async () => {
    setError(null);
    try {
      const j = await put("/api/visual-world/settings", gen);
      if (j.settings) setGen({ model: j.settings.model || "", aspectRatio: j.settings.aspectRatio || "16:9" });
      refetch();
    } catch (e) { setError(String(e.message || e)); throw e; }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Project-wide prompts for image generation — the house style, and the sheet
          prompts layered on top when a generation is tagged as a character, location, or prop sheet.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <ProvidersPanel />

      <Panel title={<span className="flex items-center gap-2"><SlidersHorizontal size={15} className="text-primary" /> Generation defaults</span>}>
        <p className="mb-3 text-sm text-muted-foreground">
          The image model and aspect ratio used by default — by the World › Visual composer
          <b> and by the agent</b> whenever it generates images (concept art, character sheets,
          location sheets), unless you override them for a specific generation.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">Image model</Eyebrow>
            <Select value={gen.model || DEFAULT_MODEL} onValueChange={(v) => setGen((s) => ({ ...s, model: v === DEFAULT_MODEL ? "" : v }))}>
              <SelectTrigger size="sm" className="w-[220px] text-xs"><SelectValue placeholder="Nano Banana Pro" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL}>Nano Banana Pro (default)</SelectItem>
                {models.filter((m) => m.id).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">Aspect ratio</Eyebrow>
            <Select value={gen.aspectRatio} onValueChange={(v) => setGen((s) => ({ ...s, aspectRatio: v }))}>
              <SelectTrigger size="sm" className="w-[110px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="ml-auto self-end">
            <SaveButton onSave={saveGen}>Save defaults</SaveButton>
          </div>
        </div>
      </Panel>

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
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Package size={15} className="text-primary" /> Prop sheet prompt</span>}>
        <p className="mb-2 text-sm text-muted-foreground">
          Added on top of the style prompt when a generation is tagged as a <b>prop sheet</b> —
          the objects characters carry and handle, rendered as multi-view reference art the
          video models can lock onto.
        </p>
        <Textarea
          value={sheets.prop}
          onChange={(e) => setSheets((s) => ({ ...s, prop: e.target.value }))}
          rows={5}
          className="text-sm"
          placeholder="Front, three-quarter and side views of the same object, no hands, neutral backdrop…"
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
