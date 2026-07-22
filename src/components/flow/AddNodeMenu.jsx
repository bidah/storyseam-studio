// The "Add a node" menu content shared by the pane right-click and the
// drag-edge-to-empty-canvas flow. Renders menu items only, so it drops inside
// the caller's <ContextMenuContent>. `allowedTypes` (from an edge drop) filters
// to the node types that source handle may legally wire into.
import { Image, Video, Type, Upload, ArrowUpCircle, ScanFace, AudioLines, Music, Layers } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";

const LIVE_ENTRIES = [
  { type: "image", label: "Image", icon: Image },
  { type: "video", label: "Video", icon: Video },
  { type: "text", label: "Text", icon: Type },
  { type: "upload", label: "Source media", icon: Upload },
];

const COMING_SOON = [
  { label: "Upscale", icon: ArrowUpCircle },
  { label: "Lipsync", icon: ScanFace },
  { label: "Text to Speech", icon: AudioLines },
  { label: "Sound Effects", icon: Music },
  { label: "Composition", icon: Layers },
];

export function AddNodeMenu({ allowedTypes, onAdd }) {
  const live = allowedTypes ? LIVE_ENTRIES.filter((e) => allowedTypes.includes(e.type)) : LIVE_ENTRIES;
  return (
    <>
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Add a node</div>
      {live.map(({ type, label, icon: Icon }) => (
        <ContextMenuItem key={type} onSelect={() => onAdd(type)}>
          <Icon size={14} /> {label}
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      {COMING_SOON.map(({ label, icon: Icon }) => (
        <ContextMenuItem key={label} disabled>
          <Icon size={14} />
          <span>{label}</span>
          <span className="ml-auto text-xs text-muted-foreground">Coming soon</span>
        </ContextMenuItem>
      ))}
    </>
  );
}

export default AddNodeMenu;
