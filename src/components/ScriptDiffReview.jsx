// Review surface for an agent's PROPOSED script edit. When the pinned draft has a
// pending `proposal` (staged by the eve agent's save_script / append_script tools),
// the Script tab renders this instead of the editable editor: a before→after diff
// the author accepts or rejects — in bulk or per line — before it commits.
//
// The diff is line-level (one screenplay block = one line) with word-level context
// on modified lines. Each change is an independent accept/reject unit; "Apply"
// commits the resolved document (proposed doc with the author's decisions applied)
// via POST /api/script/proposal/accept, and "Discard" drops it via .../reject.

import { useCallback, useMemo, useState } from "react";
import {
  Bot, Check, X, Loader2, GitPullRequestArrow, CheckCheck, Undo2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CLIENT_ID } from "@/lib/clientId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SP_LABELS } from "@/components/notes";
import {
  docLines, linesToDoc, diffRows, buildSegments, resolveLines, diffWords, diffStats,
} from "@/lib/scriptDiff";

async function proposalApi(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, clientId: CLIENT_ID }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `${path} failed`);
  }
  return res.json();
}

const TITLE_ID = "title";

// A screenplay line: a small element-type chip + its text (with optional inline
// word-diff tokens for a modified line).
function LineRow({ type, text, tokens, tone }) {
  const toneCls =
    tone === "add"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "del"
        ? "text-rose-600 line-through decoration-rose-400/60 dark:text-rose-400"
        : "text-foreground";
  return (
    <div className="flex items-baseline gap-2 px-3 py-0.5 text-sm">
      <span className="w-24 shrink-0 select-none pt-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {SP_LABELS[type] || type}
      </span>
      <span className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words", toneCls)}>
        {tokens
          ? tokens.map((t, i) => (
              <span
                key={i}
                className={cn(
                  t.tag === "del" && "text-rose-600 line-through decoration-rose-400/60 dark:text-rose-400",
                  t.tag === "ins" && "rounded-sm bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                )}
              >
                {t.v}
              </span>
            ))
          : text}
      </span>
    </div>
  );
}

// A run of unchanged lines — collapsed to a chip when long so the changes stand out.
function ContextRun({ lines }) {
  const [open, setOpen] = useState(lines.length <= 4);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full px-3 py-1 text-left text-xs text-muted-foreground/70 hover:text-foreground"
      >
        ··· {lines.length} unchanged lines — click to expand
      </button>
    );
  }
  return (
    <div className="opacity-55">
      {lines.map((l, i) => (
        <LineRow key={i} type={l.type} text={l.text} tone="ctx" />
      ))}
    </div>
  );
}

// One change hunk with its own accept/reject toggle. Modified lines (equal counts
// on both sides) render word-level; otherwise removed lines then added lines.
function ChangeHunk({ hunk, decision, onDecide }) {
  const rejected = decision === "reject";
  const paired = hunk.removed.length === hunk.added.length && hunk.added.length > 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border",
        rejected ? "border-border bg-muted/20" : "border-primary/30 bg-primary/[0.03]",
      )}
    >
      <div className={cn("py-1", rejected && "opacity-50")}>
        {paired
          ? hunk.added.map((add, k) => {
              const rem = hunk.removed[k];
              const retyped = rem.type !== add.type;
              return retyped ? (
                <div key={k}>
                  <LineRow type={rem.type} text={rem.text} tone="del" />
                  <LineRow type={add.type} text={add.text} tone="add" />
                </div>
              ) : (
                <LineRow key={k} type={add.type} tokens={diffWords(rem.text, add.text)} />
              );
            })
          : (
            <>
              {hunk.removed.map((l, k) => (
                <LineRow key={`r${k}`} type={l.type} text={l.text} tone="del" />
              ))}
              {hunk.added.map((l, k) => (
                <LineRow key={`a${k}`} type={l.type} text={l.text} tone="add" />
              ))}
            </>
          )}
      </div>
      <div className="flex items-center gap-1.5 border-t bg-card/60 px-2 py-1">
        <span className="mr-auto pl-1 text-[11px] text-muted-foreground">
          {rejected ? "Keeping the original" : "Applying this change"}
        </span>
        <Button
          size="sm"
          variant={rejected ? "outline" : "default"}
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => onDecide("accept")}
        >
          <Check size={12} /> Accept
        </Button>
        <Button
          size="sm"
          variant={rejected ? "default" : "outline"}
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => onDecide("reject")}
        >
          <X size={12} /> Reject
        </Button>
      </div>
    </div>
  );
}

export default function ScriptDiffReview({ stored, reload }) {
  const proposal = stored.proposal || {};
  const [decisions, setDecisions] = useState({});
  const [busy, setBusy] = useState(null); // "apply" | "discard" | null
  const [err, setErr] = useState(null);

  const before = useMemo(() => docLines(proposal.baseDoc), [proposal.baseDoc]);
  const after = useMemo(() => docLines(proposal.proposedDoc), [proposal.proposedDoc]);
  const segments = useMemo(() => buildSegments(diffRows(before, after)), [before, after]);
  const stats = useMemo(() => diffStats(segments), [segments]);

  const baseTitle = stored.title || "";
  const proposedTitle = typeof proposal.proposedTitle === "string" ? proposal.proposedTitle : baseTitle;
  const titleChanged = proposedTitle !== baseTitle;

  const decisionOf = (id) => decisions[id] || "accept";
  const decide = (id, v) => setDecisions((d) => ({ ...d, [id]: v }));

  const acceptAll = () => setDecisions({});
  const rejectAll = () => {
    const all = {};
    for (const s of segments) if (s.kind === "change") all[s.id] = "reject";
    if (titleChanged) all[TITLE_ID] = "reject";
    setDecisions(all);
  };

  const acceptedCount =
    segments.filter((s) => s.kind === "change" && decisionOf(s.id) === "accept").length +
    (titleChanged && decisionOf(TITLE_ID) === "accept" ? 1 : 0);
  const totalChanges = stats.hunks + (titleChanged ? 1 : 0);

  const apply = useCallback(async () => {
    setBusy("apply");
    setErr(null);
    try {
      const doc = linesToDoc(resolveLines(segments, decisions));
      const title = titleChanged && decisionOf(TITLE_ID) !== "reject" ? proposedTitle : baseTitle;
      await proposalApi("/api/script/proposal/accept", { doc, title });
      await reload();
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(null);
    }
    // no finally reset: on success the tab remounts into the editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, decisions, titleChanged, proposedTitle, baseTitle, reload]);

  const discard = useCallback(async () => {
    setBusy("discard");
    setErr(null);
    try {
      await proposalApi("/api/script/proposal/reject", {});
      await reload();
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(null);
    }
  }, [reload]);

  // A proposal that produced no textual change (e.g. re-proposed identical content).
  const noChanges = totalChanges === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {/* Header */}
      <div className="sticky top-[57px] z-20 -mx-1 space-y-2 rounded-lg border border-primary/30 bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex flex-wrap items-center gap-2">
          <GitPullRequestArrow size={16} className="text-primary" />
          <span className="text-sm font-semibold">Proposed script edit</span>
          <Badge variant="secondary" className="gap-1 font-normal">
            <Bot size={11} /> {proposal.source || "agent"}
          </Badge>
          <div className="ml-auto flex items-center gap-1.5 text-xs">
            {stats.added > 0 && (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
            )}
            {stats.removed > 0 && (
              <span className="font-medium text-rose-600 dark:text-rose-400">−{stats.removed}</span>
            )}
            <span className="text-muted-foreground">
              {totalChanges} change{totalChanges === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {proposal.note && (
          <p className="text-xs text-muted-foreground">{proposal.note}</p>
        )}
        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {err}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={acceptAll} disabled={!!busy || noChanges}>
            <CheckCheck size={13} /> Accept all
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={rejectAll} disabled={!!busy || noChanges}>
            <Undo2 size={13} /> Reject all
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {noChanges ? "No changes" : `${acceptedCount} of ${totalChanges} accepted`}
          </span>
          {noChanges ? (
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={discard} disabled={!!busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Dismiss
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={discard} disabled={!!busy}>
                {busy === "discard" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Discard
              </Button>
              <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={apply} disabled={!!busy}>
                {busy === "apply" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {" "}Apply {acceptedCount} change{acceptedCount === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Diff body */}
      <div className="notes-editor space-y-2 rounded-xl border bg-card px-3 py-4 sm:px-4">
        {titleChanged && (
          <div
            className={cn(
              "overflow-hidden rounded-lg border",
              decisionOf(TITLE_ID) === "reject" ? "border-border bg-muted/20" : "border-primary/30 bg-primary/[0.03]",
            )}
          >
            <div className={cn("py-1", decisionOf(TITLE_ID) === "reject" && "opacity-50")}>
              <LineRow type="title" text={baseTitle || "(untitled)"} tone="del" />
              <LineRow type="title" text={proposedTitle || "(untitled)"} tone="add" />
            </div>
            <div className="flex items-center gap-1.5 border-t bg-card/60 px-2 py-1">
              <span className="mr-auto pl-1 text-[11px] text-muted-foreground">Title change</span>
              <Button size="sm" variant={decisionOf(TITLE_ID) === "reject" ? "outline" : "default"} className="h-6 gap-1 px-2 text-[11px]" onClick={() => decide(TITLE_ID, "accept")}>
                <Check size={12} /> Accept
              </Button>
              <Button size="sm" variant={decisionOf(TITLE_ID) === "reject" ? "default" : "outline"} className="h-6 gap-1 px-2 text-[11px]" onClick={() => decide(TITLE_ID, "reject")}>
                <X size={12} /> Reject
              </Button>
            </div>
          </div>
        )}

        {noChanges && !titleChanged ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            The proposal matches the current script — nothing to review.
          </p>
        ) : (
          segments.map((s, i) =>
            s.kind === "equal" ? (
              <ContextRun key={`c${i}`} lines={s.lines} />
            ) : (
              <ChangeHunk
                key={s.id}
                hunk={s}
                decision={decisionOf(s.id)}
                onDecide={(v) => decide(s.id, v)}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}
