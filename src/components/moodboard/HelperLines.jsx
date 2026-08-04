import { useEffect, useRef } from "react";
import { useStore } from "@xyflow/react";

// Overlays a transparent canvas across the viewport and draws the alignment
// guides reported by getHelperLines. Lines are given in FLOW coordinates and
// projected to screen space with the live viewport transform, so they track the
// board while panning/zooming. Rendered as a child of <ReactFlow>; cleared the
// moment horizontal/vertical go undefined (i.e. on drop, or when nothing lines
// up) — a guide that outlives the drag reads as a real object on the canvas.
export default function HelperLines({ horizontal, vertical }) {
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const transform = useStore((s) => s.transform);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    const dpi = window.devicePixelRatio || 1;
    canvas.width = width * dpi;
    canvas.height = height * dpi;
    ctx.scale(dpi, dpi);
    ctx.clearRect(0, 0, width, height);

    const [tx, ty, zoom] = transform;
    // The brand lime — same accent the selected-card border uses.
    ctx.strokeStyle = "#cbf74e";
    ctx.lineWidth = 1;

    if (typeof vertical === "number") {
      const x = vertical * zoom + tx;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    if (typeof horizontal === "number") {
      const y = horizontal * zoom + ty;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }, [width, height, transform, horizontal, vertical]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute left-0 top-0 z-10 h-full w-full"
    />
  );
}
