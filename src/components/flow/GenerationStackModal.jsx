// A node's generation stack — every retry it produced. Clicking one selects it
// as the node's currentGenId (the media shown in the node preview).
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Empty } from "@/components/shared";
import { useT } from "@/lib/i18n";

export default function GenerationStackModal({ open, onClose, generations, currentGenId, onSelect }) {
  const t = useT();
  const list = (generations || []).filter((g) => g.status !== "error");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("Generations")}</DialogTitle></DialogHeader>
        {list.length === 0 ? (
          <div className="rounded-none border border-dashed p-8 text-center">
            <Empty>{t("this node hasn't produced any generations yet.")}</Empty>
          </div>
        ) : (
          <div className="grid max-h-[70vh] grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
            {list.map((g) => {
              const active = g.id === currentGenId;
              return (
                <button
                  key={g.id}
                  onClick={() => { onSelect(g.id); onClose(); }}
                  title={g.prompt}
                  className={`group relative aspect-square overflow-hidden rounded-none border bg-muted transition-colors ${
                    active ? "border-primary ring-1 ring-primary" : "hover:border-primary/60"
                  }`}
                >
                  {g.status === "processing" ? (
                    <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">{t("generating…")}</div>
                  ) : g.kind === "video" ? (
                    <video src={g.url} className="h-full w-full object-cover" muted />
                  ) : (
                    <img src={g.thumb || g.url} alt={g.prompt} className="h-full w-full object-cover" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
