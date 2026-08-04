import { useCallback, memo } from "react";
import { NodeResizer } from "@xyflow/react";
import { Maximize2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Smallest on-canvas footprint a resize can shrink an image to.
const MIN_SIZE = 60;

// A reference image on the board. Freely resizable, but the handle is pinned to
// the source aspect ratio — a squashed reference is worse than no reference.
function ImageNode({ data, selected }) {
  const { src, naturalWidth, naturalHeight, onDelete, onView } = data;
  const aspect = naturalHeight > 0 ? naturalWidth / naturalHeight : 1;

  const handleDelete = useCallback(
    (e) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete],
  );

  return (
    <div className={`image-node group relative h-full w-full ${selected ? "selected" : ""}`}>
      <NodeResizer
        isVisible={selected}
        keepAspectRatio
        minWidth={MIN_SIZE}
        minHeight={MIN_SIZE / aspect}
        lineClassName="!border-primary"
        handleClassName="!size-3 !rounded-sm !border-2 !border-primary !bg-background"
      />

      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full select-none rounded-md object-contain shadow-sm"
      />

      <div
        className="nodrag absolute bottom-2 right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ opacity: selected ? 1 : undefined }}
      >
        <Button
          size="icon-sm"
          variant="secondary"
          className="shadow-sm"
          aria-label="View full size"
          onClick={(e) => {
            e.stopPropagation();
            onView?.(src);
          }}
        >
          <Maximize2 size={14} />
        </Button>
        <Button
          size="icon-sm"
          variant="secondary"
          className="text-destructive shadow-sm hover:text-destructive"
          aria-label="Delete image"
          onClick={handleDelete}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}

export default memo(
  ImageNode,
  (prev, next) =>
    prev.selected === next.selected &&
    prev.data.src === next.data.src &&
    prev.data.width === next.data.width &&
    prev.data.height === next.data.height,
);
