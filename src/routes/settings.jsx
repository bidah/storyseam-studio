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
import { Loader2, Save, Plus, Trash2, IdCard, MapPin, Package, Palette, Check, SlidersHorizontal, KeyRound, ExternalLink, Globe, TerminalSquare, Cpu, Clapperboard, Cable } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import {
  useHiggsfieldLinked, connectHiggsfield, disconnectHiggsfield,
} from "@/lib/higgsfieldAccount";
import { useFalKey, setFalKey, clearFalKey } from "@/lib/falKey";
import { useAtlasKey, setAtlasKey, clearAtlasKey } from "@/lib/atlasKey";
import { PROVIDERS, useProviderPrefs, setActiveProvider } from "@/lib/providers";
import {
  useExaKey, setExaKey, clearExaKey,
  useFirecrawlKey, setFirecrawlKey, clearFirecrawlKey,
} from "@/lib/searchKeys";
import { SEARCH_PROVIDERS, useSearchProvider, setSearchProvider } from "@/lib/searchProviders";
import { SANDBOX_MODES, useSandboxMode, setSandboxMode } from "@/lib/sandboxMode";
import { CHAT_PROVIDERS, useChatProvider, setChatProvider } from "@/lib/chatProvider";
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
// Chat provider: which model catalog the chat agent's model picker offers.
// Radio semantics — exactly one at a time, and switching snaps the picker (and
// the next message) to that provider's models (lib/agentModel.js reconciles the
// selection). Cloudflare Workers AI is the keyless default; Cerebras is opt-in
// and gated on a worker key, which /eve/health reports. The choice rides no
// header of its own — the selected model's specifier already names its provider.
function ChatProviderPanel() {
  const active = useChatProvider();
  const [providers, setProviders] = useState(null); // { anthropic, cerebras } | null

  useEffect(() => {
    let alive = true;
    fetch("/eve/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.providers) setProviders(j.providers); })
      .catch(() => { /* health is best-effort — panel still works */ });
    return () => { alive = false; };
  }, []);

  return (
    <Panel title={<span className="flex items-center gap-2"><Cpu size={15} className="text-primary" /> Chat provider</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        Which models the chat agent's model picker offers. <b>One provider is in use at a time</b> —
        switching snaps the picker, and the next message, to that provider's models. <b>Cerebras</b>
        serves Gemma 4 31B, Z.AI GLM-4.7 and GPT-OSS 120B on ultra-fast inference through Cloudflare
        AI Gateway, and needs a Cerebras key configured on the agent worker.
      </p>
      <div className="space-y-3">
        {CHAT_PROVIDERS.map((p) => {
          const isActive = active === p.id;
          // Cloudflare Workers AI is always available (keyless); Cerebras is
          // gated on CEREBRAS_API_KEY, reported by /eve/health.
          const gated = p.id !== "cloudflare";
          const available = !gated || providers?.[p.id];
          return (
            <div key={p.id} className={`rounded-lg border p-3 ${isActive ? "border-primary/40" : "opacity-70"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                {isActive ? <Badge variant="success">In use</Badge> : null}
                {p.id === "cloudflare" ? <Badge variant="muted">Default</Badge> : null}
                {gated && available ? <Badge variant="muted">Ready</Badge> : null}
                {gated && available === false ? <Badge variant="warning">Needs a key</Badge> : null}
                <div className="ml-auto">
                  <Switch
                    checked={isActive}
                    disabled={!available}
                    onCheckedChange={(on) => { if (on && available) setChatProvider(p.id); }}
                    aria-label={`Use ${p.label} for chat`}
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.blurb}</p>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// Connectors: external accounts LINKED to the signed-in (Google) user. Only
// Higgsfield today — the link runs the same OAuth server the render skills
// use, so connecting stores the per-user Higgsfield token server-side and
// unlocks rendering + the library's "Import from Higgsfield".
function ConnectorsPanel() {
  const linked = useHiggsfieldLinked(); // null loading | "error" | boolean
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setErr(null);
    try { await fn(); } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <Panel title={<span className="flex items-center gap-2"><Cable size={15} className="text-primary" /> Connectors</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        External accounts linked to your sign-in. Connecting <b>Higgsfield</b> runs a
        one-tap OAuth flow and lets Shot Studio render images, video &amp; audio on your
        Higgsfield account — and browse your past generations in the library.
      </p>
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Higgsfield</span>
          {linked === true ? <Badge variant="success">Connected</Badge> : null}
          {linked === false ? <Badge variant="warning">Not connected</Badge> : null}
          {linked === null ? <Badge variant="muted">Checking…</Badge> : null}
          {linked === "error" ? <Badge variant="warning">Status unknown</Badge> : null}
          <div className="ml-auto flex items-center gap-2">
            {linked === true ? (
              <Button
                size="sm" variant="ghost" disabled={busy}
                className="text-destructive hover:text-destructive"
                onClick={() => run(disconnectHiggsfield)}
              >
                Disconnect
              </Button>
            ) : (
              <Button size="sm" disabled={busy || linked === null} onClick={() => run(() => connectHiggsfield("/settings"))}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Connect
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {linked === true
            ? "Renders and imports use this account's credits. Disconnecting stops Higgsfield renders until you reconnect."
            : "You'll be sent to Higgsfield to approve access, then straight back here."}
        </p>
        {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
      </div>
    </Panel>
  );
}

function ProvidersPanel() {
  const prefs = useProviderPrefs();
  const falKey = useFalKey();
  const atlasKey = useAtlasKey();
  const hfLinked = useHiggsfieldLinked();

  const rows = {
    higgsfield: {
      status: (
        <span className="text-xs text-muted-foreground">
          {hfLinked === true
            ? "Connected through your linked Higgsfield account — no key needed."
            : "Not connected — link your Higgsfield account in the Connectors panel above."}
        </span>
      ),
      hasCred: hfLinked === true,
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

// Web search: which backend the agent's `web_search` / `fetch_url` tools run
// on. Radio semantics like the render providers, but simpler — exactly one
// backend is loaded per conversation and there are no in-flight jobs to strand,
// so switching takes effect on the very next message. Keys are optional here:
// the flue worker carries operator keys, and /eve/health reports which, so we
// can tell the user a provider already works without one.
function SearchPanel() {
  const active = useSearchProvider();
  const exaKey = useExaKey();
  const firecrawlKey = useFirecrawlKey();
  const [operator, setOperator] = useState(null); // { exa, firecrawl } | null

  useEffect(() => {
    let alive = true;
    fetch("/eve/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.search) setOperator(j.search); })
      .catch(() => { /* health is best-effort — panel still works */ });
    return () => { alive = false; };
  }, []);

  const keys = {
    exa: { value: exaKey, save: setExaKey, clear: clearExaKey },
    firecrawl: { value: firecrawlKey, save: setFirecrawlKey, clear: clearFirecrawlKey },
  };

  return (
    <Panel title={<span className="flex items-center gap-2"><Globe size={15} className="text-primary" /> Web search</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        How the agent reaches the open web — for research, fact-checking, and reading links
        you paste. <b>One provider is in use at a time</b>; the agent's tools are named the
        same either way, so switching changes nothing else. Your own key is optional and
        takes precedence when set; keys stay in this browser and are never saved on our servers.
      </p>
      <div className="space-y-3">
        {SEARCH_PROVIDERS.map((p) => {
          const isActive = active === p.id;
          const k = keys[p.id];
          const hasOperatorKey = operator?.[p.id];
          return (
            <div key={p.id} className={`rounded-lg border p-3 ${isActive ? "border-primary/40" : "opacity-70"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                {isActive ? <Badge variant="success">In use</Badge> : null}
                {!k.value && hasOperatorKey ? <Badge variant="muted">Built-in key</Badge> : null}
                {!k.value && hasOperatorKey === false ? <Badge variant="warning">Needs a key</Badge> : null}
                <div className="ml-auto">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(on) => { if (on) setSearchProvider(p.id); }}
                    aria-label={`Use ${p.label} for web search`}
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.blurb}</p>
              <div className="mt-2">
                <ByokKeyEditor
                  label={p.label} keyValue={k.value} save={k.save} clear={k.clear}
                  placeholder={p.placeholder} keysUrl={p.keysUrl}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// Sandbox: where the agent's bash / skill execution runs. Radio semantics like
// the panels above, and it takes effect on the very next message — the mode
// rides every send and the agent picks its sandbox per turn. Default is
// in-memory on purpose: a container is billed per conversation, so we only start
// one for a chat the user deliberately switched over.
function SandboxPanel() {
  const active = useSandboxMode();
  return (
    <Panel title={<span className="flex items-center gap-2"><TerminalSquare size={15} className="text-primary" /> Sandbox</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        Where the agent runs shell commands and multi-step skills. <b>In-memory resets
        between messages</b> — files the agent writes in one reply are gone by the next.
        Switch to a container when a job has to write something now and read it back
        later. Applies to <b>new messages in every chat</b>, and takes effect immediately.
      </p>
      <div className="space-y-3">
        {SANDBOX_MODES.map((m) => {
          const isActive = active === m.id;
          return (
            <div key={m.id} className={`rounded-lg border p-3 ${isActive ? "border-primary/40" : "opacity-70"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.label}</span>
                {isActive ? <Badge variant="success">In use</Badge> : null}
                {m.id === "memory" ? <Badge variant="muted">Default</Badge> : null}
                {m.id === "daytona" ? <Badge variant="warning">Billed</Badge> : null}
                <div className="ml-auto">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(on) => { if (on) setSandboxMode(m.id); }}
                    aria-label={`Run the agent's shell on ${m.label}`}
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{m.blurb}</p>
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
    resolution: world.settings?.resolution || "1k",
  });
  // Video defaults: which Seedance model + resolution the render skills use. The
  // catalog rides on the same /api/visual-world payload and carries each model's
  // OWN resolution list — Mini and Fast can't do 1080p — so the resolution
  // options are derived from the picked model rather than being a fixed list.
  const videoModels = world.videoModels || [];
  const [video, setVideo] = useState({
    videoModel: world.settings?.videoModel || "seedance_2_0",
    videoResolution: world.settings?.videoResolution || "720p",
  });
  const videoEntry = videoModels.find((m) => m.id === video.videoModel) || videoModels[0] || null;
  // Switching model snaps an unsupported resolution back to 720p (every model
  // has it) so the pair on screen is always one the API would accept.
  const pickVideoModel = (id) => setVideo((s) => {
    const entry = videoModels.find((m) => m.id === id);
    return {
      videoModel: id,
      videoResolution: entry?.resolutions?.includes(s.videoResolution) ? s.videoResolution : "720p",
    };
  });
  // Live image-model catalog (same source as the World › Visual composer). Each
  // entry carries its own `resolutions` list ("1k"/"2k"/"4k" on Nano Banana
  // Pro; empty for models without the param), plus the catalog's defaultId so
  // the "" (default) selection resolves to a real entry.
  const [models, setModels] = useState([]);
  const [defaultModelId, setDefaultModelId] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/visual-world/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.models) return;
        setModels(j.models);
        setDefaultModelId(j.defaultId || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Before the catalog answers (or for an unknown id) offer the common trio;
  // a known model that lacks the param gets a disabled "Model default" state.
  const genModelEntry = models.find((m) => m.id === (gen.model || defaultModelId)) || null;
  const genResolutions = genModelEntry ? genModelEntry.resolutions || [] : ["1k", "2k", "4k"];
  const pickGenModel = (id) => setGen((s) => {
    const entry = models.find((m) => m.id === (id || defaultModelId));
    const list = entry ? entry.resolutions || [] : ["1k", "2k", "4k"];
    return {
      ...s,
      model: id,
      resolution: list.includes(s.resolution) ? s.resolution : (list[0] || "1k"),
    };
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
  const saveGen = async () => {
    setError(null);
    try {
      const j = await put("/api/visual-world/settings", gen);
      if (j.settings) setGen({
        model: j.settings.model || "",
        aspectRatio: j.settings.aspectRatio || "16:9",
        resolution: j.settings.resolution || "1k",
      });
      refetch();
    } catch (e) { setError(String(e.message || e)); throw e; }
  };
  const saveVideo = async () => {
    setError(null);
    try {
      const j = await put("/api/visual-world/settings", video);
      // The server clamps the pair too — show what it actually stored.
      if (j.settings) setVideo({
        videoModel: j.settings.videoModel || "seedance_2_0",
        videoResolution: j.settings.videoResolution || "720p",
      });
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

      <ChatProviderPanel />

      <ConnectorsPanel />

      <ProvidersPanel />

      <SearchPanel />

      <SandboxPanel />

      <Panel title={<span className="flex items-center gap-2"><SlidersHorizontal size={15} className="text-primary" /> Generation defaults</span>}>
        <p className="mb-3 text-sm text-muted-foreground">
          The image model, aspect ratio and resolution used by default — by the World › Visual
          composer <b>and by the agent</b> whenever it generates images (concept art, character
          sheets, location sheets), unless you override them for a specific generation.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">Image model</Eyebrow>
            <Select value={gen.model || DEFAULT_MODEL} onValueChange={(v) => pickGenModel(v === DEFAULT_MODEL ? "" : v)}>
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
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">Resolution</Eyebrow>
            {genResolutions.length ? (
              <Select value={gen.resolution} onValueChange={(v) => setGen((s) => ({ ...s, resolution: v }))}>
                <SelectTrigger size="sm" className="w-[90px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{genResolutions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Select value="none" disabled>
                <SelectTrigger size="sm" className="w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Model default</SelectItem></SelectContent>
              </Select>
            )}
          </div>
          <div className="ml-auto self-end">
            <SaveButton onSave={saveGen}>Save defaults</SaveButton>
          </div>
        </div>
      </Panel>

      {/* Rendered only once the catalog is on the payload — an older worker
          returns no `videoModels`, and a picker with no options is worse than
          no picker. */}
      {videoModels.length ? (
        <Panel title={<span className="flex items-center gap-2"><Clapperboard size={15} className="text-primary" /> Video defaults</span>}>
          <p className="mb-3 text-sm text-muted-foreground">
            The Seedance model and resolution the <b>render skills</b> use by default — the
            episode multishot renders, shot continuations, and the agent's video generations —
            unless you name different ones for a specific render. Each model carries its own
            resolution list, so picking one narrows what's on offer.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <Eyebrow className="normal-case tracking-normal text-foreground/70">Video model</Eyebrow>
              <Select value={video.videoModel} onValueChange={pickVideoModel}>
                <SelectTrigger size="sm" className="w-[220px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {videoModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Eyebrow className="normal-case tracking-normal text-foreground/70">Resolution</Eyebrow>
              <Select
                value={video.videoResolution}
                onValueChange={(v) => setVideo((s) => ({ ...s, videoResolution: v }))}
              >
                <SelectTrigger size="sm" className="w-[110px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(videoEntry?.resolutions || []).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto self-end">
              <SaveButton onSave={saveVideo}>Save video defaults</SaveButton>
            </div>
          </div>
          {videoEntry ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {videoEntry.blurb} Offers {videoEntry.resolutions.join(" · ")}.
            </p>
          ) : null}
        </Panel>
      ) : null}

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
