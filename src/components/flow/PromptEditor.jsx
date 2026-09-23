// The node prompt field. A plain textarea (this surface has no TipTap) with the
// `nodrag nowheel` guards so typing/scrolling doesn't pan the canvas. When a Text
// node is wired into this node's text-input, the inherited prompt is shown
// read-only above the box (it's prepended at Run time) instead of the editor.
import { Textarea } from "@/components/ui/textarea";

export default function PromptEditor({ value, onChange, placeholder, readOnly, inheritedText }) {
  if (inheritedText != null && inheritedText !== "") {
    return (
      <div className="rounded-none border border-dashed border-border bg-muted/40 p-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Inherited prompt
        </span>
        <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
          {inheritedText}
        </p>
      </div>
    );
  }
  return (
    <Textarea
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      rows={3}
      className="nodrag nowheel resize-none text-sm"
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
