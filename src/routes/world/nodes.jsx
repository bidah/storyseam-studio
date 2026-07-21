import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel as FlowPanel,
  Handle, Position, NodeResizer, useNodesState, useEdgesState, addEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Trash2, Plus, Loader2, ImageOff } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { useShell } from "@/lib/shellContext";
import { Button } from "@/components/ui/button";
import { Empty, ErrorNote } from "@/components/shared";

/* ---------------------------------------------------------------- *
 * Custom node — a generated image with lineage handles.             *
 * ---------------------------------------------------------------- */

function ImageNode({ id, data, selected }) {
  const { gen, onOpen, onRemove } = data;
  return (
    <div className="group relative h-full w-full overflow-hidden rounded-lg border-2 border-border bg-muted shadow-sm">
      <NodeResizer isVisible={selected} minWidth={120} minHeight={120} keepAspectRatio />
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-primary" />
      {gen?.url ? (
        <img src={gen.url} alt={gen.prompt || "generation"} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageOff size={20} /><span className="text-[10px]">missing</span>
        </div>
      )}
      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {gen?.url && (
          <button
            onClick={() => onOpen(gen)}
            aria-label="View full image"
            className="rounded-md border bg-background/90 p-1 text-muted-foreground shadow-sm hover:text-primary"
          >
            <Maximize2 size={13} />
          </button>
        )}
        <button
          onClick={() => onRemove(id)}
          aria-label="Remove from canvas"
          className="rounded-md border bg-background/90 p-1 text-muted-foreground shadow-sm hover:text-destructive"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-primary" />
    </div>
  );
}

const nodeTypes = { image: ImageNode };

/* ---------------------------------------------------------------- *
 * Canvas                                                            *
 * ---------------------------------------------------------------- */

function Canvas() {
  const world = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("visual-world");
  const { setModalImage } = useShell();
  const [error, setError] = useState(null);

  const generations = world.generations || [];
  const genById = useMemo(() => new Map(generations.map((g) => [g.id, g])), [generations]);
  const board = world.board || { nodes: [], edges: [], viewport: null };

  const openImage = useCallback((g) => setModalImage({ url: g.url, name: g.prompt || "generation", role: "asset" }), [setModalImage]);

  // Persist the whole board (debounced). Reads live nodes/edges from refs so the
  // debounce always flushes the latest.
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const saveTimer = useRef(null);
  const save = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const boardOut = {
        nodes: nodesRef.current.map((n) => ({
          id: n.id, genId: n.data.gen?.id || n.data.genId,
          x: n.position.x, y: n.position.y,
          w: n.width ?? n.measured?.width ?? null, h: n.height ?? n.measured?.height ?? null,
        })),
        edges: edgesRef.current.map((e) => ({ id: e.id, source: e.source, target: e.target })),
        viewport: world.board?.viewport ?? null,
      };
      try {
        const res = await fetch("/api/visual-world/board", {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board: boardOut }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
        invalidateTabCache("visual-world");
      } catch (e) { setError(String(e.message || e)); }
    }, 600);
  }, [world.board]);

  const removeNode = useCallback((nodeId) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    save();
  }, [save]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the initial RF nodes/edges from the stored board.
  const initialNodes = useMemo(
    () => board.nodes
      .filter((n) => genById.has(n.genId))
      .map((n) => ({
        id: n.id,
        type: "image",
        position: { x: n.x, y: n.y },
        ...(n.w && n.h ? { style: { width: n.w, height: n.h } } : { style: { width: 180, height: 180 } }),
        data: { gen: genById.get(n.genId), genId: n.genId, onOpen: openImage, onRemove: removeNode },
      })),
    [board.nodes, genById, openImage, removeNode],
  );
  const initialEdges = useMemo(() => board.edges.map((e) => ({ ...e, animated: true })), [board.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  // Reconcile when the loader data changes (agent added a generation, etc.) —
  // keep live positions, refresh the gen payloads, drop nodes whose gen is gone.
  useEffect(() => {
    setNodes((cur) => cur
      .filter((n) => genById.has(n.data.gen?.id || n.data.genId))
      .map((n) => ({ ...n, data: { ...n.data, gen: genById.get(n.data.gen?.id || n.data.genId), onOpen: openImage, onRemove: removeNode } })));
  }, [genById, openImage, removeNode, setNodes]);

  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({ ...params, animated: true, id: `edge-${params.source}-${params.target}` }, eds));
    save();
  }, [save, setEdges]);

  const onDrop = useCallback((g) => {
    const i = nodesRef.current.length;
    setNodes((nds) => [...nds, {
      id: `node-${g.id}-${Date.now().toString(36)}`,
      type: "image",
      position: { x: 80 + (i % 6) * 60, y: 80 + (i % 6) * 60 },
      style: { width: 180, height: 180 },
      data: { gen: g, genId: g.id, onOpen: openImage, onRemove: removeNode },
    }]);
    save();
  }, [openImage, removeNode, save, setNodes]);

  const onCanvas = useMemo(() => new Set(nodes.map((n) => n.data.gen?.id || n.data.genId)), [nodes]);
  const readyOffCanvas = generations.filter((g) => g.status === "ready" && !onCanvas.has(g.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Visual nodes</h2>
          <p className="text-sm text-muted-foreground">Arrange your generations and draw reference-lineage links between them.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => revalidator.revalidate()}>
          {revalidator.state === "loading" ? <Loader2 size={13} className="animate-spin" /> : null} Refresh
        </Button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {generations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Empty>no generations yet — create some on the Visual tab, then drop them here.</Empty>
        </div>
      ) : (
        <div className="h-[72vh] overflow-hidden rounded-xl border bg-card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={save}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-muted/30"
          >
            <Background gap={20} className="!bg-transparent" />
            <Controls />
            <MiniMap pannable zoomable className="!bg-card" />
            {readyOffCanvas.length > 0 && (
              <FlowPanel position="top-left" className="max-w-[220px] rounded-lg border bg-card/95 p-2 shadow-md backdrop-blur">
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Add to canvas</div>
                <div className="grid max-h-40 grid-cols-3 gap-1.5 overflow-y-auto">
                  {readyOffCanvas.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => onDrop(g)}
                      className="group relative aspect-square overflow-hidden rounded-md border hover:border-primary/60"
                      title={g.prompt}
                    >
                      <img src={g.url} alt={g.prompt} className="h-full w-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-background/60 opacity-0 group-hover:opacity-100">
                        <Plus size={16} />
                      </span>
                    </button>
                  ))}
                </div>
              </FlowPanel>
            )}
          </ReactFlow>
        </div>
      )}
    </div>
  );
}

export function loader() {
  return swr("visual-world", async () => {
    const res = await fetch("/api/visual-world");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export function Component() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
