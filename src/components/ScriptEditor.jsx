// Script tab — a Notion-style page editor (TipTap) whose "/" menu offers the
// screenplay elements (scene heading, action, character, dialogue, parenthetical,
// transition) whose inline text follows screenplay formatting. The title lives
// OUTSIDE the editor box as a separate click-to-edit field (Enter or the Save
// button commits it).
//
// Persistence mirrors the rest of the app: the title + body ProseMirror doc are
// saved to /api/script (a script.json on disk) with a 700 ms debounced autosave,
// flushed immediately on Cmd/Ctrl+S or when the title is committed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Check, Loader2, Cloud, PenLine, Save, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { CLIENT_ID } from "@/lib/clientId";
import { Button } from "@/components/ui/button";
import {
  Screenplay, SlashCommand, buildInitialContent,
  SP_TYPES, SP_LABELS, SP_PLACEHOLDERS,
} from "@/components/notes";

/* ---------------------------------------------------------------- *
 * Title — a click-to-edit field that sits above the editor box     *
 * ---------------------------------------------------------------- */

function TitleField({ value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    onCommit(draft.trim());
    setEditing(false);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent/40"
        title="Click to edit the title"
      >
        <h1
          className={cn(
            "text-3xl font-extrabold tracking-tight",
            !value && "text-muted-foreground/50"
          )}
        >
          {value || "Untitled script"}
        </h1>
        <Pencil
          size={15}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder="Untitled script"
        className="flex-1 border-b border-input bg-transparent px-1 py-1 text-3xl font-extrabold tracking-tight outline-none placeholder:text-muted-foreground/40 focus:border-ring"
      />
      <Button size="sm" onClick={commit}>
        <Save size={14} /> Save
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * The editor (mounted only once the initial content is loaded)     *
 * ---------------------------------------------------------------- */

function Editor({ initial }) {
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving" | "error"
  const [spType, setSpType] = useState(null); // current screenplay type, or null
  const [title, setTitle] = useState(initial.title);
  const titleRef = useRef(initial.title);
  const docRef = useRef(initial.doc);
  const timer = useRef(null);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    setSaveState("saving");
    try {
      const res = await fetch("/api/script", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleRef.current,
          doc: docRef.current,
          clientId: CLIENT_ID,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(saveNow, 700);
  }, [saveNow]);

  // Reflect the type of the block the caret is in (null when not screenplay).
  const syncType = useCallback((ed) => {
    const node = ed.state.selection.$from.parent;
    setSpType(node.type.name === "screenplay" ? node.attrs.spType : null);
  }, []);

  const editor = useEditor({
    extensions: [
      Screenplay,
      StarterKit,
      TextStyle,
      Color,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Heading";
          if (node.type.name === "screenplay")
            return SP_PLACEHOLDERS[node.attrs.spType] || "";
          return "Write, or press '/' for commands…";
        },
      }),
      SlashCommand,
    ],
    content: initial.doc,
    editorProps: { attributes: { class: "min-h-[60vh] focus:outline-none" } },
    onUpdate: ({ editor }) => {
      docRef.current = editor.getJSON();
      syncType(editor);
      scheduleSave();
    },
    onSelectionUpdate: ({ editor }) => syncType(editor),
    onCreate: ({ editor }) => syncType(editor),
  });

  // Commit the title (click Save or press Enter): persist immediately.
  const onCommitTitle = useCallback(
    (next) => {
      setTitle(next);
      titleRef.current = next;
      saveNow();
    },
    [saveNow]
  );

  // Cmd/Ctrl+S flushes the pending save.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow]);

  // Flush any pending save on unmount.
  useEffect(() => () => clearTimeout(timer.current), []);

  const setType = (t) => editor?.chain().focus().setScreenplay(t).run();

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {/* Toolbar */}
      <div className="sticky top-[57px] z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border bg-card/90 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <PenLine size={13} /> Screenplay
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {SP_TYPES.map((t) => (
            <Button
              key={t}
              variant={spType === t ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setType(t)}
              title={`Format as ${SP_LABELS[t]}`}
            >
              {SP_LABELS[t]}
            </Button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {saveState === "saving" ? (
            <><Loader2 size={13} className="animate-spin" /> Saving…</>
          ) : saveState === "error" ? (
            <span className="text-destructive">save failed</span>
          ) : (
            <><Check size={13} className="text-primary" /> Saved</>
          )}
        </span>
      </div>

      {/* Title — outside the editor box, click to edit */}
      <TitleField value={title} onCommit={onCommitTitle} />

      <p className="px-1 text-xs text-muted-foreground">
        Press <kbd className="rounded border bg-muted px-1 font-mono">/</kbd> for screenplay
        elements · <kbd className="rounded border bg-muted px-1 font-mono">Tab</kbd> cycles element
        type · <kbd className="rounded border bg-muted px-1 font-mono">Enter</kbd> follows the flow
        (Character → Dialogue).
      </p>

      <div className="notes-editor rounded-xl border bg-card px-6 py-8 sm:px-10">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Loader shell                                                     *
 * ---------------------------------------------------------------- */

export default function ScriptEditor({ reloadKey = 0, liveKey = 0 }) {
  const [stored, setStored] = useState(undefined); // undefined = loading
  const [error, setError] = useState(null);

  // Re-fetch when the header Refresh bumps reloadKey, or when a live agent edit
  // (over SSE) bumps liveKey — so agent writes appear without a manual refresh.
  useEffect(() => {
    let alive = true;
    fetch("/api/script")
      .then((r) => r.json())
      .then((d) => alive && setStored(d || {}))
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, [reloadKey, liveKey]);

  const initial = useMemo(
    () => (stored === undefined ? null : buildInitialContent(stored)),
    [stored]
  );

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <Cloud size={15} /> could not load the script: {error}
      </div>
    );
  }
  if (stored === undefined || !initial) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> loading script…
      </div>
    );
  }
  // Remount the editor when the loaded document changes (Refresh or a live agent
  // edit) so useEditor re-initializes with the new content.
  return <Editor key={stored.updatedAt || `k${reloadKey}-${liveKey}`} initial={initial} />;
}
