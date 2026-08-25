// PUBLIC unified share view — /share/:token. One canonical link, two read-only
// tabs: the written WORLD and the SCRIPT. Which tabs appear is decided by the
// manifest (GET /api/share/:token); `?tab=world|script` deep-links to one.
//
// This route is a TOP-LEVEL SIBLING of RootLayout in src/router.jsx, on purpose:
// RootLayout wraps everything in LoginGate (a session + a render-provider key)
// plus the whole app shell — none of which a link viewer has or needs. Everything
// here is READ-ONLY: no field is editable, no image/sound/text can be changed.
// The script renders through the SAME TipTap extensions as the editor (just
// non-editable) so the screenplay formatting can never drift from what the author
// sees; the world reuses the shared Panel/ImageModal primitives.
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import {
  ScrollText, Globe, GitBranch, ChevronDown, Check, Loader2, Maximize2,
  Users, MapPin, BookOpen, Sparkles, Mic, PersonStanding,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Screenplay, transformCopiedScreenplay } from "@/components/notes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Panel, Empty, Eyebrow, ImageModal } from "@/components/shared";
import { ProductionTypeBadge } from "@/components/ProductionType";
import { useT } from "@/lib/i18n";

// The five story-map questions and the five story-depth elements — mirrors of the
// arrays in routes/world/written.jsx (labels only; this view never edits).
const MAP = [
  { key: "world", label: "1. What is the world of your story?", hint: "Where is it taking place?" },
  { key: "protagonist", label: "2. Who is the protagonist?", hint: "What is their main goal?" },
  { key: "antagonist", label: "3. Who or what is the antagonist?", hint: "The force standing in the way." },
  { key: "stakes", label: "4. What is the stake if they fail?", hint: "What is lost if the goal isn't met?" },
  { key: "theme", label: "5. What theme or message is driving the story?", hint: "The idea underneath it all." },
];
const DEPTH = [
  { key: "premise", label: "Premise", hint: "What is the story really about?" },
  { key: "wantVsNeed", label: "Character development", hint: "What they want vs. what they need." },
  { key: "conflict", label: "Conflict & stakes", hint: "Why the audience should care." },
  { key: "obstacles", label: "Obstacles & consequences", hint: "The obstacles — and what happens if they fail." },
  { key: "structure", label: "Story structure", hint: "How the story is shaped (the arc / beats)." },
];
// Which character fields to surface, and in what order. `archetype` is a badge.
const CHAR_VIEW = [
  { key: "role", label: "Role in the story" },
  { key: "want", label: "Want" },
  { key: "need", label: "Need" },
  { key: "traits", label: "Traits & personality" },
  { key: "arc", label: "Arc" },
  { key: "voice", label: "Voice" },
  { key: "appearance", label: "Appearance" },
];

export async function loader({ params }) {
  const { token } = params;
  const res = await fetch(`/api/share/${token}`);
  if (!res.ok) {
    throw new Response("This share link is no longer available.", {
      status: res.status,
      statusText: "Share link unavailable",
    });
  }
  const manifest = await res.json();
  // Fetch the enabled surfaces in parallel so the page paints in one shot. A
  // surface that races to 404 (revoked mid-load) simply renders as unavailable.
  const [script, world] = await Promise.all([
    manifest.script ? fetch(`/api/share/script/${token}`).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null),
    manifest.world ? fetch(`/api/share/world/${token}`).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null),
  ]);
  return { token, manifest, script, world };
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

/* ---------------------------------------------------------------- *
 * Read-only building blocks                                         *
 * ---------------------------------------------------------------- */

// A read-only prompt row: label + hint + the whole value, whitespace preserved.
function PromptView({ label, hint, value, big }) {
  const has = (value ?? "").trim();
  return (
    <div className="space-y-1">
      <Eyebrow className={cn("normal-case tracking-normal text-foreground/80", big && "text-sm")}>{label}</Eyebrow>
      {hint && <p className={cn("px-0.5 text-muted-foreground", big ? "text-sm" : "text-xs")}>{hint}</p>}
      <p
        className={cn(
          "whitespace-pre-wrap break-words px-0.5 leading-relaxed",
          has ? "text-foreground" : "text-muted-foreground",
          big ? "text-base leading-7" : "text-sm",
        )}
      >
        {has ? value : "—"}
      </p>
    </div>
  );
}

// A header button that opens a big modal showing the whole section, read-only.
function ExpandSection({ title, icon, children }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-muted-foreground">
        <Maximize2 size={13} /> {t("Expand")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{icon} {title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// A tappable reference image → opens the full-size lightbox.
function RefImage({ image, alt, label, icon, onImage }) {
  const t = useT();
  if (!image?.url) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/60 p-2">
      <button
        type="button"
        onClick={() => onImage({ url: image.url, name: image.name || alt, role: "reference" })}
        title={t("View full image")}
        className="shrink-0 overflow-hidden rounded-md border transition-colors hover:border-primary/60"
      >
        <img src={image.url} alt={image.name || alt} className="h-28 w-28 object-cover" />
      </button>
      {label && (
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {icon} {label}
        </span>
      )}
    </div>
  );
}

function CharacterView({ char, onImage, expanded }) {
  const t = useT();
  const fields = CHAR_VIEW.filter((f) => (char[f.key] ?? "").trim());
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className={cn("font-semibold", expanded ? "text-lg" : "text-sm")}>{char.name || t("Unnamed character")}</span>
        {char.archetype && <Badge variant="secondary" className="shrink-0">{char.archetype}</Badge>}
      </div>

      {(char.sheetImage || char.miniatureImage) && (
        <div className="flex flex-wrap gap-2">
          <RefImage image={char.sheetImage} alt={t("{name} sheet", { name: char.name || t("character") })} onImage={onImage} />
          <RefImage
            image={char.miniatureImage}
            alt={t("{name} miniature", { name: char.name || t("character") })}
            label={t("Wide-shot miniature")}
            icon={<PersonStanding size={13} className="text-primary" />}
            onImage={onImage}
          />
        </div>
      )}

      {fields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="space-y-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t(f.label)}</span>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{char[f.key]}</p>
            </div>
          ))}
        </div>
      )}

      {char.voiceRef?.url && (
        <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-2">
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Mic size={13} className="text-primary" /> {char.voiceRef.name || t("Voice")}
            {char.voiceRef.v != null && <span className="text-muted-foreground"> · v{char.voiceRef.v}</span>}
          </span>
          <audio controls src={char.voiceRef.url} preload="none" className="h-8 w-full max-w-sm" />
        </div>
      )}
    </div>
  );
}

function LocationView({ loc, onImage }) {
  const t = useT();
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{loc.name || t("Unnamed location")}</span>
        {loc.slug && <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{loc.slug}</Badge>}
      </div>
      <RefImage image={loc.sheetImage} alt={t("{name} sheet", { name: loc.name || t("location") })} onImage={onImage} />
      {(loc.description ?? "").trim() && (
        <div className="space-y-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Description")}</span>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{loc.description}</p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * World tab                                                        *
 * ---------------------------------------------------------------- */

function SharedWorld({ world }) {
  const t = useT();
  const [modalImage, setModalImage] = useState(null);
  if (!world) {
    return <Empty>{t("This world is no longer shared.")}</Empty>;
  }
  const characters = world.characters || [];
  const locations = world.locations || [];
  const mapFilled = MAP.filter((m) => (world.map?.[m.key] || "").trim());
  const depthFilled = DEPTH.filter((d) => (world.depth?.[d.key] || "").trim());

  return (
    <div className="space-y-6">
      {/* The series */}
      <Panel
        title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> {t("The series")}</span>}
        meta={<ProductionTypeBadge value={world.productionType} long />}
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Eyebrow className="normal-case tracking-normal text-foreground/80">{t("Title")}</Eyebrow>
            <p className="text-lg font-semibold">{world.title || t("Untitled world")}</p>
          </div>
          {(world.logline ?? "").trim() && (
            <div className="space-y-1">
              <Eyebrow className="normal-case tracking-normal text-foreground/80">{t("Logline")}</Eyebrow>
              <p className="text-base leading-7">{world.logline}</p>
            </div>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Story map */}
        <Panel
          title={<span className="flex items-center gap-2"><Globe size={15} className="text-primary" /> {t("Story map")}</span>}
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="outline">{mapFilled.length}/{MAP.length}</Badge>
              <ExpandSection title={t("Story map")} icon={<Globe size={18} className="text-primary" />}>
                {MAP.map((m) => (
                  <PromptView key={m.key} label={t(m.label)} hint={t(m.hint)} value={world.map?.[m.key]} big />
                ))}
              </ExpandSection>
            </div>
          }
        >
          <div className="space-y-4">
            {MAP.map((m) => (
              <PromptView key={m.key} label={t(m.label)} hint={t(m.hint)} value={world.map?.[m.key]} />
            ))}
          </div>
        </Panel>

        {/* Story depth */}
        <Panel
          title={<span className="flex items-center gap-2"><BookOpen size={15} className="text-primary" /> {t("Story depth")}</span>}
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="outline">{depthFilled.length}/{DEPTH.length}</Badge>
              <ExpandSection title={t("Story depth")} icon={<BookOpen size={18} className="text-primary" />}>
                {DEPTH.map((d) => (
                  <PromptView key={d.key} label={t(d.label)} hint={t(d.hint)} value={world.depth?.[d.key]} big />
                ))}
              </ExpandSection>
            </div>
          }
        >
          <div className="space-y-4">
            {DEPTH.map((d) => (
              <PromptView key={d.key} label={t(d.label)} hint={t(d.hint)} value={world.depth?.[d.key]} />
            ))}
          </div>
        </Panel>
      </div>

      {/* Characters */}
      <Panel
        title={<span className="flex items-center gap-2"><Users size={15} className="text-primary" /> {t("Characters")}</span>}
        meta={
          <div className="flex items-center gap-2">
            <Badge variant="info"><Users size={11} /> {characters.length}</Badge>
            {characters.length > 0 && (
              <ExpandSection title={t("Characters")} icon={<Users size={18} className="text-primary" />}>
                {characters.map((char) => (
                  <CharacterView key={char.id} char={char} expanded onImage={setModalImage} />
                ))}
              </ExpandSection>
            )}
          </div>
        }
      >
        {characters.length === 0 ? (
          <Empty>{t("no characters shared.")}</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {characters.map((char) => (
              <CharacterView key={char.id} char={char} onImage={setModalImage} />
            ))}
          </div>
        )}
      </Panel>

      {/* Locations */}
      <Panel
        title={<span className="flex items-center gap-2"><MapPin size={15} className="text-primary" /> {t("Locations")}</span>}
        meta={
          <div className="flex items-center gap-2">
            <Badge variant="info"><MapPin size={11} /> {locations.length}</Badge>
            {locations.length > 0 && (
              <ExpandSection title={t("Locations")} icon={<MapPin size={18} className="text-primary" />}>
                {locations.map((loc) => (
                  <LocationView key={loc.id} loc={loc} onImage={setModalImage} />
                ))}
              </ExpandSection>
            )}
          </div>
        }
      >
        {locations.length === 0 ? (
          <Empty>{t("no locations shared.")}</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {locations.map((loc) => (
              <LocationView key={loc.id} loc={loc} onImage={setModalImage} />
            ))}
          </div>
        )}
      </Panel>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Script tab                                                       *
 * ---------------------------------------------------------------- */

function SharedScript({ token, initial }) {
  const t = useT();
  const drafts = initial?.drafts || [];
  const [current, setCurrent] = useState({
    draftId: initial?.draftId,
    title: initial?.title,
    doc: initial?.doc,
    updatedAt: initial?.updatedAt,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const cache = useRef(initial?.draftId ? { [initial.draftId]: initial } : {});

  const editor = useEditor({
    editable: false,
    extensions: [Screenplay, StarterKit, TextStyle, Color, TaskList, TaskItem.configure({ nested: true })],
    content: current.doc || { type: "doc", content: [] },
    editorProps: {
      attributes: { class: "focus:outline-none" },
      transformCopied: transformCopiedScreenplay,
    },
  });

  const pick = useCallback(
    async (id) => {
      if (!editor || id === current.draftId || busy) return;
      setErr(null);
      const apply = (d) => {
        setCurrent({ draftId: d.draftId, title: d.title, doc: d.doc, updatedAt: d.updatedAt });
        editor.commands.setContent(d.doc || { type: "doc", content: [] });
      };
      if (cache.current[id]) return apply(cache.current[id]);
      setBusy(true);
      try {
        const res = await fetch(`/api/share/script/${token}?draftId=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(t("This share link is no longer available."));
        const d = await res.json();
        cache.current[d.draftId] = d;
        apply(d);
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        setBusy(false);
      }
    },
    [editor, current.draftId, busy, token, t],
  );

  const currentName = drafts.find((d) => d.id === current.draftId)?.name || t("Draft");

  if (!initial) {
    return <Empty>{t("This script is no longer shared.")}</Empty>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1.5">
        <h2 className="text-2xl font-bold tracking-tight">{current.title || t("Untitled script")}</h2>
        {current.updatedAt ? (
          <p className="text-xs text-muted-foreground">{t("Last updated")} {fmtDate(current.updatedAt)}</p>
        ) : null}
      </header>

      {drafts.length > 1 ? (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">{t("Version")}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 justify-between gap-1.5 text-xs" disabled={busy}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <GitBranch size={13} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{currentName}</span>
                </span>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} className="shrink-0 opacity-60" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 min-w-56 overflow-y-auto">
              {drafts.map((d) => (
                <DropdownMenuItem key={d.id} onClick={() => pick(d.id)} className="flex items-center gap-2 text-xs">
                  {d.id === current.draftId ? (
                    <Check size={13} className="shrink-0 text-primary" />
                  ) : (
                    <span className="w-[13px] shrink-0" />
                  )}
                  <span className="truncate">{d.name}</span>
                  <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">{d.lineCount} {t("lines")}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {err ? <p className="text-sm text-destructive" role="alert">{err}</p> : null}

      <div className="notes-editor bg-card">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * The page                                                        *
 * ---------------------------------------------------------------- */

export function Component() {
  const t = useT();
  const { token, manifest, script, world } = useLoaderData();
  const [params, setParams] = useSearchParams();

  // Which tabs exist, in display order.
  const tabs = useMemo(() => {
    const out = [];
    if (manifest.world) out.push("world");
    if (manifest.script) out.push("script");
    return out;
  }, [manifest]);

  const wanted = params.get("tab");
  const initialTab = tabs.includes(wanted) ? wanted : tabs[0];
  const [tab, setTab] = useState(initialTab);

  // Keep the URL's ?tab in sync so a copied link re-opens on the same tab.
  useEffect(() => {
    if (!tab || params.get("tab") === tab) return;
    const next = new URLSearchParams(params);
    next.set("tab", tab);
    setParams(next, { replace: true });
  }, [tab, params, setParams]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:py-12">
        <header className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ScrollText size={13} /> {t("Shared · read-only")}
        </header>

        {tabs.length > 1 ? (
          <Tabs value={tab} onValueChange={setTab} className="space-y-5">
            <TabsList>
              <TabsTrigger value="world" className="gap-1.5"><Globe size={14} /> {t("World")}</TabsTrigger>
              <TabsTrigger value="script" className="gap-1.5"><ScrollText size={14} /> {t("Script")}</TabsTrigger>
            </TabsList>
            <TabsContent value="world"><SharedWorld world={world} /></TabsContent>
            <TabsContent value="script"><SharedScript token={token} initial={script} /></TabsContent>
          </Tabs>
        ) : tabs[0] === "world" ? (
          <SharedWorld world={world} />
        ) : (
          <SharedScript token={token} initial={script} />
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">{t("Shared from StorySeam")}</footer>
      </div>
    </div>
  );
}
