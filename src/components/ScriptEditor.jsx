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
  GitBranch, Plus, Trash2, Pin, CircleCheck, ListChecks, Lock, FileUp, FileDown,
  Stethoscope, RotateCcw, Share2, Copy, ExternalLink, ChevronDown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CLIENT_ID } from "@/lib/clientId";
import { readTabCache, writeTabCache } from "@/lib/tabCache";
import { useAgent, agentIsBusy, generateShotListMessage } from "@/components/AgentProvider";
// The specialists table + the brief each chip sends are SHARED with the chat's
// suggestion cards, so a chip and a card ask for exactly the same thing.
import { DOCTORS, reviewMessage } from "@/lib/suggestions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT, t as st } from "@/lib/i18n";
import {
  Screenplay, SlashCommand, SelectionHighlight, buildInitialContent, elementsToDoc,
  transformCopiedScreenplay,
  SP_TYPES, SP_LABELS, SP_PLACEHOLDERS,
} from "@/components/notes";
import { parseFountain } from "@/lib/fountain";
import { exportScript, EXPORT_FORMATS } from "@/lib/screenplayExport";
import ScriptDiffReview from "@/components/ScriptDiffReview";
import ScriptSelectionAsk from "@/components/ScriptSelectionAsk";
import ScriptWorkingCard from "@/components/ScriptWorkingCard";

// "2m ago" / "just now" — compact relative time for the drafts list.
function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return st("just now");
  const m = Math.round(s / 60);
  if (m < 60) return st("{m}m ago", { m });
  const h = Math.round(m / 60);
  if (h < 24) return st("{h}h ago", { h });
  return st("{d}d ago", { d: Math.round(h / 24) });
}

/* ---------------------------------------------------------------- *
 * Title — a click-to-edit field that sits above the editor box     *
 * ---------------------------------------------------------------- */

function TitleField({ value, onCommit }) {
  const t = useT();
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
        title={t("Click to edit the title")}
      >
        <h1
          className={cn(
            "text-3xl font-extrabold tracking-tight",
            !value && "text-muted-foreground/50"
          )}
        >
          {value || t("Untitled script")}
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
        placeholder={t("Untitled script")}
        className="flex-1 border-b border-input bg-transparent px-1 py-1 text-3xl font-extrabold tracking-tight outline-none placeholder:text-muted-foreground/40 focus:border-ring"
      />
      <Button size="sm" onClick={commit}>
        <Save size={14} /> {t("Save")}
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
  const t = useT();
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
          <GitBranch size={13} /> {t("Version control draft")}
          <Badge variant="secondary" className="ml-1 font-normal">{currentName}</Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch size={16} /> {t("Version control — drafts")}
          </DialogTitle>
          <DialogDescription>
            {t("Create a new draft to save the current version and keep writing on a fresh one. The pinned draft is the active version — both this editor and the chat agent read and write only the pinned draft.")}
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
            {t("Create a new draft")}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && createDraft()}
              placeholder={t("Draft {n}", { n: drafts.length + 1 })}
              className="h-8"
            />
            <Button size="sm" className="h-8 shrink-0 gap-1.5" disabled={busy} onClick={createDraft}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {t("Create draft")}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t("Clones the current pinned draft, then pins the new one.")}
          </p>
        </div>

        {/* Existing drafts — switch the pin or delete */}
        <div className="space-y-1">
          <div className="px-1 text-xs font-semibold text-muted-foreground">
            {t("Drafts ({n})", { n: drafts.length })}
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
                      title={isPinned ? t("Pinned (active)") : t("Pin this draft")}
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
                        <Badge variant="secondary" className="shrink-0 text-[10px]">{t("pinned")}</Badge>
                      )}
                      <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
                        {d.lineCount} {t("lines")} · {relTime(d.updatedAt)}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy || drafts.length <= 1}
                      onClick={() => remove(d.id)}
                      aria-label={t("Delete {name}", { name: d.name })}
                      title={drafts.length <= 1 ? t("Can't delete the only draft") : t("Delete draft")}
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
 * Import — turn a screenplay file into a new draft. Fountain (.fountain)
 * for now; the parser produces the same `{type,text}[]` elements the editor
 * stores, so an import lands as a fully-formatted, non-destructive new draft
 * (the current draft is untouched) that becomes pinned.
 * ---------------------------------------------------------------- */

// Filename → a tidy draft name, e.g. "whistlewood.fountain" → "whistlewood (imported)".
const importDraftName = (filename) =>
  `${filename.replace(/\.[^./]+$/, "").trim() || st("Untitled")} (${st("imported")})`.slice(0, 80);

function ImportControls({ flush, reload }) {
  const t = useT();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after an edit
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      // Fountain is the only importable format (the exporter round-trips it);
      // the picker's accept already filters, but guard for OSes that let it through.
      if (!/\.fountain$/i.test(file.name)) {
        throw new Error(st("Only Fountain (.fountain) files can be imported."));
      }
      await flush?.(); // never lose an in-flight edit to the current draft
      const text = await file.text();
      const { title, elements } = parseFountain(text);
      if (!elements.length) {
        throw new Error(st("No screenplay content found — is this a Fountain file?"));
      }
      // Seed a brand-new draft with the converted doc; it becomes pinned server-side.
      await draftsApi("/api/script/drafts", "POST", {
        name: importDraftName(file.name),
        title: title || file.name.replace(/\.[^./]+$/, ""),
        doc: elementsToDoc(elements),
      });
      await reload(); // pinned draft changed → editor remounts on the import
    } catch (e2) {
      setErr(String(e2.message || e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".fountain"
        className="hidden"
        onChange={onPick}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title={t("Import a Fountain (.fountain) screenplay as a new draft")}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />}
        {t("Import")}
      </Button>
      {err && (
        <span className="max-w-[16rem] truncate text-[11px] text-destructive" role="alert" title={err}>
          {err}
        </span>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- *
 * Export — the inverse of import. Serialize the current draft to any of the
 * screenplay formats and download it, all client-side (see
 * src/lib/screenplayExport.js). Reads the LIVE editor doc so an in-flight edit is
 * included without waiting on autosave.
 * ---------------------------------------------------------------- */

function ExportControls({ editor, title, name }) {
  const t = useT();
  const [busy, setBusy] = useState(null); // the format currently exporting, or null
  const [err, setErr] = useState(null);

  const run = async (format) => {
    if (!editor || busy) return;
    setBusy(format);
    setErr(null);
    try {
      const { count } = await exportScript({
        doc: editor.getJSON(),
        title,
        name,
        format,
      });
      if (!count) setErr(st("Nothing to export — the script is empty."));
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={!!busy}
            title={t("Export the current draft as Fountain, text, Final Draft, PDF or Word")}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
            {t("Export")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {EXPORT_FORMATS.map(({ format, label }) => (
            <DropdownMenuItem key={format} disabled={!!busy} onSelect={() => run(format)}>
              {t(label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {err && (
        <span className="max-w-[16rem] truncate text-[11px] text-destructive" role="alert" title={err}>
          {err}
        </span>
      )}
    </>
  );
}

// Share — a public read-only link to ONE chosen draft (/share/script/<token>,
// rendered by src/routes/share-script.jsx outside the login gate). Opening the
// dialog mints a token once (pointing at the pinned draft by default) and
// returns the same link on every subsequent open. A version picker at the top
// repoints that same link at another draft; the link always shows the latest
// saved content of whichever draft it points at. "Stop sharing" revokes the
// token, killing every copy of the link.
function ShareControls({ drafts, pinnedId }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null); // null = loading, { url, draftId } = live
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false); // repointing to a different draft

  // Which draft the link currently shows — the stored choice, else the pinned
  // one (the viewer falls back to pinned for a null/deleted draftId).
  const selectedId =
    (info?.draftId && drafts.some((d) => d.id === info.draftId) && info.draftId) || pinnedId;
  const selectedName = drafts.find((d) => d.id === selectedId)?.name || t("Pinned draft");
  const sortedDrafts = [...drafts].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  // Ensure a token exists, pointing at the pinned draft by default. GET first so
  // a previously chosen draft isn't clobbered by reopening the dialog.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setInfo(null);
    setErr(null);
    setCopied(false);
    (async () => {
      try {
        const cur = await fetch("/api/script/share").then((r) => r.json());
        if (cur.error) throw new Error(cur.error);
        // Not shared yet → mint a link pointing at the pinned draft.
        const d = cur.shared && cur.url
          ? cur
          : await fetch("/api/script/share", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ draftId: pinnedId }),
            }).then((r) => r.json());
        if (!alive) return;
        if (d.error || !d.url) throw new Error(d.error || st("No share link returned"));
        setInfo(d);
      } catch (e) {
        if (alive) setErr(String(e.message || e));
      }
    })();
    return () => { alive = false; };
  }, [open, pinnedId]);

  // Repoint the existing link at a different draft.
  const pickDraft = async (draftId) => {
    if (draftId === selectedId) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await fetch("/api/script/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId }),
      }).then((r) => r.json());
      if (d.error || !d.url) throw new Error(d.error || st("Couldn't update the share link"));
      setInfo(d);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  const stopSharing = async () => {
    try {
      await fetch("/api/script/share", { method: "DELETE" });
      setOpen(false);
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          title={t("Share a public read-only view of this script")}
        >
          <Share2 size={13} />
          {t("Share")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 size={16} /> {t("Share script")}
          </DialogTitle>
          <DialogDescription>
            {t("Anyone with this link can read the chosen draft — formatted, no editing. Pick which version to share below; the link always shows its latest saved content.")}
          </DialogDescription>
        </DialogHeader>

        {/* Version picker — which draft the link shows. Defaults to the pinned draft. */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">{t("Version")}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 flex-1 justify-between gap-1.5 text-xs"
                disabled={!info || busy}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <GitBranch size={13} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{selectedName}</span>
                  {selectedId === pinnedId && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">{t("pinned")}</Badge>
                  )}
                </span>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} className="shrink-0 opacity-60" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 w-[--radix-dropdown-menu-trigger-width] overflow-y-auto">
              {sortedDrafts.map((d) => (
                <DropdownMenuItem
                  key={d.id}
                  onClick={() => pickDraft(d.id)}
                  className="flex items-center gap-2 text-xs"
                >
                  {d.id === selectedId ? (
                    <Check size={13} className="shrink-0 text-primary" />
                  ) : (
                    <span className="w-[13px] shrink-0" />
                  )}
                  <span className="truncate">{d.name}</span>
                  {d.id === pinnedId && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">{t("pinned")}</Badge>
                  )}
                  <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
                    {d.lineCount} {t("lines")}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {err ? (
          <p className="text-sm text-destructive" role="alert">{err}</p>
        ) : !info ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> {t("Creating share link…")}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <Input readOnly value={info.url} className="h-8 text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={copy}>
              {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
              {copied ? t("Copied") : t("Copy")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              aria-label={t("Open the shared view in a new tab")}
              onClick={() => window.open(info.url, "_blank", "noopener")}
            >
              <ExternalLink size={13} />
            </Button>
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" className="text-destructive" disabled={!info} onClick={stopSharing}>
            {t("Stop sharing")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            {t("Done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * The editor (mounted only once the initial content is loaded)     *
 * ---------------------------------------------------------------- */

// Which script doctors have read this draft, and a one-click way to run the ones
// that haven't. `reviews` comes straight off GET /api/script
// ({ latest, pending, stale, fresh } — see worker/src/lib/reviews.js); the
// specialists log their own passes, so this is a read-only view of their log book
// plus a button per chip.
//
// The state is the point: without it "run the plot doctor" is a coin flip on
// whether it already ran, and a script quietly gets the same review four times
// while never seeing the other three. A chip is therefore always one of three
// things — never run (outline, the invitation), read this revision (filled, with
// its verdict on hover), or read an older one (outline + re-run icon).
function ReviewChips({ reviews }) {
  const t = useT();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const fresh = new Set(reviews?.fresh || []);
  const stale = new Set(reviews?.stale || []);

  const run = (id, isStale) => {
    agent.send({ message: reviewMessage(id, { stale: isStale }) }).catch(() => {});
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Stethoscope size={13} /> {t("Doctors")}
      </span>
      {DOCTORS.map((d) => {
        const isFresh = fresh.has(d.id);
        const isStale = stale.has(d.id);
        const last = reviews?.latest?.[d.id] || null;
        const tip = isFresh
          ? `${last?.summary || t("No issues reported")}${last?.at ? ` · ${relTime(last.at)}` : ""}`
          : isStale
            ? `${t("Read an older revision")}${last?.at ? ` ${relTime(last.at)}` : ""}${t(" — run it again on this one")}`
            : t("Never run on this draft — {does}", { does: d.does });
        return (
          <Tooltip key={d.id}>
            <TooltipTrigger asChild>
              <Button
                variant={isFresh ? "secondary" : "outline"}
                size="sm"
                className={cn("h-7 gap-1 text-xs", isFresh && "text-primary")}
                disabled={agentBusy}
                onClick={() => run(d.id, isStale)}
              >
                {isFresh ? (
                  <Check size={12} />
                ) : isStale ? (
                  <RotateCcw size={12} />
                ) : null}
                {d.chip}
                {isFresh && last?.findings != null ? (
                  <span className="text-muted-foreground">{last.findings}</span>
                ) : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{tip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

// Pipeline gate on the Script toolbar: SIGN the pinned draft → unlock GENERATE
// SHOT LIST (agent-driven, via the shot-list skill). Once a shot list already
// exists, Generate is locked (no destructive re-run). `signed` is driven from
// the parent so an autosave (which clears the server-side sign-off) drops it.
function ShotlistGate({ draftId, signed, shotlistExists, onSignedChange }) {
  const t = useT();
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

  // Which shot-list skill the turn asks for depends on the project's active shot
  // director (its `promptForm`) — read it here rather than threading it through
  // the Script route's loader for one button. A failed read falls back to the
  // paragraph wording, which is the pre-existing behaviour.
  const generate = useCallback(async () => {
    let promptForm;
    try {
      promptForm = (await fetch("/api/shot-directors/active").then((r) => r.json()))?.director?.promptForm;
    } catch { /* fall back to the paragraph wording */ }
    agent.send({ message: generateShotListMessage({ promptForm, mode: "all" }) }).catch(() => {});
  }, [agent]);

  const genDisabled = agentBusy || !signed || shotlistExists;
  const genTitle = agentBusy
    ? t("agent is busy")
    : !signed
      ? t("sign the script first")
      : shotlistExists
        ? t("a shot list already exists — edit it on the Shot list tab, or regenerate via chat")
        : t("ask the agent to break the script into a shot list");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {signed ? (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => toggleSign(false)} disabled={busy} title={t("Unsign to keep editing")}>
          <CircleCheck size={13} className="text-primary" /> {t("Signed")}
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSignOpen(true)} disabled={busy || !draftId} title={t("Sign this draft to unlock the shot list")}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <CircleCheck size={13} />} {t("Sign script")}
        </Button>
      )}
      <Button size="sm" className="h-7 text-xs" onClick={generate} disabled={genDisabled} title={genTitle}>
        {agentBusy ? <Loader2 size={13} className="animate-spin" /> : shotlistExists ? <Lock size={13} /> : <ListChecks size={13} />} {t("Generate shot list")}
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
].map(st);

// Confirmation modal for closing (signing) the script. Gates on a signer name +
// every acknowledgement checked, then calls onConfirm(name) → the sign request.
function ScriptSignModal({ open, onOpenChange, busy, onConfirm }) {
  const t = useT();
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
            <CircleCheck size={16} className="text-primary" /> {t("Sign & close script")}
          </DialogTitle>
          <DialogDescription>
            {t("Signing locks this draft as the closed screenplay and unlocks shot-list generation. Editing the script afterward unsigns it and requires re-signing.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="script-signed-by">{t("Signed by")}</Label>
          <Input
            id="script-signed-by"
            value={signedBy}
            placeholder={t("your name")}
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("Cancel")}</Button>
          <Button onClick={submit} disabled={!canSign}>
            {busy ? <><Loader2 size={13} className="animate-spin" /> {t("signing…")}</> : <><CircleCheck size={13} /> {t("Sign & close script")}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Editor({ initial, drafts, pinnedId, currentName, reload, signed: signedInit, shotlistExists, draftId, reviews }) {
  const t = useT();
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
          if (node.type.name === "heading") return t("Heading");
          if (node.type.name === "screenplay")
            return SP_PLACEHOLDERS[node.attrs.spType] || "";
          return t("Write, or press '/' for commands…");
        },
      }),
      SlashCommand,
      SelectionHighlight,
    ],
    content: initial.doc,
    editorProps: {
      attributes: { class: "min-h-[60vh] focus:outline-none" },
      // Copy/cut a passage and it pastes back as the elements it was — see
      // transformCopiedScreenplay + the Screenplay parse rules in notes/schema.js.
      transformCopied: transformCopiedScreenplay,
    },
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

  // The passage currently sent to the agent — { from, to, text } or null. While
  // set, the editor is locked read-only and the passage stays highlighted (the
  // "working" decoration), with a card on the right; it clears when the agent
  // comes back (a proposal takes over the tab, or the turn ends with no change).
  const [work, setWork] = useState(null);
  const workRef = useRef(null); // synchronous mirror for the decoration guard

  // Mirror the LIVE selection as the "pending" highlight, so the picked passage
  // stays lit even after the editor blurs (clicking into the ask box). Ignored
  // once we're working — that decoration is owned below and must not be wiped.
  const onPendingRange = useCallback(
    (range) => {
      if (!editor || workRef.current) return;
      if (range) editor.commands.setSelectionHighlight({ ...range, mode: "pending" });
      else editor.commands.clearSelectionHighlight();
    },
    [editor]
  );

  // A passage was sent to the agent: lock the doc and switch its highlight to the
  // "working" state until the agent returns.
  const onSent = useCallback(
    (sel) => {
      if (!editor) return;
      workRef.current = sel;
      setWork(sel);
      editor.setEditable(false);
      editor.commands.setSelectionHighlight({ from: sel.from, to: sel.to, mode: "working" });
    },
    [editor]
  );

  // Scroll the editor to the locked passage (clicking the "working" card). The
  // highlight stays put — this only brings it back into view.
  const revealWork = useCallback(() => {
    const s = workRef.current;
    if (!editor || !s) return;
    try {
      const { node } = editor.view.domAtPos(s.from);
      const el = node?.nodeType === 3 ? node.parentElement : node;
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    } catch {
      /* passage not currently rendered — nothing to scroll to */
    }
  }, [editor]);

  // Unlock and drop the highlight (agent finished with no proposal, or dismissed).
  const releaseWork = useCallback(() => {
    workRef.current = null;
    setWork(null);
    if (editor) {
      editor.setEditable(true);
      editor.commands.clearSelectionHighlight();
    }
  }, [editor]);

  const setType = (t) => editor?.chain().focus().setScreenplay(t).run();

  return (
    <div className="mx-auto flex w-full max-w-[1120px] justify-center gap-5 px-1">
      <div className="w-full max-w-3xl space-y-3">
      {/* Toolbar */}
      <div className="sticky top-5 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border bg-card/90 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <DraftControls
          drafts={drafts}
          pinnedId={pinnedId}
          currentName={currentName}
          flush={saveNow}
          reload={reload}
        />
        <ImportControls flush={saveNow} reload={reload} />
        <ExportControls editor={editor} title={title} name={currentName} />
        <ShareControls drafts={drafts} pinnedId={pinnedId} />
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <ShotlistGate
          draftId={draftId}
          signed={signed}
          shotlistExists={shotlistExists}
          onSignedChange={setSigned}
        />
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <ReviewChips reviews={reviews} />
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <PenLine size={13} /> {t("Screenplay")}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {SP_TYPES.map((type) => (
            <Button
              key={type}
              variant={spType === type ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setType(type)}
              title={t("Format as {label}", { label: SP_LABELS[type] })}
            >
              {SP_LABELS[type]}
            </Button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {saveState === "saving" ? (
            <><Loader2 size={13} className="animate-spin" /> {t("Saving…")}</>
          ) : saveState === "error" ? (
            <span className="text-destructive">{t("save failed")}</span>
          ) : (
            <><Check size={13} className="text-primary" /> {t("Saved")}</>
          )}
        </span>
      </div>

      {/* Title — outside the editor box, click to edit */}
      <TitleField value={title} onCommit={onCommitTitle} />

      <p className="px-1 text-xs text-muted-foreground">
        {t("Press {slash} for screenplay elements", { slash: "/" })}
        &nbsp;· <kbd className="rounded border bg-muted px-1 font-mono">Tab</kbd>
        {" "}{t("cycles element type")}
        &nbsp;· <kbd className="rounded border bg-muted px-1 font-mono">Enter</kbd>
        {" "}{t("follows the flow (Character → Dialogue)")}
      </p>

      {/* On narrow screens there's no room for the right rail, so the "working"
          card rides above the editor instead. */}
      {work && (
        <div className="xl:hidden">
          <ScriptWorkingCard sel={work} onRelease={releaseWork} onReveal={revealWork} />
        </div>
      )}

      <div className="notes-editor rounded-xl border bg-card px-6 py-8 sm:px-10">
        <EditorContent editor={editor} />
      </div>

      {/* Drag-select a passage → "Ask agent to change this" bubble → chat proposal. */}
      <ScriptSelectionAsk
        editor={editor}
        paused={!!work}
        onPendingRange={onPendingRange}
        onSent={onSent}
      />
      </div>

      {/* The passage sent to the agent stays lit + locked; this card explains why. */}
      {work && (
        <aside className="hidden w-72 shrink-0 xl:block">
          <div className="sticky top-24">
            <ScriptWorkingCard sel={work} onRelease={releaseWork} onReveal={revealWork} />
          </div>
        </aside>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Loader shell                                                     *
 * ---------------------------------------------------------------- */

export default function ScriptEditor({ reloadKey = 0, liveKey = 0 }) {
  const t = useT();
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
        <Cloud size={15} /> {t("could not load the script:")} {error}
      </div>
    );
  }
  if (stored === undefined || !initial) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> {t("loading script…")}
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
      currentName={stored.draftName || t("Draft")}
      reload={reload}
      signed={stored.signed}
      shotlistExists={stored.shotlistExists}
      draftId={stored.draftId}
      reviews={stored.reviews}
    />
  );
}
