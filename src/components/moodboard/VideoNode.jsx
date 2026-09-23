import { useCallback, memo } from "react";
import { NodeResizer } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Smallest on-canvas footprint a resize can shrink a video to.
const MIN_SIZE = 80;

function VideoNode({ data, selected }) {
  const { src, naturalWidth, naturalHeight, onDelete } = data;
  const aspect = naturalHeight > 0 ? naturalWidth / naturalHeight : 16 / 9;

  const handleDelete = useCallback(
    (e) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete],
  );

  return (
    <div className={`video-node group relative h-full w-full ${selected ? "selected" : ""}`}>
      <NodeResizer
        isVisible={selected}
        keepAspectRatio
        minWidth={MIN_SIZE}
        minHeight={MIN_SIZE / aspect}
        lineClassName="!border-primary"
        handleClassName="!size-3 !rounded-none !border-2 !border-primary !bg-background"
      />

      {/* `nodrag nopan` so the native controls (play / scrub / fullscreen) work
          without the gesture being hijacked into panning or dragging the node.
          `bg-black` is the letterbox behind an object-contain clip — picture
          matte, not a surface, so it stays black rather than a theme token.
          `border` replaces the old drop shadow: the flat system separates a card
          from the canvas with a hairline, not with depth. */}
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        className="nodrag nopan h-full w-full select-none rounded-none border bg-black object-contain"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />

      <div
        className="nodrag absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ opacity: selected ? 1 : undefined }}
      >
        <Button
          size="icon-sm"
          variant="secondary"
          className="text-destructive hover:text-destructive"
          aria-label="Delete video"
          onClick={handleDelete}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}

export default memo(
  VideoNode,
  (prev, next) =>
    prev.selected === next.selected &&
    prev.data.src === next.data.src &&
    prev.data.width === next.data.width &&
    prev.data.height === next.data.height,
);
