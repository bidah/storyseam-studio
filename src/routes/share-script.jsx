// PUBLIC share view — /share/script/:token. A read-only rendering of a shared
// script, with a version switcher so a link viewer can flip between EVERY draft
// the author keeps (the author's chosen draft lands first; the pinned one when
// none was chosen).
//
// This route is a TOP-LEVEL SIBLING of RootLayout in src/router.jsx, on
// purpose: RootLayout wraps everything in LoginGate (which demands a session
// AND a render-provider key) plus the whole app shell — none of which a link
// viewer has or needs. The doc renders through the SAME TipTap extensions as
// the editor, just non-editable, so the screenplay formatting can never drift
// from what the author sees; the `.notes-editor` wrapper carries all the
// `sp-*` CSS (src/index.css).
import { useState, useRef, useCallback } from "react";
import { useLoaderData } from "react-router";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { ScrollText, GitBranch, ChevronDown, Check, Loader2 } from "lucide-react";
import { Screenplay, transformCopiedScreenplay } from "@/components/notes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";

export async function loader({ params }) {
  const res = await fetch(`/api/share/script/${params.token}`);
  if (!res.ok) {
    throw new Response("This share link is no longer available.", {
      status: res.status,
      statusText: "Share link unavailable",
    });
  }
  const data = await res.json();
  return { ...data, token: params.token };
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

export function Component() {
  const t = useT();
  const initial = useLoaderData();
  const { drafts = [], token } = initial;

  // The draft currently on screen. Starts on whatever the loader resolved (the
  // author's chosen default), and swaps as the viewer picks another version.
  const [current, setCurrent] = useState({
    draftId: initial.draftId,
    title: initial.title,
    doc: initial.doc,
    updatedAt: initial.updatedAt,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Cache fetched draft bodies so re-picking a version is instant and free.
  const cache = useRef({ [initial.draftId]: initial });

  const editor = useEditor({
    editable: false,
    extensions: [Screenplay, StarterKit, TextStyle, Color, TaskList, TaskItem.configure({ nested: true })],
    content: current.doc || { type: "doc", content: [] },
    editorProps: {
      attributes: { class: "focus:outline-none" },
      // Read-only, but still copyable: a passage lifted off the share page keeps
      // its screenplay elements when pasted into the editor.
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
        if (!res.ok) throw new Error("This share link is no longer available.");
        const d = await res.json();
        cache.current[d.draftId] = d;
        apply(d);
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        setBusy(false);
      }
    },
    [editor, current.draftId, busy, token],
  );

  const currentName = drafts.find((d) => d.id === current.draftId)?.name || "Draft";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:py-14">
        <header className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ScrollText size={13} /> {t("Shared script · read-only")}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{current.title || t("Untitled script")}</h1>
          {current.updatedAt ? (
            <p className="text-xs text-muted-foreground">
              {t("Last updated {date}", { date: fmtDate(current.updatedAt) })}
            </p>
          ) : null}
        </header>

        {/* Version switcher — only when there's more than one draft to choose. */}
        {drafts.length > 1 ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">Version</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 justify-between gap-1.5 text-xs" disabled={busy}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <GitBranch size={13} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{currentName}</span>
                  </span>
                  {busy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ChevronDown size={13} className="shrink-0 opacity-60" />
                  )}
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
                    <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">{d.lineCount} lines</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}

        {err ? (
          <p className="text-sm text-destructive" role="alert">
            {err}
          </p>
        ) : null}

        <div className="notes-editor bg-card">
          <EditorContent editor={editor} />
        </div>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          {t("Shared from StorySeam")}
        </footer>
      </div>
    </div>
  );
}
