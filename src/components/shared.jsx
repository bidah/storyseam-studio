import { X, TriangleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Muted, italic empty / "not yet" state.
function Empty({ children, className }) {
  return (
    <span className={cn("text-sm italic text-muted-foreground", className)}>
      {children}
    </span>
  );
}

// Uppercase eyebrow / section label.
function Eyebrow({ children, className }) {
  return (
    <div className={cn("text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", className)}>
      {children}
    </div>
  );
}

// Toggle chip (moods, restrictions, …).
function Chip({ on, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        on
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Section card with a title row.
function Panel({ id, title, meta, className, bodyClassName, children }) {
  return (
    <Card id={id} className={cn("gap-0 overflow-hidden py-0", className)}>
      {(title || meta) && (
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3 [.border-b]:pb-3">
          {title && <CardTitle className="text-sm font-semibold">{title}</CardTitle>}
          {meta}
        </CardHeader>
      )}
      <CardContent className={cn("p-4", bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

function ErrorNote({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Full-size image viewer                                           *
 * ---------------------------------------------------------------- */

function ImageModal({ image, onClose }) {
  return (
    <Dialog open={!!image} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-[96vw]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{image?.name || "Image"}</DialogTitle>
        </DialogHeader>
        {image && (
          <>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
              <img
                src={image.url}
                alt={image.name}
                className="h-full w-full object-contain"
              />
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3 text-sm">
              <Badge variant="secondary" className="uppercase">{image.role}</Badge>
              <span className="truncate text-muted-foreground">{image.name}</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Confirm dialog                                                   *
 * ---------------------------------------------------------------- */

function ConfirmModal({ open, title, message, confirmLabel = "Remove", onConfirm, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Complete cuts (stitch selected takes)                            *
 * ---------------------------------------------------------------- */

function fmtTime(sec) {
  if (!sec && sec !== 0) return "—";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export { Empty, Eyebrow, Chip, Panel, Spinner, ErrorNote, ImageModal, ConfirmModal, fmtTime };
