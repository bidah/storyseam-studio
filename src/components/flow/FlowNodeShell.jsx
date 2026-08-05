// The chrome shared by generator nodes (Image / Video): header (icon + type +
// model + run status), preview area, body slot (prompt + settings), inline
// history strip, and the Run split-button (Run = this node, caret = Run from
// here → this node + everything downstream).
import { ChevronDown, Loader2, Play, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function StatusBadge({ status }) {
  const t = useT();
  if (status === "idle" || status === "ready") return null;
  const cls = status === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${cls}`}>{t(status)}</span>
  );
}

export default function FlowNodeShell({
  title, icon, modelName, status = "idle", preview, children, history,
  running, onRun, onRunFromHere, readOnly, onOpenStack, stackCount = 0,
}) {
  const t = useT();
  return (
    <div className="flex w-[320px] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-md">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{title}</span>
            <StatusBadge status={status} />
          </div>
          {modelName && (
            <div className="truncate text-xs text-muted-foreground" title={modelName}>{modelName}</div>
          )}
        </div>
        {onOpenStack && stackCount > 1 && (
          <button
            type="button"
            onClick={onOpenStack}
            title={t("{stackCount} generations — pick one", { stackCount })}
            className="nodrag relative inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
          >
            <Layers size={14} />
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium text-primary-foreground">
              {stackCount}
            </span>
          </button>
        )}
      </div>

      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted/40">
        {preview}
      </div>

      <div className="nodrag flex flex-col gap-2 p-3">{children}</div>

      {history && <div className="nodrag border-t border-border px-3 py-2">{history}</div>}

      {!readOnly && (
        <div className="nodrag flex items-stretch gap-px border-t border-border p-2">
          <Button className="flex-1 rounded-r-none" disabled={running} onClick={onRun} title={t("Run this node")}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {t("Run")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="rounded-l-none px-2" disabled={running} title={t("Run options")}>
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRunFromHere}>
                {t("Run from here")}
                <span className="ml-2 text-xs text-muted-foreground">{t("this node + downstream")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
