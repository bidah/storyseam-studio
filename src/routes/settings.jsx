// Settings — opened from the header avatar menu (not a top tab). Edits the
// project's image-generation prompts: the visual-world STYLE presets (the house
// look prepended to every generation) and the CHARACTER/LOCATION sheet prompts
// layered on top when a generation is tagged as a design sheet (the composer
// checkboxes on World › Visual, or the agent's sheet-generation skill).
//
// Backed by the same /api/visual-world doc as the Visual tab, so it shares the
// "visual-world" swr cache key and the canonical invalidate+revalidate pair.
import { useCallback, useEffect, useState } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { Loader2, Save, Plus, Trash2, IdCard, MapPin, Package, Palette, Check, SlidersHorizontal, KeyRound, ExternalLink, Globe, TerminalSquare, Cpu, Clapperboard, Cable, Film, RotateCcw, CopyPlus, Plug, Blocks, ArrowRight } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import {
  useHiggsfieldLinked, connectHiggsfield, disconnectHiggsfield,
} from "@/lib/higgsfieldAccount";
import { useFalKey, setFalKey, clearFalKey } from "@/lib/falKey";
import { useAtlasKey, setAtlasKey, clearAtlasKey } from "@/lib/atlasKey";
import { PROVIDERS, useProviderPrefs, setActiveProvider, providerEnabled } from "@/lib/providers";
import {
  useExaKey, setExaKey, clearExaKey,
  useFirecrawlKey, setFirecrawlKey, clearFirecrawlKey,
} from "@/lib/searchKeys";
import { SEARCH_PROVIDERS, useSearchProvider, setSearchProvider } from "@/lib/searchProviders";
import { SANDBOX_MODES, useSandboxMode, setSandboxMode } from "@/lib/sandboxMode";
import { CHAT_PROVIDERS, OFFERED_CHAT_PROVIDERS, useChatProvider, setChatProvider } from "@/lib/chatProvider";
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
import { McpSetup } from "@/components/UseMcpModal";
import { SubscriptionPanel } from "@/components/SubscriptionPanel";
import { CORE, PLUGINS, SHOW_PLUGIN_MARKETPLACE } from "@/lib/plugins";
import { usePlugins } from "@/components/PluginsProvider";
import { cn } from "@/lib/utils";
import { PRODUCTION_TYPES } from "@/lib/productionType";
import { ProductionTypeBadge } from "@/components/ProductionType";
import { ASPECTS } from "@/components/ImageStudio";
import { useLocale, useT } from "@/lib/i18n";
import { Languages } from "lucide-react";
import { useStudioPath } from "@/lib/studioNav";

// Radix Select forbids empty-string item values — sentinel maps back to ""
// (empty model = the server default, Nano Banana Pro).
const DEFAULT_MODEL = "__default__";

async function put(path, body) {
  return send(path, "PUT", body);
}

// Same, for the routes that take a POST (the shot directors).
async function post(path, body) {
  return send(path, "POST", body);
}

async function send(path, method, body) {
  const res = await fetch(path, {
    method,
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
  const t = useT();
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
        aria-label={t("{label} API key", { label })}
      />
      <Button size="sm" disabled={!plausible} onClick={() => { save(draft); setDraft(""); }}>
        {keyValue ? t("Replace key") : t("Save key")}
      </Button>
      {keyValue ? (
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={clear}>
          {t("Remove")}
        </Button>
      ) : null}
      <a
        href={keysUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("Get a key")} <ExternalLink size={11} />
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
  const t = useT();
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
    <Panel title={<span className="flex items-center gap-2"><Cpu size={15} className="text-primary" /> {t("Chat provider")}</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("Which models the chat agent's model picker offers. ")}
        <b>{t("One provider is in use at a time")}</b>
        {t(" — switching snaps the picker, and the next message, to that provider's models. ")}
        <b>{t("Cerebras")}</b>
        {t(" serves Gemma 4 31B, Z.AI GLM-4.7 and GPT-OSS 120B on ultra-fast inference through Cloudflare AI Gateway, and needs a Cerebras key configured on the agent worker.")}
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
                {isActive ? <Badge variant="success">{t("In use")}</Badge> : null}
                {p.id === "cloudflare" ? <Badge variant="muted">{t("Default")}</Badge> : null}
                {gated && available ? <Badge variant="muted">{t("Ready")}</Badge> : null}
                {gated && available === false ? <Badge variant="warning">{t("Needs a key")}</Badge> : null}
                <div className={PROVIDERS.length === 1 ? "hidden" : "ml-auto"}>
                  <Switch
                    checked={isActive}
                    disabled={!available}
                    onCheckedChange={(on) => { if (on && available) setChatProvider(p.id); }}
                    aria-label={t("Use {provider} for chat", { provider: p.label })}
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
  const t = useT();
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
    <Panel title={<span className="flex items-center gap-2"><Cable size={15} className="text-primary" /> {t("Connectors")}</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("External accounts linked to your sign-in. Connecting ")}
        <b>{t("Higgsfield")}</b>
        {t(" runs a one-tap OAuth flow and lets StorySeam render images, video &amp; audio on your Higgsfield account — and browse your past generations in the library.")}
      </p>
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Higgsfield</span>
          {linked === true ? <Badge variant="success">{t("Connected")}</Badge> : null}
          {linked === false ? <Badge variant="warning">{t("Not connected")}</Badge> : null}
          {linked === null ? <Badge variant="muted">{t("Checking…")}</Badge> : null}
          {linked === "error" ? <Badge variant="warning">{t("Status unknown")}</Badge> : null}
          <div className="ml-auto flex items-center gap-2">
            {linked === true ? (
              <Button
                size="sm" variant="ghost" disabled={busy}
                className="text-destructive hover:text-destructive"
                onClick={() => run(disconnectHiggsfield)}
              >
                {t("Disconnect")}
              </Button>
            ) : (
              <Button size="sm" disabled={busy || linked === null} onClick={() => run(() => connectHiggsfield("/settings"))}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {t("Connect")}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {linked === true
            ? t("Renders and imports use this account's credits. Disconnecting stops Higgsfield renders until you reconnect.")
            : t("You'll be sent to Higgsfield to approve access, then straight back here.")}
        </p>
        {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
      </div>
    </Panel>
  );
}

// The remote-MCP connector, in Settings. The body lives in
// components/UseMcpModal.jsx because the header's "USE MCP" button opens the
// same content as a standalone dialog — one implementation, two frames.
function McpConnectorPanel() {
  const t = useT();
  return (
    <Panel title={<span className="flex items-center gap-2"><Plug size={15} className="text-primary" /> {t("MCP connector")}</span>}>
      <McpSetup />
    </Panel>
  );
}

function ProvidersPanel() {
  const t = useT();
  const prefs = useProviderPrefs();
  const falKey = useFalKey();
  const atlasKey = useAtlasKey();
  const hfLinked = useHiggsfieldLinked();

  const rows = {
    higgsfield: {
      status: (
        <span className="text-xs text-muted-foreground">
          {hfLinked === true
            ? t("Connected through your linked Higgsfield account — no key needed.")
            : t("Not connected — link your Higgsfield account in the Connectors panel above.")}
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
    <Panel title={<span className="flex items-center gap-2"><KeyRound size={15} className="text-primary" /> {t("Render providers")}</span>}>
      {PROVIDERS.length === 1 ? (
      <p className="mb-3 text-sm text-muted-foreground">
        {t("StorySeam covers sandboxing and the inference that writes and plans your story. Image, video, voice and soundtrack generations bill ")}
        <b>{t("your {provider} credits", { provider: PROVIDERS[0].label })}</b>
        {t(". Your fal key is stored encrypted on your account, so Films keep rendering with no tab open, and it is only ever used for your own generations.")}
      </p>
      ) : (
      <p className="mb-3 text-sm text-muted-foreground">
        {t("Renders bill ")}
        <b>{t("your")}</b>
        {t(" accounts. Your fal key is stored encrypted on your account (so Films keep rendering with no tab open); other keys stay in this browser. You can keep credentials for all three, but ")}
        <b>{t("one provider is in use at a time")}</b>
        {t(" — switching one on switches the others off. Jobs already running on another provider still finish.")}
      </p>
      )}
      <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const row = rows[p.id];
          const isActive = prefs.active === p.id;
          return (
            <div key={p.id} className={`rounded-lg border p-3 ${isActive ? "border-primary/40" : "opacity-70"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                {isActive ? <Badge variant="success">{t("In use")}</Badge> : null}
                <div className="ml-auto">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(on) => { if (on) setActiveProvider(p.id); }}
                    aria-label={t("Use {provider}", { provider: p.label })}
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
  const t = useT();
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
    <Panel title={<span className="flex items-center gap-2"><Globe size={15} className="text-primary" /> {t("Web search")}</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("How the agent reaches the open web — for research, fact-checking, and reading links you paste. ")}
        <b>{t("One provider is in use at a time")}</b>
        {t("; the agent's tools are named the same either way, so switching changes nothing else. Your own key is optional and takes precedence when set; keys stay in this browser and are never saved on our servers.")}
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
                {isActive ? <Badge variant="success">{t("In use")}</Badge> : null}
                {!k.value && hasOperatorKey ? <Badge variant="muted">{t("Built-in key")}</Badge> : null}
                {!k.value && hasOperatorKey === false ? <Badge variant="warning">{t("Needs a key")}</Badge> : null}
                <div className="ml-auto">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(on) => { if (on) setSearchProvider(p.id); }}
                    aria-label={t("Use {provider} for web search", { provider: p.label })}
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
  const t = useT();
  const active = useSandboxMode();
  return (
    <Panel title={<span className="flex items-center gap-2"><TerminalSquare size={15} className="text-primary" /> {t("Sandbox")}</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("Where the agent runs shell commands and multi-step skills. ")}
        <b>{t("In-memory resets between messages")}</b>
        {t(" — files the agent writes in one reply are gone by the next. Switch to a container when a job has to write something now and read it back later. Applies to ")}
        <b>{t("new messages in every chat")}</b>
        {t(", and takes effect immediately.")}
      </p>
      <div className="space-y-3">
        {SANDBOX_MODES.map((m) => {
          const isActive = active === m.id;
          return (
            <div key={m.id} className={`rounded-lg border p-3 ${isActive ? "border-primary/40" : "opacity-70"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.label}</span>
                {isActive ? <Badge variant="success">{t("In use")}</Badge> : null}
                {m.id === "memory" ? <Badge variant="muted">{t("Default")}</Badge> : null}
                {m.id === "daytona" ? <Badge variant="warning">{t("Billed")}</Badge> : null}
                <div className="ml-auto">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(on) => { if (on) setSandboxMode(m.id); }}
                    aria-label={t("Run the agent's shell on {mode}", { mode: m.label })}
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

// Interface language: which locale the studio UI renders in. A per-browser
// preference (localStorage) — it changes UI copy only, takes effect immediately,
// and doesn't touch project data.
// PLUGINS — which surfaces this project has. High in the page on purpose: it
// frames everything below it (there is no point tuning the shot director on a
// project whose Shot list is switched off).
//
// The panel lists the whole catalog, not just what's on, because "installed"
// only means something next to "available" — a list of four rows with four
// switches reads as a settings group; the full list reads as the shape of the
// project. Uninstalled rows are dimmed exactly like an inactive provider row.
//
// install()/remove() rather than a single setter: usePlugins applies both
// optimistically, so the switch moves under the finger and the request settles
// behind it.
function PluginsPanel() {
  const studio = useStudioPath();
  const t = useT();
  const { loading, error, isEnabled, install, remove } = usePlugins();
  const categories = [];
  for (const p of PLUGINS) if (categories.indexOf(p.category) < 0) categories.push(p.category);

  return (
    <Panel
      title={<span className="flex items-center gap-2"><Blocks size={15} className="text-primary" /> {t("Plugins")}</span>}
      meta={(
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to={studio("/plugins")}>{t("Explore plugins")} <ArrowRight size={14} /></Link>
        </Button>
      )}
    >
      <p className="mb-3 text-sm text-muted-foreground">
        {t("The core surfaces — ")}
        <b>{CORE.map((c) => t(c.label)).join(", ")}</b>
        {t(" — are always on and aren't listed here. Everything else is a plugin: turning one off hides its tab and nothing else. ")}
        <b>{t("Your work is never deleted")}</b>
        {t(", and turning it back on brings the tab back as you left it.")}
      </p>

      {error ? <ErrorNote>{String(error?.message || error)}</ErrorNote> : null}

      <div className="space-y-4">
        {categories.map((cat) => (
          <div key={cat}>
            <Eyebrow className="mb-2">{t(cat)}</Eyebrow>
            <div className="space-y-2">
              {PLUGINS.filter((p) => p.category === cat).map((p) => {
                const on = isEnabled(p.id);
                return (
                  <div key={p.id} className={`rounded-lg border p-3 ${on ? "border-primary/40" : "opacity-70"}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t(p.name)}</span>
                      {on ? <Badge variant="success">{t("Installed")}</Badge> : null}
                      <div className="ml-auto">
                        <Switch
                          checked={on}
                          disabled={loading}
                          onCheckedChange={(next) => {
                            // Not awaited (the provider is optimistic) and the
                            // rejection is swallowed — it already surfaces as
                            // `error` above, and rolls the switch back itself.
                            (next ? install(p.id) : remove(p.id))?.catch?.(() => {});
                          }}
                          aria-label={t("Install {plugin}", { plugin: p.name })}
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t(p.tagline)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LanguagePanel() {
  const t = useT();
  const { locale, setLocale, locales } = useLocale();
  return (
    <Panel title={<span className="flex items-center gap-2"><Languages size={15} className="text-primary" /> {t("Language")}</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("Choose the language for the studio interface. Your choice is saved in this browser.")}
      </p>
      <div>
        <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Interface language")}</Eyebrow>
        <Select value={locale} onValueChange={setLocale}>
          <SelectTrigger size="sm" className="w-[220px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {locales.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {t(l.label)} — {l.nativeLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Panel>
  );
}

// SHOT LIST DIRECTOR — the prompt system a shot's render prompt is written with.
//
// The project's production type (2D / 3D-Pixar / live action) says what kind of
// film this is; a DIRECTOR says how a shot is written for it, and it is the
// thing the author actually tunes: the brief the agent follows, and the FORM the
// prompt takes (one paragraph, or the Seedance block document). One director is
// in use per production type, so this panel shows all three and marks the one
// this project is currently writing with.
//
// The text shown IS the text the agent reads back (`get_shot_director`) — not a
// summary of it — so editing here changes the next shots that get written. Edits
// to a built-in can be reverted ("Reset"); "Save as new version" keeps the
// original and switches to the copy, which is how you try a variant without
// losing the one that works.
function DirectorPanel() {
  const t = useT();
  const [data, setData] = useState(null);      // GET /api/shot-directors payload
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(null);        // production type being inspected
  const [pickedId, setPickedId] = useState({});// per production type, the one being VIEWED
  const [draft, setDraft] = useState(null);    // { id, name, instructions, promptForm }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shot-directors");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load");
      setData(j);
      setTab((cur) => cur || j.productionType);
      setErr(null);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pt = tab || data?.productionType || "2d";
  const directors = data?.directors || [];
  // Every director is offerable for every production type — the Seedance
  // director on a 2D project is a legitimate choice, and the app branches on the
  // director's prompt form, not the type. The ones MADE for this type sort
  // first; the rest are labelled with where they came from.
  const forType = [
    ...directors.filter((d) => d.productionType === pt),
    ...directors.filter((d) => d.productionType !== pt),
  ];
  const activeId = data?.active?.[pt];
  // What's on screen: the author's pick for this tab, else the active one.
  const viewingId = pickedId[pt] && forType.some((d) => d.id === pickedId[pt]) ? pickedId[pt] : activeId;
  const viewing = directors.find((d) => d.id === viewingId) || forType[0] || null;

  // The draft follows whichever director is being viewed, until it's edited.
  useEffect(() => {
    if (!viewing) { setDraft(null); return; }
    setDraft({
      id: viewing.id,
      name: viewing.name,
      promptForm: viewing.promptForm,
      instructions: viewing.instructions,
    });
  }, [viewing?.id, viewing?.instructions, viewing?.name, viewing?.promptForm]);

  const dirty = !!(draft && viewing && (
    draft.instructions !== viewing.instructions ||
    draft.name !== viewing.name ||
    draft.promptForm !== viewing.promptForm
  ));

  const call = async (body) => {
    setBusy(true);
    setErr(null);
    try {
      const j = await post("/api/shot-directors", body);
      setData(j);
      if (j.active?.[pt]) setPickedId((s) => ({ ...s, [pt]: j.saved || j.active[pt] }));
    } catch (e) {
      // Reported in the panel — never rethrown, so a click handler doesn't
      // leave an unhandled rejection behind.
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (err && !data) {
    return (
      <Panel title={<span className="flex items-center gap-2"><Film size={15} className="text-primary" /> {t("Shot list director")}</span>}>
        <ErrorNote>{err}</ErrorNote>
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel title={<span className="flex items-center gap-2"><Film size={15} className="text-primary" /> {t("Shot list director")}</span>}>
        <p className="text-sm text-muted-foreground"><Loader2 size={14} className="inline animate-spin" /> {t("Loading…")}</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={<span className="flex items-center gap-2"><Film size={15} className="text-primary" /> {t("Shot list director")}</span>}
      meta={<ProductionTypeBadge value={data.productionType} long />}
    >
      <p className="mb-3 text-sm text-muted-foreground">
        {t("The prompt system your shots are written with — by the agent when it breaks the script into a shot list, and whenever you ask it for a single new shot. Each production type has one director in use; this project writes with the one marked ")}
        <b>{t("In use")}</b>
        {t(" under its production type. What you edit here is exactly the brief the agent reads, so a change lands on the next shots written — it never rewrites shots that already exist.")}
      </p>

      {/* Production type = the World tab's setting; switching tabs here only
          LOOKS at another type's director, it doesn't change the project. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PRODUCTION_TYPES.map((p) => {
          const on = p.id === pt;
          const isProject = p.id === data.productionType;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setTab(p.id)}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                on ? "border-primary bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted",
              )}
            >
              {t(p.label)}
              {isProject ? <Badge variant="success">{t("this project")}</Badge> : null}
            </button>
          );
        })}
      </div>

      {/* The directors available for this production type. Clicking one views
          it; "Use this one" is what actually switches the project over. */}
      <div className="space-y-1.5">
        {forType.map((d) => {
          const on = d.id === viewingId;
          const inUse = d.id === activeId;
          return (
            <div
              key={d.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors",
                on ? "border-primary/50" : "opacity-80 hover:bg-muted/40",
              )}
            >
              <button type="button" className="text-left font-medium" onClick={() => setPickedId((s) => ({ ...s, [pt]: d.id }))}>
                {d.name}
              </button>
              <Badge variant="muted">{d.promptForm === "blocks" ? t("block prompt") : t("single prompt")}</Badge>
              {d.productionType !== pt ? (
                <Badge variant="outline">{t("made for")} {t(PRODUCTION_TYPES.find((p) => p.id === d.productionType)?.short || d.productionType)}</Badge>
              ) : null}
              {d.builtin ? <Badge variant="muted">{t("built-in")}</Badge> : null}
              {d.edited ? <Badge variant="warning">{t("edited")}</Badge> : null}
              {inUse ? <Badge variant="success">{t("In use")}</Badge> : null}
              <div className="ml-auto flex items-center gap-1.5">
                {!inUse && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => call({ id: d.id, productionType: pt, activate: true })}>
                    {t("Use this one")}
                  </Button>
                )}
                {d.builtin && d.edited && (
                  <Button size="sm" variant="ghost" disabled={busy} title={t("Restore the shipped text")} onClick={() => call({ id: d.id, reset: true })}>
                    <RotateCcw size={13} /> {t("Reset")}
                  </Button>
                )}
                {!d.builtin && (
                  <Button
                    size="sm" variant="ghost" disabled={busy}
                    className="text-destructive hover:text-destructive"
                    aria-label={t("Delete this version")}
                    onClick={() => call({ id: d.id, delete: true })}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
              {d.blurb ? <p className="w-full text-xs text-muted-foreground">{d.blurb}</p> : null}
            </div>
          );
        })}
      </div>

      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}

      {/* The prompt itself. */}
      {draft && (
        <div className="mt-3 space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draft.name}
              onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
              className="h-8 flex-1 text-sm font-medium"
              placeholder={t("Director name")}
              aria-label={t("Director name")}
            />
            <div>
              <Select value={draft.promptForm} onValueChange={(v) => setDraft((s) => ({ ...s, promptForm: v }))}>
                <SelectTrigger size="sm" className="w-[190px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paragraph">{t("Single prompt field")}</SelectItem>
                  <SelectItem value="blocks">{t("Block document (promptBlocks)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            value={draft.instructions}
            onChange={(e) => setDraft((s) => ({ ...s, instructions: e.target.value }))}
            rows={18}
            className="font-mono text-xs"
            placeholder={t("The brief the shot writer follows…")}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {draft.promptForm === "blocks"
                ? t("Shots written by this director carry the block document (promptBlocks), whose section names are fixed — the Shot list tab edits them block by block.")
                : t("Shots written by this director carry their whole render prompt in one field, structured however these instructions say.")}
            </p>
            <div className="flex items-center gap-1.5">
              {dirty && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft({
                  id: viewing.id, name: viewing.name, promptForm: viewing.promptForm, instructions: viewing.instructions,
                })}>
                  {t("Discard")}
                </Button>
              )}
              <Button
                size="sm" variant="outline" disabled={busy || !draft.instructions.trim()}
                title={t("Keep the current one and save this text as a new version")}
                onClick={() => call({
                  id: draft.id, productionType: pt, newVersion: true,
                  name: `${viewing.name} v${(viewing.version || 1) + 1}`,
                  promptForm: draft.promptForm, instructions: draft.instructions,
                })}
              >
                <CopyPlus size={13} /> {t("Save as new version")}
              </Button>
              <Button
                size="sm" disabled={busy || !dirty}
                onClick={() => call({
                  id: draft.id, productionType: pt, name: draft.name,
                  promptForm: draft.promptForm, instructions: draft.instructions,
                })}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t("Save changes")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

// Save button with a transient "Saved" confirmation.
function SaveButton({ onSave, children = "Save" }) {
  const t = useT();
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
      {state === "saved" ? t("Saved") : children}
    </Button>
  );
}

function SettingsPage() {
  const t = useT();
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
        <h2 className="text-xl font-semibold tracking-tight">{t("Settings")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Project-wide prompts — the shot director your shot list is written with, the house style for image generation, and the sheet prompts layered on top when a generation is tagged as a character, location, or prop sheet.")}
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <SubscriptionPanel />

      <LanguagePanel />

      {SHOW_PLUGIN_MARKETPLACE && <PluginsPanel />}

      <DirectorPanel />

      {/* One provider offered (film-plan.ts HIDE_EXTRA_MODELS) = nothing to pick. */}
      {OFFERED_CHAT_PROVIDERS.length > 1 ? <ChatProviderPanel /> : null}

      {providerEnabled("higgsfield") ? <ConnectorsPanel /> : null}

      <McpConnectorPanel />

      <ProvidersPanel />

      <SearchPanel />

      <SandboxPanel />

      <Panel title={<span className="flex items-center gap-2"><SlidersHorizontal size={15} className="text-primary" /> {t("Generation defaults")}</span>}>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("The image model, aspect ratio and resolution used by default — by the World › Visual composer ")}
          <b>{t("and by the agent")}</b>
          {t(" whenever it generates images (concept art, character sheets, location sheets), unless you override them for a specific generation.")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Image model")}</Eyebrow>
            <Select value={gen.model || DEFAULT_MODEL} onValueChange={(v) => pickGenModel(v === DEFAULT_MODEL ? "" : v)}>
              <SelectTrigger size="sm" className="w-[220px] text-xs"><SelectValue placeholder="Nano Banana Pro" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL}>{t("Nano Banana Pro (default)")}</SelectItem>
                {models.filter((m) => m.id).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Aspect ratio")}</Eyebrow>
            <Select value={gen.aspectRatio} onValueChange={(v) => setGen((s) => ({ ...s, aspectRatio: v }))}>
              <SelectTrigger size="sm" className="w-[110px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Resolution")}</Eyebrow>
            {genResolutions.length ? (
              <Select value={gen.resolution} onValueChange={(v) => setGen((s) => ({ ...s, resolution: v }))}>
                <SelectTrigger size="sm" className="w-[90px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{genResolutions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Select value="none" disabled>
                <SelectTrigger size="sm" className="w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">{t("Model default")}</SelectItem></SelectContent>
              </Select>
            )}
          </div>
          <div className="ml-auto self-end">
            <SaveButton onSave={saveGen}>{t("Save defaults")}</SaveButton>
          </div>
        </div>
      </Panel>

      {/* Rendered only once the catalog is on the payload — an older worker
          returns no `videoModels`, and a picker with no options is worse than
          no picker. */}
      {videoModels.length ? (
        <Panel title={<span className="flex items-center gap-2"><Clapperboard size={15} className="text-primary" /> {t("Video defaults")}</span>}>
          <p className="mb-3 text-sm text-muted-foreground">
            {t("The Seedance model and resolution the ")}
            <b>{t("render skills")}</b>
            {t(" use by default — the episode multishot renders, shot continuations, and the agent's video generations — unless you name different ones for a specific render. Each model carries its own resolution list, so picking one narrows what's on offer.")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Video model")}</Eyebrow>
              <Select value={video.videoModel} onValueChange={pickVideoModel}>
                <SelectTrigger size="sm" className="w-[220px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {videoModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Resolution")}</Eyebrow>
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
              <SaveButton onSave={saveVideo}>{t("Save video defaults")}</SaveButton>
            </div>
          </div>
          {videoEntry ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {videoEntry.blurb} {t("Offers {resolutions}.", { resolutions: videoEntry.resolutions.join(" · ") })}
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel title={<span className="flex items-center gap-2"><Palette size={15} className="text-primary" /> {t("Style prompts")}</span>}>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("The reusable style presets of the visual world generator. The ")}
          <b>{t("image")}</b>
          {t(" block is prepended to every scene as the house style; the ")}
          <b>{t("video")}</b>
          {t(" block is kept for later Seedance renders.")}
        </p>
        <div className="space-y-4">
          {prompts.map((p) => (
            <div key={p.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input value={p.name} onChange={(e) => editPrompt(p.id, "name", e.target.value)} className="h-8 flex-1 text-sm font-medium" placeholder={t("Preset name")} />
                {p.builtin && <Badge variant="muted">{t("seed")}</Badge>}
                <Button variant="ghost" size="icon-sm" aria-label={t("Delete preset")} onClick={() => removePrompt(p.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={14} />
                </Button>
              </div>
              <div>
                <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Image style")}</Eyebrow>
                <Textarea value={p.image} onChange={(e) => editPrompt(p.id, "image", e.target.value)} rows={5} className="text-sm" placeholder={t("Style, palette, composition…")} />
              </div>
              <div>
                <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Video / motion (optional)")}</Eyebrow>
                <Textarea value={p.video} onChange={(e) => editPrompt(p.id, "video", e.target.value)} rows={2} className="text-sm" placeholder={t("Camera & motion clauses for Seedance…")} />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addPrompt}><Plus size={13} /> {t("Add preset")}</Button>
            <SaveButton onSave={savePrompts}>{t("Save style prompts")}</SaveButton>
          </div>
        </div>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><IdCard size={15} className="text-primary" /> {t("Character sheet prompt")}</span>}>
        <p className="mb-2 text-sm text-muted-foreground">
          {t("Added on top of the style prompt when a generation is tagged as a ")}
          <b>{t("character sheet")}</b>
          {t(" — via the checkbox on World › Visual, or when you ask the agent for one.")}
        </p>
        <Textarea
          value={sheets.character}
          onChange={(e) => setSheets((s) => ({ ...s, character: e.target.value }))}
          rows={5}
          className="text-sm"
          placeholder={t("Turnaround views, neutral background, consistent proportions…")}
        />
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><MapPin size={15} className="text-primary" /> {t("Location sheet prompt")}</span>}>
        <p className="mb-2 text-sm text-muted-foreground">
          {t("Added on top of the style prompt when a generation is tagged as a ")}
          <b>{t("location sheet")}</b>
          {t(".")}
        </p>
        <Textarea
          value={sheets.location}
          onChange={(e) => setSheets((s) => ({ ...s, location: e.target.value }))}
          rows={5}
          className="text-sm"
          placeholder={t("Establishing wide view plus key-angle vignettes, no characters…")}
        />
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Package size={15} className="text-primary" /> {t("Prop sheet prompt")}</span>}>
        <p className="mb-2 text-sm text-muted-foreground">
          {t("Added on top of the style prompt when a generation is tagged as a ")}
          <b>{t("prop sheet")}</b>
          {t(" — the objects characters carry and handle, rendered as multi-view reference art the video models can lock onto.")}
        </p>
        <Textarea
          value={sheets.prop}
          onChange={(e) => setSheets((s) => ({ ...s, prop: e.target.value }))}
          rows={5}
          className="text-sm"
          placeholder={t("Front, three-quarter and side views of the same object, no hands, neutral backdrop…")}
        />
        <div className="mt-3 flex justify-end">
          <SaveButton onSave={saveSheets}>{t("Save sheet prompts")}</SaveButton>
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
