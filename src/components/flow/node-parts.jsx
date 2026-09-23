// Shared building blocks for the flow node components: typed handles, the
// reference-image chip row, the media preview area, and the inline history
// strip. Kept here so Image/Video/Text/Upload nodes stay small and consistent.
import { Handle, Position } from "@xyflow/react";
import { Image as ImageIcon, Type as TypeIcon, Clapperboard, Frame, Loader2 } from "lucide-react";
import { FLOW_CONNECT_RULES } from "./flow-config";
import { useT } from "@/lib/i18n";

// Larger, self-describing hit-areas colored by the data they carry
// (image = sky, text = slate, video = violet). Those colors are the edge TYPE
// system, not chrome — the placeholder copy points at "the blue handle" and the
// three kinds have to stay tellable apart, so they are NOT flattened to the
// accent token. `!rounded-full` stays too: a connection handle is a port, and a
// square port reads as a resize grip.
const HANDLE_BASE =
  "!size-5 !rounded-full !border-2 !border-background flex items-center justify-center text-white transition-transform hover:!scale-110 [&_svg]:!size-3 [&_svg]:pointer-events-none";

const HANDLE_COLOR = {
  "image-output": "!bg-sky-500",
  "image-input": "!bg-sky-500",
  "start-frame": "!bg-sky-500",
  "video-output": "!bg-violet-500",
  "text-output": "!bg-slate-500",
  "text-input": "!bg-slate-500",
};

const HANDLE_ICON = {
  "image-output": ImageIcon,
  "image-input": ImageIcon,
  "start-frame": Frame,
  "video-output": Clapperboard,
  "text-output": TypeIcon,
  "text-input": TypeIcon,
};

// Legality check shared by both handle kinds via React Flow's isValidConnection.
function isLegal(sourceHandle, targetHandle) {
  const allowed = FLOW_CONNECT_RULES[sourceHandle];
  return !!allowed && allowed.includes(targetHandle);
}
const validConnection = (c) => isLegal(c.sourceHandle, c.targetHandle);

export function SourceHandle({ id }) {
  const Icon = HANDLE_ICON[id];
  return (
    <Handle
      type="source"
      id={id}
      position={Position.Right}
      isValidConnection={validConnection}
      className={`${HANDLE_BASE} ${HANDLE_COLOR[id]}`}
    >
      <Icon />
    </Handle>
  );
}

// `top` lets multiple input handles stack vertically on the left edge.
export function TargetHandle({ id, top }) {
  const Icon = HANDLE_ICON[id];
  return (
    <Handle
      type="target"
      id={id}
      position={Position.Left}
      isValidConnection={validConnection}
      className={`${HANDLE_BASE} ${HANDLE_COLOR[id]}`}
      style={top ? { top } : undefined}
    >
      <Icon />
    </Handle>
  );
}

// A "Reference images" row of thumbnails for the images wired into a node's
// image-input / start-frame handles — mirrors what's sent to the generation.
export function RefChips({ refs }) {
  const t = useT();
  if (!refs || refs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("Reference images")}
      </span>
      <div className="nowheel flex gap-1.5 overflow-x-auto">
        {refs.map((r, i) => (
          <div
            key={`${r.label}-${i}`}
            title={r.label}
            className="size-10 shrink-0 overflow-hidden rounded-none border border-border"
          >
            <img src={r.thumb || r.url} alt={r.label} className="h-full w-full object-cover" />
          </div>
        ))}
      </div>
    </div>
  );
}

// The node's current generation media, a processing spinner, an error, or the
// empty-state placeholder. `bust` cache-busts the media url after a re-render.
export function NodePreview({ generation, emptyLabel }) {
  const t = useT();
  const resolvedEmpty = emptyLabel || t("Your generation will appear here");
  if (!generation) {
    return <span className="px-4 text-center text-xs text-muted-foreground">{resolvedEmpty}</span>;
  }
  if (generation.status === "error") {
    return (
      <span className="px-4 text-center text-xs text-destructive">
        {generation.error || t("Generation failed")}
      </span>
    );
  }
  if (generation.status === "processing" || !generation.url) {
    return (
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-xs">{t("Generating…")}</span>
      </div>
    );
  }
  if (generation.kind === "video") {
    return (
      <video
        src={generation.url}
        className="nodrag nopan h-full w-full object-contain"
        controls
        playsInline
        draggable={false}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <img src={generation.display || generation.url} alt="" className="h-full w-full select-none object-contain" draggable={false} />
  );
}

// The node's ready retries (newest last). Clicking one selects it as the node's
// currentGenId via onPick.
export function HistoryStrip({ generations, currentGenId, onPick }) {
  const t = useT();
  const ready = (generations || []).filter((g) => g.status === "ready" && g.url);
  if (ready.length < 2) return null;
  return (
    <div className="nowheel flex gap-1.5 overflow-x-auto">
      {ready.map((g) => {
        const active = g.id === currentGenId;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onPick(g.id)}
            title={g.prompt || t("Generation")}
            className={`relative size-11 shrink-0 overflow-hidden rounded-none border transition-colors ${
              active ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/40"
            }`}
          >
            {g.kind === "video" ? (
              <video src={g.url} className="h-full w-full object-cover" muted />
            ) : (
              <img src={g.thumb || g.url} alt="" className="h-full w-full object-cover" />
            )}
          </button>
        );
      })}
    </div>
  );
}
