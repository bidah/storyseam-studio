import { useCallback, useEffect, useState } from "react";
import { X, Check, Plus, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { readTabCache, writeTabCache } from "@/lib/tabCache";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner, ErrorNote, ConfirmModal } from "@/components/shared";
import { useShell } from "@/lib/shellContext";

/* ---------------------------------------------------------------- *
 * Asset library                                                    *
 * ---------------------------------------------------------------- */

function Library({ reloadKey, onView }) {
  const [folders, setFolders] = useState(() => readTabCache("library") ?? null);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(() => readTabCache("library") === undefined);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    if (readTabCache("library") === undefined) setLoading(true);
    setError(null);
    fetch("/api/library")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setFolders(j.folders);
        writeTabCache("library", j.folders);
      })
      .catch((e) => { if (readTabCache("library") === undefined) setError(String(e.message || e)); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const toggle = useCallback(async (im) => {
    try {
      const res = await fetch("/api/library/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel: im.rel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolders((fs) => {
        const next = fs.map((f) => ({
          ...f,
          images: f.images.map((x) => (x.rel === im.rel ? { ...x, selected: data.selected } : x)),
        }));
        writeTabCache("library", next); // keep the cache in step with the optimistic toggle
        return next;
      });
    } catch (e) {
      setError(String(e.message || e));
    }
  }, []);

  if (loading) return <Spinner label="loading library…" />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!folders) return null;

  const af = active && folders.find((f) => f.folder === active);

  if (af) {
    const selCount = af.images.filter((i) => i.selected).length;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setActive(null)}>
            <ChevronLeft size={14} /> all folders
          </Button>
          <h2 className="text-xl font-semibold tracking-tight">{af.folder}</h2>
          <Badge variant="outline">{af.count} images</Badge>
          {selCount > 0 && <Badge variant="success">{selCount} selected</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {af.images.map((im) => (
            <figure
              key={im.rel}
              className={cn(
                "group relative overflow-hidden rounded-lg border bg-muted transition-colors",
                im.selected ? "border-primary ring-1 ring-primary/40" : "border-border"
              )}
            >
              <button className="block w-full" onClick={() => onView({ url: im.url, name: im.rel, role: "asset" })}>
                <img src={im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
              </button>
              {im.selected ? (
                <Button
                  variant="destructive" size="icon-xs"
                  className="absolute right-1.5 top-1.5 rounded-full opacity-90"
                  title="remove from final_selection" aria-label="remove from final_selection"
                  onClick={() => setConfirm(im)}
                >
                  <X size={13} />
                </Button>
              ) : (
                <Button
                  size="icon-xs"
                  className="absolute right-1.5 top-1.5 rounded-full opacity-0 transition-opacity group-hover:opacity-90"
                  title="add to final_selection" aria-label="add to final_selection"
                  onClick={() => toggle(im)}
                >
                  <Plus size={14} />
                </Button>
              )}
              {im.selected && <Badge className="absolute left-1.5 top-1.5">selected</Badge>}
              <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">{im.name}</figcaption>
            </figure>
          ))}
        </div>

        <ConfirmModal
          open={!!confirm}
          title="Remove from selection?"
          message={confirm ? `"${confirm.name}" will be removed from final_selection (and any shots it was assigned to).` : ""}
          confirmLabel="Remove"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            toggle(confirm);
            setConfirm(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Asset library</h2>
        <Badge variant="outline">{folders.length} folders</Badge>
        <Badge variant="success">
          {folders.reduce((a, f) => a + f.images.filter((i) => i.selected).length, 0)} selected → final_selection
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {folders.map((f) => {
          const sel = f.images.filter((i) => i.selected).length;
          return (
            <button
              key={f.folder}
              className="group overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/50"
              onClick={() => setActive(f.folder)}
            >
              <div className="relative aspect-video bg-muted">
                <img src={f.preview} loading="lazy" alt={f.folder} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                {sel > 0 && <Badge className="absolute right-2 top-2">{sel} <Check size={11} /></Badge>}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium">{f.folder}</div>
                <div className="text-xs text-muted-foreground">{f.count} images</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { Library };

export function Component() {
  const { reloadKey, setModalImage } = useShell();
  return <Library reloadKey={reloadKey} onView={setModalImage} />;
}
