import { useCallback, useMemo, useState } from "react";
import { Link, useLoaderData } from "react-router";
import {
  Activity, AudioLines, Check, ChevronDown, ChevronRight, Clapperboard, Clock,
  Coins, Compass, Eye, Fingerprint, Gauge, Globe, HeartPulse, Lightbulb, Loader2,
  MessagesSquare, Mic, PenLine, RotateCcw, Ruler, SearchCheck, Sparkles,
  Stethoscope, Users, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, Eyebrow, Panel, ErrorNote, Tip } from "@/components/shared";
import { SPECIALISTS, STAGE_ORDER } from "@/lib/specialists";
import { reviewMessage } from "@/lib/suggestions";
import { useT, t as staticT } from "@/lib/i18n";

/* ---------------------------------------------------------------- *
 * The Script Agents board — the author's accountability view of the *
 * writers' room. Who has read my script, what did they say, and     *
 * what haven't I run yet.                                           *
 *                                                                   *
 * Every specialist logs its own pass into the `script-reviews`      *
 * ledger (worker/src/lib/reviews.js), which is what makes this a    *
 * READ of a log book rather than a guess. The Script tab's chips    *
 * show the same state at badge resolution; this is the long form —  *
 * the notes, the pass history, and the ones nobody has run.         *
 * ---------------------------------------------------------------- */

// The roster names its icon as a STRING (it is pure, vendored data and can't
// import components). Mapped here explicitly — never a dynamic/star import,
// which would pull all ~1500 lucide icons into the chunk.
const ICONS = {
  Activity, AudioLines, Clapperboard, Coins, Compass, Eye, Fingerprint, Globe,
  HeartPulse, Lightbulb, MessagesSquare, Mic, SearchCheck, Sparkles, Users,
};

const iconFor = (name) => ICONS[name] || Stethoscope;

// What each stage of the roster is FOR. The ordering is the craft advice — a
// producibility pass on a draft still being restructured prices a script that no
// longer exists — so the board says it out loud rather than implying it.
const STAGE_COPY = {
  outline: {
    label: "Outline",
    note: "There's a premise and beats, maybe no scenes yet. Shape first — everything below is cheaper once this is settled.",
  },
  draft: {
    label: "Draft",
    note: "Scenes exist and can be read end to end. This is where cause, coherence and character get audited.",
  },
  polish: {
    label: "Polish",
    note: "The shape is settled; the work is now line- and beat-level. Punching up before this point polishes lines that are about to be cut.",
  },
  lock: {
    label: "Locked",
    note: "The script is what it's going to be. These passes price the shoot and check the lines survive being spoken.",
  },
};

const SEVERITY_VARIANT = { high: "destructive", medium: "warning", low: "muted" };

// "2m ago" / "just now" — same compact form as the drafts list on the Script tab.
function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return staticT("just now");
  const m = Math.round(s / 60);
  if (m < 60) return staticT("{m}m ago", { m });
  const h = Math.round(m / 60);
  if (h < 24) return staticT("{h}h ago", { h });
  return staticT("{d}d ago", { d: Math.round(h / 24) });
}

/* ---------------------------------------------------------------- *
 * A disclosure — the notes and the pass history are collapsed by    *
 * default, because a card's job at a glance is the state, not the   *
 * contents of somebody's last report.                               *
 * ---------------------------------------------------------------- */

function Disclosure({ label, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {label}
        {count != null && <span className="text-muted-foreground/70">({count})</span>}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * One specialist                                                    *
 * ---------------------------------------------------------------- */

function SpecialistCard({ spec, state, last, passes, history, busy, disabled, disabledReason, onRun }) {
  const t = useT();
  const Icon = iconFor(spec.icon);
  const notes = last?.notes || [];
  const older = (history || []).slice(1); // history[0] IS the current pass
  const findings = last?.findings;

  const badge =
    state === "fresh" ? (
      <Badge variant="success"><Check size={11} /> {t("Read this revision")}</Badge>
    ) : state === "stale" ? (
      <Badge variant="warning"><RotateCcw size={11} /> {t("Script changed since")}</Badge>
    ) : (
      <Badge variant="muted">{t("Never run")}</Badge>
    );

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border p-3",
        state === "pending" && "border-dashed bg-muted/20",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
            state === "fresh"
              ? "border-primary/30 bg-primary/10 text-primary"
              : state === "stale"
                ? "border-warning/30 bg-warning/10 text-warning"
                : "bg-muted text-muted-foreground",
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{t(spec.title)}</span>
            <Badge variant="outline" className="text-[10px]">{t(spec.chip)}</Badge>
            {spec.lane === "ondemand" && (
              <Badge variant="secondary" className="text-[10px]">{t("on request")}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(spec.does)}</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {badge}
        {findings != null && state !== "pending" && (
          <Badge variant={findings > 0 ? "info" : "muted"}>
            {t("{n} findings", { n: findings })}
          </Badge>
        )}
        {passes > 1 && <Badge variant="muted">{t("{n} passes", { n: passes })}</Badge>}
        {last?.at && (
          <span className="text-[11px] text-muted-foreground">
            {relTime(last.at)}
            {last.draftName ? ` · ${last.draftName}` : ""}
          </span>
        )}
      </div>

      {state !== "pending" && (
        <p className="mt-2 text-xs leading-relaxed text-foreground/80">
          {last?.summary || <Empty>{t("no summary recorded for that pass.")}</Empty>}
        </p>
      )}

      {notes.length > 0 && (
        <Disclosure label={t("What it found")} count={notes.length}>
          {notes.map((n, i) => (
            <div key={i} className="rounded-md border bg-muted/30 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={SEVERITY_VARIANT[n.severity] || "muted"} className="text-[10px] uppercase">
                  {t(n.severity || "medium")}
                </Badge>
                {n.where && <span className="font-mono text-[11px] text-muted-foreground">{n.where}</span>}
              </div>
              <p className="mt-1 leading-relaxed">{n.issue}</p>
              {n.fix && (
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground/70">{t("Fix")}: </span>
                  {n.fix}
                </p>
              )}
            </div>
          ))}
        </Disclosure>
      )}

      {older.length > 0 && (
        <Disclosure label={t("Earlier passes")} count={older.length}>
          {older.map((h, i) => (
            <div key={`${h.at || i}`} className="rounded-md border border-dashed p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock size={11} />
                {relTime(h.at)}
                {h.draftName ? ` · ${h.draftName}` : ""}
                {h.findings != null && (
                  <Badge variant="muted" className="text-[10px]">
                    {t("{n} findings", { n: h.findings })}
                  </Badge>
                )}
              </div>
              {h.summary && <p className="mt-1 leading-relaxed">{h.summary}</p>}
            </div>
          ))}
        </Disclosure>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Tip content={disabledReason} wrapClassName="">
          <Button
            size="sm"
            variant={state === "pending" ? "default" : "outline"}
            className="h-7 text-xs"
            disabled={disabled}
            onClick={onRun}
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : state === "pending" ? (
              <Wand2 size={13} />
            ) : (
              <RotateCcw size={13} />
            )}
            {state === "pending" ? t("Run") : t("Run again")}
          </Button>
        </Tip>
        {spec.writes === "world" && (
          <span className="text-[11px] text-muted-foreground">{t("can propose into the world bible")}</span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Format check — the deterministic lint. NOT a specialist pass:     *
 * it's a function over the pinned draft, so it costs nothing and    *
 * is always current. Hidden entirely when the endpoint failed.      *
 * ---------------------------------------------------------------- */

function FormatCheck({ lint }) {
  const t = useT();
  const issues = lint?.issues || [];
  const stats = lint?.stats || {};
  const bySeverity = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;
    return counts;
  }, [issues]);
  const top = issues.slice(0, 6);
  const characters = (stats.characters || []).slice(0, 8);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Ruler size={15} className="text-primary" /> {t("Format check")}
        </span>
      }
      meta={
        <Badge variant={issues.length ? "warning" : "success"}>
          {issues.length ? t("{n} issues", { n: issues.length }) : t("Clean")}
        </Badge>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        {t("Instant and free — a mechanical read of the pinned draft (sluglines, orphan dialogue, drifting character names). It is not a specialist pass and nothing here is a story note.")}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {["high", "medium", "low"].map((sev) => (
          <Badge key={sev} variant={bySeverity[sev] ? SEVERITY_VARIANT[sev] : "muted"}>
            {bySeverity[sev]} {t(sev)}
          </Badge>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <Badge variant="outline">{t("{n} scenes", { n: stats.scenes ?? 0 })}</Badge>
        <Badge variant="outline">{t("{n} dialogue lines", { n: stats.dialogueLines ?? 0 })}</Badge>
        <Badge variant="outline">{t("{n} words", { n: stats.words ?? 0 })}</Badge>
        {stats.estimatedRuntime && (
          <Badge variant="info"><Gauge size={11} /> {t("~{time} runtime", { time: stats.estimatedRuntime })}</Badge>
        )}
      </div>

      {top.length > 0 && (
        <div className="mt-3 space-y-2">
          {top.map((issue, i) => (
            <div key={`${issue.code}-${issue.index}-${i}`} className="rounded-md border bg-muted/30 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={SEVERITY_VARIANT[issue.severity] || "muted"} className="text-[10px] uppercase">
                  {t(issue.severity || "medium")}
                </Badge>
                <span className="font-mono text-[11px] text-muted-foreground">{issue.code}</span>
                {issue.line && <span className="truncate text-[11px] text-muted-foreground">“{issue.line}”</span>}
              </div>
              <p className="mt-1 leading-relaxed">{issue.message}</p>
              {issue.fix && (
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground/70">{t("Fix")}: </span>
                  {issue.fix}
                </p>
              )}
            </div>
          ))}
          {issues.length > top.length && (
            <p className="text-xs text-muted-foreground">
              {t("and {n} more — the Script tab is where they get fixed.", { n: issues.length - top.length })}
            </p>
          )}
        </div>
      )}

      {characters.length > 0 && (
        <div className="mt-3">
          <Eyebrow className="mb-1.5">{t("Who speaks")}</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {characters.map((c) => (
              <Badge key={c.name} variant="secondary" className="font-normal">
                {c.name}
                <span className="text-muted-foreground">
                  {t("{n} lines", { n: c.lines })}
                </span>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- *
 * Route                                                             *
 * ---------------------------------------------------------------- */

function ScriptAgents() {
  const t = useT();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const { reviews, reviewsError, lint } = useLoaderData();
  useRevalidateOnMount("script-agents");

  // A specialist's last act is `record_script_review`, so its pass only lands in
  // the ledger when the turn ends — refresh then.
  useRevalidateOnAgentIdle("script-agents", agent.status);

  // Defend against an older worker (or a 500 that still returned a body): the
  // roster is shared client-side too, so the board renders every specialist
  // whether or not the response carried the definitions.
  const roster = Array.isArray(reviews?.roster) && reviews.roster.length ? reviews.roster : SPECIALISTS;
  const lines = reviews?.lines ?? 0;
  const scriptExists = !!reviews && lines > 0;

  const fresh = useMemo(() => new Set(reviews?.fresh || []), [reviews]);
  const stale = useMemo(() => new Set(reviews?.stale || []), [reviews]);

  const stateOf = useCallback(
    (id) => (fresh.has(id) ? "fresh" : stale.has(id) ? "stale" : "pending"),
    [fresh, stale],
  );

  const run = useCallback(
    (id) => {
      agent
        .send({ message: reviewMessage(id, { stale: stale.has(id), lines }) })
        .catch(() => {});
    },
    [agent, stale, lines],
  );

  const groups = useMemo(
    () =>
      STAGE_ORDER.map((stage) => ({
        stage,
        core: roster.filter((s) => s.stage === stage && s.lane !== "ondemand"),
        ondemand: roster.filter((s) => s.stage === stage && s.lane === "ondemand"),
      })).filter((g) => g.core.length || g.ondemand.length),
    [roster],
  );

  const totals = reviews?.totals || {};
  const freshCount = totals.fresh ?? fresh.size;
  const disabled = agentBusy || !scriptExists;
  const disabledReason = agentBusy
    ? t("the agent is busy — wait for the current turn to finish")
    : !scriptExists
      ? t("there is no script to read yet")
      : null;

  const card = (spec) => (
    <SpecialistCard
      key={spec.id}
      spec={spec}
      state={stateOf(spec.id)}
      last={reviews?.latest?.[spec.id] || null}
      passes={reviews?.passes?.[spec.id] || 0}
      history={reviews?.history?.[spec.id] || []}
      busy={agentBusy}
      disabled={disabled}
      disabledReason={disabledReason}
      onRun={() => run(spec.id)}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t("Script agents")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("The writers' room: who has read your script, what they said, and what you haven't run yet.")}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/script"><PenLine size={14} /> {t("Open the script")}</Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">
            <Stethoscope size={11} />{" "}
            {t("{n} of {total} have read this revision", { n: freshCount, total: roster.length })}
          </Badge>
          {reviews?.draftName && <Badge variant="secondary">{reviews.draftName}</Badge>}
          <Badge variant="outline">{t("{n} lines", { n: lines })}</Badge>
          {totals.stale ? <Badge variant="warning">{t("{n} stale", { n: totals.stale })}</Badge> : null}
          {totals.pending ? <Badge variant="muted">{t("{n} never run", { n: totals.pending })}</Badge> : null}
          {totals.passes ? <Badge variant="info">{t("{n} passes in total", { n: totals.passes })}</Badge> : null}
          {lint?.stats?.estimatedRuntime && (
            <Badge variant="info"><Gauge size={11} /> {t("~{time} runtime", { time: lint.stats.estimatedRuntime })}</Badge>
          )}
          {agentBusy && (
            <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> {t("agent working…")}</Badge>
          )}
        </div>
      </div>

      {reviewsError && <ErrorNote>{reviewsError}</ErrorNote>}

      {/* No script, no passes. Offering a review of a draft that doesn't exist
          is worse than saying so — the specialist would read an empty page and
          log a pass over nothing. */}
      {!scriptExists ? (
        <Panel>
          <div className="rounded-lg border border-dashed p-10 text-center">
            <Empty>
              {reviews
                ? t("there's no script yet — write one on the Script tab and the room can start reading it.")
                : t("the review ledger couldn't be read, so nobody's passes can be shown.")}
            </Empty>
            <div className="mt-3">
              <Button asChild size="sm">
                <Link to="/script"><PenLine size={13} /> {t("Go to the Script tab")}</Link>
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {lint?.ok && scriptExists && <FormatCheck lint={lint} />}

      {groups.map(({ stage, core, ondemand }) => (
        <Panel
          key={stage}
          title={
            <span className="flex items-center gap-2">
              <Sparkles size={15} className="text-primary" /> {t(STAGE_COPY[stage]?.label || stage)}
            </span>
          }
          meta={<Badge variant="outline">{core.length + ondemand.length}</Badge>}
        >
          <p className="mb-3 text-xs text-muted-foreground">{t(STAGE_COPY[stage]?.note || "")}</p>
          {core.length > 0 && <div className="grid gap-3 md:grid-cols-2">{core.map(card)}</div>}
          {ondemand.length > 0 && (
            <div className={cn(core.length > 0 && "mt-4")}>
              {/* Never auto-offered, always runnable — the deck would otherwise
                  bury every downstream move under "hasn't read it yet" cards. */}
              <Eyebrow className="mb-2">{t("On request — never offered unprompted")}</Eyebrow>
              <div className="grid gap-3 md:grid-cols-2">{ondemand.map(card)}</div>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

// Loader: the review ledger, plus the deterministic lint.
//
// Both are tolerated failing. The lint simply disappears (the panel is hidden);
// the ledger degrades to an inline error rather than throwing, because throwing
// would hand the whole /world layout — sub-tab bar included — to the route
// ErrorBoundary, and the author would lose the way back out of this tab.
export function loader() {
  return swr("script-agents", async () => {
    const get = async (path) => {
      const res = await fetch(path);
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || staticT("Failed to load"));
      return json;
    };
    const [reviews, lint] = await Promise.all([
      get("/api/script/reviews").catch((e) => ({ __error: String(e.message || e) })),
      get("/api/script/lint").catch(() => null),
    ]);
    return {
      reviews: reviews?.__error ? null : reviews,
      reviewsError: reviews?.__error || null,
      lint,
    };
  });
}

export function Component() {
  return <ScriptAgents />;
}
