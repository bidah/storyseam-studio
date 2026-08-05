// The Files panel — a side sheet of every ready generation in the pool (from the
// Visual tab, agent runs, or node runs). Clicking one places it on the canvas as
// a Source node (or, when replacing, rebinds an existing Source node). Lets the
// canvas pull from everything the project has generated, not just fresh runs.
import { Image as ImageIcon, Clapperboard } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Empty } from "@/components/shared";

export default function FilesPanel({ open, onClose, generations, onPick, title = "Files" }) {
  const ready = (generations || []).filter((g) => g.status === "ready" && g.url);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-[380px] flex-col gap-3 sm:max-w-[380px]">
        <SheetHeader className="p-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Click a generation to drop it on the canvas as a source.</SheetDescription>
        </SheetHeader>
        {ready.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>no ready generations yet — make some on the Visual tab or run a node.</Empty>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 overflow-y-auto pr-1">
            {ready.map((g) => (
              <button
                key={g.id}
                onClick={() => onPick(g.id)}
                title={g.prompt}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted hover:border-primary/60"
              >
                {g.kind === "video" ? (
                  <video src={g.url} className="h-full w-full object-cover" muted />
                ) : (
                  <img src={g.thumb || g.url} alt={g.prompt} loading="lazy" className="h-full w-full object-cover" />
                )}
                <span className="absolute right-1 top-1 rounded bg-background/80 p-0.5 text-muted-foreground">
                  {g.kind === "video" ? <Clapperboard size={11} /> : <ImageIcon size={11} />}
                </span>
              </button>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
