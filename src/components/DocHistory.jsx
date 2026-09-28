// Version history for one project JSON document (world, shotlist, sounds, …).
//
// Every write to a doc store parks the bytes it replaced (worker/src/lib/
// history.js), because R2 has no object versioning and a `put` is otherwise
// unrecoverable. This dialog lists those versions and puts one back. Restoring
// is itself a write, so the version you restore OVER is parked too — a restore
// is always undoable, which is what makes the button safe to press.

import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, Loader2, Bot, User, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, ErrorNote, Spinner } from "@/components/shared";
import { cn } from "@/lib/utils";

// "2026-07-22T21-56-31-995Z" → a local, human date. Falls back to the raw
// stamp if the shape ever changes.
function prettyWhen(iso, ts) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const prettySize = (n) =>
  typeof n !== "number" ? "" : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;

// Who wrote the version we're offering to restore. The agent is the writer most
// likely to have clobbered something, so it's worth calling out.
function SourceBadge({ source }) {
  if (!source) return null;
  const isAgent = /agent/i.test(source);
  return (
    <Badge variant={isAgent ? "warning" : "muted"} className="shrink-0">
      {isAgent ? <Bot size={10} /> : <User size={10} />} {source}
    </Badge>
  );
}

// The trigger takes the same variant/size/className as <Button>, so a page can
// set it to match the buttons beside it instead of keeping this default look.
export default function DocHistory({
  doc,
  label = "History",
  onRestored,
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
}) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState(null);
  const [error, setError] = useState(null);
  const [restoring, setRestoring] = useState(null); // ts being restored
  const [restored, setRestored] = useState(null); // ts just restored

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/history/${doc}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't load history");
      const j = await res.json();
      setSnapshots(j.snapshots || []);
    } catch (e) {
      setError(String(e.message || e));
      setSnapshots([]);
    }
  }, [doc]);

  useEffect(() => {
    if (!open) return;
    setSnapshots(null);
    setRestored(null);
    load();
  }, [open, load]);

  const restore = async (ts) => {
    setRestoring(ts);
    setError(null);
    try {
      const res = await fetch(`/api/history/${doc}/${ts}/restore`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Restore failed");
      setRestored(ts);
      onRestored?.();
      // The restore parked the version it replaced, so the list has changed.
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} className={triggerClassName}>
          <History size={14} /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Every save parks the previous version here. Restoring one saves the current
          version too, so you can always come straight back.
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        {snapshots === null ? (
          <div className="py-10"><Spinner /></div>
        ) : snapshots.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>no earlier versions yet — the next save will park the current one here.</Empty>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {snapshots.map((s) => (
              <div
                key={s.ts}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-2",
                  restored === s.ts && "border-primary/60 bg-primary/5",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {prettyWhen(s.at, s.ts)}
                    </span>
                    <SourceBadge source={s.source} />
                  </div>
                  <div className="text-xs text-muted-foreground">{prettySize(s.size)}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={!!restoring}
                  onClick={() => restore(s.ts)}
                >
                  {restoring === s.ts ? (
                    <><Loader2 size={13} className="animate-spin" /> Restoring…</>
                  ) : restored === s.ts ? (
                    <><Check size={13} /> Restored</>
                  ) : (
                    <><RotateCcw size={13} /> Restore</>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
