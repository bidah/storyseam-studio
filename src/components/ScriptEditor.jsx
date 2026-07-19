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
import {
  Check, Loader2, Cloud, PenLine, Save, Pencil,
  GitBranch, Plus, Trash2, Pin, CircleCheck, ListChecks, Lock,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CLIENT_ID } from "@/lib/clientId";
import { readTabCache, writeTabCache } from "@/lib/tabCache";
import { useAgent, agentIsBusy, generateShotListMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Screenplay, SlashCommand, buildInitialContent,
  SP_TYPES, SP_LABELS, SP_PLACEHOLDERS,
} from "@/components/notes";
import ScriptDiffReview from "@/components/ScriptDiffReview";
import ScriptSelectionAsk from "@/components/ScriptSelectionAsk";

// "2m ago" / "just now" — compact relative time for the drafts list.
function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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
 * Version control — drafts. The "pinned" draft is the active one    *
 * that both this editor AND the chat agent read/write.              *
 * ---------------------------------------------------------------- */

async function draftsApi(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, clientId: CLIENT_ID }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `${method} ${path} failed`);
  }
  return res.json();
}

function DraftControls({ drafts, pinnedId, currentName, flush, reload }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setErr(null);
    try {
      await flush?.(); // never lose an in-flight edit to the current draft
      await fn();
      await reload();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const createDraft = () =>
    run(async () => {
      await draftsApi("/api/script/drafts", "POST", { name: name.trim() || undefined });
      setName("");
      setOpen(false); // new draft is now pinned — editor remounts on it
    });
  const pin = (id) => {
    if (id === pinnedId) return;
    run(() => draftsApi("/api/script/pin", "POST", { id }));
    setOpen(false);
  };
  const remove = (id) =>
    run(() => draftsApi(`/api/script/drafts/${id}`, "DELETE", {}));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <GitBranch size={13} /> Version control draft
          <Badge variant="secondary" className="ml-1 font-normal">{currentName}</Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch size={16} /> Version control — drafts
          </DialogTitle>
          <DialogDescription>
            Create a new draft to save the current version and keep writing on a fresh
            one. The <strong>pinned</strong> draft is the active version — both this
            editor and the chat agent read and write only the pinned draft.
          </DialogDescription>
        </DialogHeader>

        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {err}
          </div>
        )}

        {/* Create a new draft */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">
            Create a new draft
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && createDraft()}
              placeholder={`Draft ${drafts.length + 1}`}
              className="h-8"
            />
            <Button size="sm" className="h-8 shrink-0 gap-1.5" disabled={busy} onClick={createDraft}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create draft
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Clones the current pinned draft, then pins the new one.
          </p>
        </div>

        {/* Existing drafts — switch the pin or delete */}
        <div className="space-y-1">
          <div className="px-1 text-xs font-semibold text-muted-foreground">
            Drafts ({drafts.length})
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {[...drafts]
              .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
              .map((d) => {
                const isPinned = d.id === pinnedId;
                return (
                  <div
                    key={d.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                      isPinned ? "border-primary/50 bg-primary/5" : "hover:bg-accent/40"
                    )}
                  >
                    <button
                      type="button"
                      disabled={busy || isPinned}
                      onClick={() => pin(d.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                      title={isPinned ? "Pinned (active)" : "Pin this draft"}
                    >
                      <Pin
                        size={13}
                        className={cn(
                          "shrink-0",
                          isPinned ? "fill-primary text-primary" : "text-muted-foreground"
                        )}
                      />
                      <span className="truncate font-medium">{d.name}</span>
                      {isPinned && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">pinned</Badge>
                      )}
                      <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
                        {d.lineCount} lines · {relTime(d.updatedAt)}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy || drafts.length <= 1}
                      onClick={() => remove(d.id)}
                      aria-label={`Delete ${d.name}`}
                      title={drafts.length <= 1 ? "Can't delete the only draft" : "Delete draft"}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                );
              })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * The editor (mounted only once the initial content is loaded)     *
 * ---------------------------------------------------------------- */

// Pipeline gate on the Script toolbar: SIGN the pinned draft → unlock GENERATE
// SHOT LIST (agent-driven, via the shot-list skill). Once a shot list already
// exists, Generate is locked (no destructive re-run). `signed` is driven from
// the parent so an autosave (which clears the server-side sign-off) drops it.
function ShotlistGate({ draftId, signed, shotlistExists, onSignedChange }) {
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const [busy, setBusy] = useState(false);
  const [signOpen, setSignOpen] = useState(false);

  // `by` is the author name captured by the confirmation modal (only on sign).
  const toggleSign = useCallback(async (next, by) => {
    setBusy(true);
    try {
      const res = await fetch("/api/script/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed: next, by: by ?? null }),
      });
      if (!res.ok) return false;
      const body = await res.json().catch(() => ({}));
      onSignedChange(next);
      // Signing does NOT bump the draft's `updatedAt`, and the tab cache is only
      // rewritten by a GET /api/script — so without this write-through a remount
      // (tab switch) would re-seed from a stale `signed: false` and the button
      // would come back, needing a second sign to stick.
      const cached = readTabCache("script");
      if (cached) {
        writeTabCache("script", { ...cached, signed: next, signedAt: next ? body.signedAt ?? null : null });
      }
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [onSignedChange]);

  const generate = useCallback(() => {
    agent.send({ message: generateShotListMessage() }).catch(() => {});
  }, [agent]);

  const genDisabled = agentBusy || !signed || shotlistExists;
  const genTitle = agentBusy
    ? "agent is busy"
    : !signed
      ? "sign the script first"
      : shotlistExists
        ? "a shot list already exists — edit it on the Shot list tab, or regenerate via chat"
        : "ask the agent to break the script into a shot list";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {signed ? (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => toggleSign(false)} disabled={busy} title="Unsign to keep editing">
          <CircleCheck size={13} className="text-primary" /> Signed
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSignOpen(true)} disabled={busy || !draftId} title="Sign this draft to unlock the shot list">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <CircleCheck size={13} />} Sign script
        </Button>
      )}
      <Button size="sm" className="h-7 text-xs" onClick={generate} disabled={genDisabled} title={genTitle}>
        {agentBusy ? <Loader2 size={13} className="animate-spin" /> : shotlistExists ? <Lock size={13} /> : <ListChecks size={13} />} Generate shot list
      </Button>

      <ScriptSignModal
        open={signOpen}
        onOpenChange={setSignOpen}
        busy={busy}
        onConfirm={(by) => toggleSign(true, by)}
      />
    </div>
  );
}

// Acknowledgements the author must tick before the script can be closed. All
// three + a name are required — mirrors the per-bundle Revision-signing gate on
// the Episode tab, but for the whole screenplay.
const SCRIPT_SIGN_CHECKS = [
  "The screenplay is final — structure, scenes, and dialogue are locked.",
  "Signing closes the script; editing it afterward unsigns it and requires re-signing.",
  "I accept authorship of this revision and acknowledge the script is closed.",
];

// Confirmation modal for closing (signing) the script. Gates on a signer name +
// every acknowledgement checked, then calls onConfirm(name) → the sign request.
function ScriptSignModal({ open, onOpenChange, busy, onConfirm }) {
  const [signedBy, setSignedBy] = useState(() => {
    try { return localStorage.getItem("shotStudioSigner") || ""; } catch { return ""; }
  });
  const [checks, setChecks] = useState(() => SCRIPT_SIGN_CHECKS.map(() => false));
  // Reset the acknowledgements each time the modal opens.
  useEffect(() => {
    if (open) setChecks(SCRIPT_SIGN_CHECKS.map(() => false));
  }, [open]);

  const name = signedBy.trim();
  const allChecked = checks.every(Boolean);
  const canSign = !!name && allChecked && !busy;

  const submit = async () => {
    if (!canSign) return;
    try { localStorage.setItem("shotStudioSigner", name); } catch { /* ignore */ }
    const ok = await onConfirm(name);
    if (ok !== false) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleCheck size={16} className="text-primary" /> Sign &amp; close script
          </DialogTitle>
          <DialogDescription>
            Signing locks this draft as the closed screenplay and unlocks shot-list
            generation. Editing the script afterward unsigns it and requires re-signing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="script-signed-by">Signed by</Label>
          <Input
            id="script-signed-by"
            value={signedBy}
            placeholder="your name"
            onChange={(e) => setSignedBy(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          {SCRIPT_SIGN_CHECKS.map((text, i) => {
            const on = checks[i];
            return (
              <label
                key={i}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  on ? "border-primary/30 bg-primary/5" : "border-border",
                  !name && !on && "cursor-not-allowed opacity-60",
                )}
              >
                <Checkbox
                  checked={on}
                  disabled={!name && !on}
                  onCheckedChange={(c) => setChecks((arr) => arr.map((v, j) => (j === i ? !!c : v)))}
                  className="mt-0.5 size-5"
                  aria-label={text}
                />
                <span className="text-sm">{text}</span>
              </label>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={!canSign}>
            {busy ? <><Loader2 size={13} className="animate-spin" /> signing…</> : <><CircleCheck size={13} /> Sign &amp; close script</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Editor({ initial, drafts, pinnedId, currentName, reload, signed: signedInit, shotlistExists, draftId }) {
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving" | "error"
  // Local sign-off mirror: editing clears the server-side sign-off, so drop it
  // whenever we autosave; the Sign button sets it back.
  const [signed, setSigned] = useState(!!signedInit);
  // The editor is keyed on `${pinnedId}:${updatedAt}`, which signing leaves
  // untouched — so a fresh sign-off arriving from a revalidation does NOT remount
  // us and would never reach this state. Track the prop explicitly instead.
  useEffect(() => setSigned(!!signedInit), [signedInit]);
  const [spType, setSpType] = useState(null); // current screenplay type, or null
  const [title, setTitle] = useState(initial.title);
  const titleRef = useRef(initial.title);
  const docRef = useRef(initial.doc);
  const timer = useRef(null);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    setSaveState("saving");
    setSigned(false); // an edit invalidates the sign-off (server clears it too)
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
        <DraftControls
          drafts={drafts}
          pinnedId={pinnedId}
          currentName={currentName}
          flush={saveNow}
          reload={reload}
        />
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <ShotlistGate
          draftId={draftId}
          signed={signed}
          shotlistExists={shotlistExists}
          onSignedChange={setSigned}
        />
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
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

      {/* Drag-select a passage → "Ask agent to change this" bubble → chat proposal. */}
      <ScriptSelectionAsk editor={editor} />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Loader shell                                                     *
 * ---------------------------------------------------------------- */

export default function ScriptEditor({ reloadKey = 0, liveKey = 0 }) {
  // Seed from cache (undefined = loading) so a tab remount paints the last script
  // instantly instead of flashing the "loading script…" spinner; still revalidates.
  const [stored, setStored] = useState(() => readTabCache("script")); // undefined = loading
  const [error, setError] = useState(null);
  const [bump, setBump] = useState(0); // local re-fetch after a draft op
  const reload = useCallback(() => setBump((b) => b + 1), []);

  // Re-fetch when the header Refresh bumps reloadKey, when a live agent edit
  // (over SSE) bumps liveKey, or after a local draft op (bump) — so agent writes
  // and version-control changes appear without a manual refresh.
  useEffect(() => {
    let alive = true;
    fetch("/api/script")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setStored(d || {});
        writeTabCache("script", d || {});
      })
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, [reloadKey, liveKey, bump]);

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
  // A pending agent proposal takes over the tab: review the before→after diff and
  // accept (in bulk or per line) or discard before editing resumes. Keyed on the
  // proposal's timestamp so a re-proposal (SSE) remounts with the fresh diff.
  if (stored.proposal) {
    return (
      <ScriptDiffReview
        key={`prop:${stored.proposal.createdAt || ""}`}
        stored={stored}
        reload={reload}
      />
    );
  }
  // Remount the editor when the pinned draft or its content changes (Refresh, a
  // live agent edit, or switching/creating a draft) so useEditor re-initializes
  // with the new content. Keying on pinnedId guarantees a remount on a switch.
  return (
    <Editor
      key={`${stored.pinnedId || "d"}:${stored.updatedAt || `k${reloadKey}-${liveKey}`}`}
      initial={initial}
      drafts={stored.drafts || []}
      pinnedId={stored.pinnedId}
      currentName={stored.draftName || "Draft"}
      reload={reload}
      signed={stored.signed}
      shotlistExists={stored.shotlistExists}
      draftId={stored.draftId}
    />
  );
}
