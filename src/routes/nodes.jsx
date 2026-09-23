// The Visual nodes canvas — a node-driven generation graph (adapted from the
// idea-mural /nodes flow to shot-studio's stack). Each Image/Video node carries a
// prompt + settings and Runs to fire a Higgsfield job, using its wired input
// edges as references; Text nodes are prompt sources; Source nodes hold an
// existing generation. Edges are TYPED and functional (see flow-config).
//
// Its own top-level surface at /nodes (the `nodes` plugin), no longer a sub-tab
// of World. It reads and writes the SAME `visual-world` document the /images and
// /videos surfaces do — the canvas is a different way to drive one generation
// store, not a second copy of it — so it keeps the `visual-world` swr key and
// stays in step with them through the usual invalidate + revalidate pair.
//
// Persistence: the graph lives on `visual-world.json`'s `board` (nodes/edges),
// saved via PUT /api/visual-world/board (debounced). Runs go through
// POST /node/run; the cascade advances on the /poll cycle (server-side, on
// `board.run`). The client is authoritative for structure/prompt/settings/
// position; the server owns each node's currentGenId/genIds + the active run,
// which we merge back in on reload.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel as FlowPanel,
  useReactFlow, applyNodeChanges, applyEdgeChanges, addEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Expand, FolderOpen, Loader2, Sparkles } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ContextMenu, ContextMenuContent, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Empty, ErrorNote } from "@/components/shared";
import { nodeTypes } from "@/components/flow/node-types";
import { FlowMetaProvider } from "@/components/flow/flow-context";
import { AddNodeMenu } from "@/components/flow/AddNodeMenu";
import FilesPanel from "@/components/flow/FilesPanel";
import GenerationStackModal from "@/components/flow/GenerationStackModal";
import {
  FLOW_CONNECT_RULES, ONE_TO_ONE_TARGETS, RUNNABLE_TYPES,
  allowedTypesForSourceHandle, pickTargetHandle, freshNode,
} from "@/components/flow/flow-config";

// Per-node run status from the active run + the node's current generation.
function nodeStatus(run, node) {
  if (!run?.active || !run.runSet.includes(node.id)) return "idle";
  if (run.errored.includes(node.id)) return "error";
  if (run.ready.includes(node.id)) return "ready";
  if (run.started.includes(node.id)) return "running";
  return "queued";
}

function Canvas() {
  const t = useT();
  const world = useLoaderData();
  const agent = useAgent();
  const revalidator = useRevalidator();
  useRevalidateOnMount("visual-world");
  useRevalidateOnAgentIdle("visual-world", agent.status);
  const { screenToFlowPosition } = useReactFlow();

  const [error, setError] = useState(null);
  // Node ids just clicked to Run — shown as "queued" instantly (before the POST
  // returns + the server run is refetched), so the button reacts immediately.
  const [optimisticRun, setOptimisticRun] = useState([]);

  const generations = world.generations || [];
  const genById = useMemo(() => new Map(generations.map((g) => [g.id, g])), [generations]);
  const prompts = world.prompts || [];
  const serverBoard = world.board || { nodes: [], edges: [], run: null };
  const run = serverBoard.run;
  const defaultPresetId = world.settings?.presetId || prompts[0]?.id || "";

  const revalidate = revalidator.revalidate;
  const refetch = useCallback(() => { invalidateTabCache("visual-world"); revalidate(); }, [revalidate]);

  // --- Model catalogs (best-effort; empty still works — server resolves defaults). ---
  const [imageModels, setImageModels] = useState([]);
  const [videoModels, setVideoModels] = useState([]);
  useEffect(() => {
    let off = false;
    fetch("/api/visual-world/models").then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!off && j?.models) setImageModels(j.models); }).catch(() => {});
    fetch("/api/visual-world/models?type=video").then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!off && j?.models) setVideoModels(j.models); }).catch(() => {});
    return () => { off = true; };
  }, []);
  const meta = useMemo(() => ({ imageModels, videoModels, prompts }), [imageModels, videoModels, prompts]);

  // --- Local flow graph (authoritative for structure/prompt/settings/position). ---
  const [graph, setGraph] = useState(() => ({
    nodes: serverBoard.nodes.map((n) => ({ ...n })),
    edges: serverBoard.edges.map((e) => ({ ...e })),
  }));
  const graphRef = useRef(graph);
  graphRef.current = graph;
  // Ids added locally but not yet confirmed on the server (kept across reconciles).
  const pendingIds = useRef(new Set());
  const savingRef = useRef(false);

  // --- Debounced whole-board persist (reads live graph from the ref). ---
  const saveTimer = useRef(null);
  const save = useCallback((immediate = false) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const flush = async () => {
      const g = graphRef.current;
      const board = {
        nodes: g.nodes.map((n) => ({
          id: n.id, type: n.type, x: n.position?.x ?? n.x ?? 0, y: n.position?.y ?? n.y ?? 0,
          prompt: n.prompt || "", settings: n.settings || {},
          currentGenId: n.currentGenId || "", genIds: n.genIds || [],
        })),
        edges: g.edges.map((e) => ({
          id: e.id, source: e.source, sourceHandle: e.sourceHandle,
          target: e.target, targetHandle: e.targetHandle, createdAt: e.createdAt || 0,
        })),
        viewport: null,
      };
      savingRef.current = true;
      try {
        const res = await fetch("/api/visual-world/board", {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
        // Don't clear pendingIds here — a node/edge stays "pending" (and thus kept
        // across a stale reconcile) until a reconcile actually observes it on the
        // server, which avoids a drop race between save-success and the refetch.
        invalidateTabCache("visual-world");
      } catch (e) { setError(String(e.message || e)); }
      finally { savingRef.current = false; }
    };
    if (immediate) return flush();
    saveTimer.current = setTimeout(flush, 600);
  }, []);

  // --- Reconcile server-owned fields (currentGenId/genIds) + agent-added nodes
  // back into the local graph whenever the loader data changes. Local edits win
  // for prompt/settings/position; the server wins for generation bindings. ---
  const serverSig = useMemo(
    () => JSON.stringify(serverBoard.nodes.map((n) => [n.id, n.currentGenId, n.genIds])) +
      "|" + JSON.stringify(serverBoard.edges.map((e) => e.id)),
    [serverBoard],
  );
  useEffect(() => {
    if (savingRef.current) return; // don't stomp an in-flight save's echo
    // Anything the server now knows about is no longer "pending".
    for (const n of serverBoard.nodes) pendingIds.current.delete(n.id);
    for (const e of serverBoard.edges) pendingIds.current.delete(e.id);
    setGraph((local) => {
      const localNodeById = new Map(local.nodes.map((n) => [n.id, n]));
      const serverIds = new Set(serverBoard.nodes.map((n) => n.id));
      const merged = serverBoard.nodes.map((sn) => {
        const ln = localNodeById.get(sn.id);
        if (!ln) return { ...sn }; // new node (agent / Visual tab)
        return { ...ln, currentGenId: sn.currentGenId, genIds: sn.genIds };
      });
      // Keep local-only nodes still pending their first save.
      for (const ln of local.nodes) {
        if (!serverIds.has(ln.id) && pendingIds.current.has(ln.id)) merged.push(ln);
      }
      const mergedIds = new Set(merged.map((n) => n.id));
      const localEdgeById = new Map(local.edges.map((e) => [e.id, e]));
      const serverEdgeIds = new Set(serverBoard.edges.map((e) => e.id));
      const edges = serverBoard.edges.map((se) => localEdgeById.get(se.id) || { ...se });
      for (const le of local.edges) {
        if (!serverEdgeIds.has(le.id) && pendingIds.current.has(le.id)) edges.push(le);
      }
      return {
        nodes: merged,
        edges: edges.filter((e) => mergedIds.has(e.source) && mergedIds.has(e.target)),
      };
    });
  }, [serverSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Polling: while any generation is processing OR a run is active, drive the
  // /poll cycle (which advances the cascade), then refetch to reflect it. ---
  const pollingRef = useRef(false);
  const active = generations.some((g) => g.status === "processing") || !!run?.active;
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try { await fetch("/api/visual-world/poll"); } catch { /* transient */ }
      finally { pollingRef.current = false; }
      if (!stop) refetch();
    };
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [active, refetch]);

  // --- Per-node mutation callbacks. ---
  const patchNode = useCallback((id, patch) => {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    save();
  }, [save]);

  const pickGeneration = useCallback((id, genId) => {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, currentGenId: genId } : n)) }));
    save();
  }, [save]);

  const runNode = useCallback(async (id, mode) => {
    setError(null);
    setOptimisticRun((s) => (s.includes(id) ? s : [...s, id])); // instant feedback
    try {
      const res = await fetch("/api/visual-world/node/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: id, mode }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Run failed");
      refetch(); // pick up board.run + the processing generation
    } catch (e) {
      setError(String(e.message || e));
      setOptimisticRun((s) => s.filter((x) => x !== id)); // failed to start — clear it
    }
  }, [refetch]);

  // Hand off from the optimistic pill to server state: once the refetched run
  // reflects a just-clicked node (nodeStatus != "idle") — or the node is gone —
  // drop it, so there's no idle→running flicker between POST return and refetch.
  useEffect(() => {
    if (!optimisticRun.length) return;
    setOptimisticRun((s) => s.filter((id) => {
      const node = graphRef.current.nodes.find((n) => n.id === id);
      return node ? nodeStatus(run, node) === "idle" : false;
    }));
  }, [run, optimisticRun.length]);

  const statusFor = useCallback(
    (node) => (optimisticRun.includes(node.id) ? "queued" : nodeStatus(run, node)),
    [optimisticRun, run],
  );

  // --- Files panel + per-node stack modal. `filesTarget` rebinds an existing
  // Source node; null adds a new one. `stackNode` browses a generator's history. ---
  const [filesOpen, setFilesOpen] = useState(false);
  const filesTarget = useRef(null);
  const [stackNodeId, setStackNodeId] = useState(null);
  const [expanded, setExpanded] = useState(false); // canvas open in the fullscreen modal

  const openStack = useCallback((node) => {
    if (node.type === "upload") { filesTarget.current = node.id; setFilesOpen(true); }
    else setStackNodeId(node.id);
  }, []);

  // --- Reference slots + inherited text, derived from input edges. ---
  const inputsByNode = useMemo(() => {
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const out = new Map();
    const inEdges = graph.edges.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const e of inEdges) {
      const cur = out.get(e.target) || { refThumbs: [], inheritedText: undefined };
      const src = nodeById.get(e.source);
      const g = src?.currentGenId ? genById.get(src.currentGenId) : null;
      if (e.targetHandle === "text-input") {
        cur.inheritedText = cur.inheritedText || (src ? src.prompt : "");
      } else if ((e.targetHandle === "image-input" || e.targetHandle === "start-frame") && g?.url) {
        cur.refThumbs.push({
          label: e.targetHandle === "start-frame" ? t("Start frame") : t("Image {n}", { n: cur.refThumbs.length + 1 }),
          url: g.url, thumb: g.thumb,
        });
      }
      out.set(e.target, cur);
    }
    return out;
  }, [graph.nodes, graph.edges, genById]);

  // --- React Flow nodes/edges are held as STATE (not derived every render) so
  // React Flow's internal per-node fields — measured size, handle bounds, live
  // drag position — survive re-renders. Losing those breaks handle positioning
  // and, with it, connection dragging. We reconcile the flow `graph` INTO this
  // state (a signature keeps the effect from firing on every render). ---
  const [rfNodes, setRfNodes] = useState([]);
  const [rfEdges, setRfEdges] = useState([]);

  const nodeSig = useMemo(() => JSON.stringify(graph.nodes.map((n) => {
    const g = n.currentGenId ? genById.get(n.currentGenId) : null;
    const inp = inputsByNode.get(n.id);
    return [
      n.id, n.type, n.x, n.y, n.prompt, n.settings, n.currentGenId, n.genIds,
      statusFor(n), g?.status ?? null, g?.url ?? null,
      (inp?.refThumbs || []).map((r) => r.url), inp?.inheritedText ?? null,
      (n.genIds || []).map((gid) => genById.get(gid)?.status).join(","),
    ];
  })), [graph.nodes, genById, inputsByNode, statusFor]);

  useEffect(() => {
    const desired = graph.nodes.map((node) => {
      const generation = node.currentGenId ? genById.get(node.currentGenId) || null : null;
      const nodeGens = (node.genIds || []).map((gid) => genById.get(gid)).filter(Boolean);
      const inp = inputsByNode.get(node.id) || {};
      return {
        id: node.id,
        type: node.type,
        position: { x: node.x ?? 0, y: node.y ?? 0 },
        data: {
          node,
          status: statusFor(node),
          generation,
          generations: nodeGens,
          refThumbs: inp.refThumbs || [],
          inheritedText: inp.inheritedText,
          readOnly: false,
          onPatch: (patch) => patchNode(node.id, patch),
          onRun: (mode) => runNode(node.id, mode),
          onPickGeneration: (genId) => pickGeneration(node.id, genId),
          onOpenStack: () => openStack(node),
        },
      };
    });
    setRfNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return desired.map((d) => {
        const ex = byId.get(d.id);
        // Reuse the existing RF node so measured size / handle bounds survive;
        // never yank position out from under an active drag.
        if (!ex) return d;
        return { ...ex, type: d.type, data: d.data, position: ex.dragging ? ex.position : d.position };
      });
    });
  }, [nodeSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const edgeSig = useMemo(
    () => JSON.stringify(graph.edges.map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle])),
    [graph.edges],
  );
  useEffect(() => {
    setRfEdges((prev) => {
      const sel = new Map(prev.map((e) => [e.id, e.selected]));
      return graph.edges.map((e) => ({
        id: e.id, source: e.source, sourceHandle: e.sourceHandle,
        target: e.target, targetHandle: e.targetHandle, animated: true,
        selected: sel.get(e.id) ?? false,
      }));
    });
  }, [edgeSig]);

  // --- React Flow change handlers. Apply changes to the RF state (so RF owns
  // measurement/drag/selection), then fold structural results back into `graph`
  // and persist. `selected` stays RF-only (never saved). ---
  const onNodesChange = useCallback((changes) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    for (const ch of changes) {
      if (ch.type === "position" && ch.dragging === false && ch.position) {
        const pos = ch.position;
        setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === ch.id ? { ...n, x: pos.x, y: pos.y } : n)) }));
        save();
      } else if (ch.type === "remove") {
        setGraph((g) => ({
          nodes: g.nodes.filter((n) => n.id !== ch.id),
          edges: g.edges.filter((e) => e.source !== ch.id && e.target !== ch.id),
        }));
        save(true);
      }
    }
  }, [save]);

  const onEdgesChange = useCallback((changes) => {
    setRfEdges((eds) => applyEdgeChanges(changes, eds));
    for (const ch of changes) {
      if (ch.type === "remove") {
        setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== ch.id) }));
        save(true);
      }
    }
  }, [save]);

  const isValidConnection = useCallback((c) => {
    const allowed = FLOW_CONNECT_RULES[c.sourceHandle];
    if (!allowed || !allowed.includes(c.targetHandle)) return false;
    if (c.source === c.target) return false;
    if (ONE_TO_ONE_TARGETS.has(c.targetHandle)) {
      if (graphRef.current.edges.some((e) => e.target === c.target && e.targetHandle === c.targetHandle)) return false;
    }
    return true;
  }, []);

  const onConnect = useCallback((c) => {
    if (!isValidConnection(c)) return;
    const edge = {
      id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle,
      createdAt: Date.now(),
    };
    pendingIds.current.add(edge.id);
    setGraph((g) => ({ ...g, edges: addEdge(edge, g.edges) }));
    save(true);
  }, [isValidConnection, save]);

  // --- Add-node menu (pane right-click + drag-edge-to-empty-canvas). ---
  const menuScreen = useRef(null);
  const pendingConnect = useRef(null);
  const [menuTypes, setMenuTypes] = useState(undefined);
  const connectStart = useRef(null);
  const synthMenu = useRef(false);

  const addNodeAt = useCallback((type, screen) => {
    const position = screenToFlowPosition(screen);
    const node = { ...freshNode(type, position, defaultPresetId) };
    node.x = position.x; node.y = position.y;
    pendingIds.current.add(node.id);
    const pending = pendingConnect.current;
    pendingConnect.current = null;
    setGraph((g) => {
      const edges = [...g.edges];
      if (pending) {
        const th = pickTargetHandle(type, FLOW_CONNECT_RULES[pending.handle] || []);
        if (th) {
          const eid = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
          pendingIds.current.add(eid);
          edges.push({ id: eid, source: pending.nodeId, sourceHandle: pending.handle, target: node.id, targetHandle: th, createdAt: Date.now() + 1 });
        }
      }
      return { nodes: [...g.nodes, node], edges };
    });
    save(true);
  }, [screenToFlowPosition, defaultPresetId, save]);

  const onPaneContextMenu = useCallback((event) => {
    if (synthMenu.current) { synthMenu.current = false; return; }
    menuScreen.current = { x: event.clientX, y: event.clientY };
    pendingConnect.current = null;
    setMenuTypes(undefined);
  }, []);

  const onNodeContextMenu = useCallback((event) => { event.preventDefault(); event.stopPropagation(); }, []);

  const onConnectStart = useCallback((_, params) => {
    connectStart.current = (params.handleType === "source" && params.nodeId && params.handleId)
      ? { nodeId: params.nodeId, handle: params.handleId } : null;
  }, []);

  const onConnectEnd = useCallback((event) => {
    const start = connectStart.current;
    connectStart.current = null;
    if (!start) return;
    const target = event.target;
    if (!target?.classList?.contains("react-flow__pane")) return;
    const allowed = allowedTypesForSourceHandle(start.handle);
    if (allowed.length === 0) return;
    const point = "clientX" in event
      ? { x: event.clientX, y: event.clientY }
      : { x: event.changedTouches?.[0]?.clientX ?? 0, y: event.changedTouches?.[0]?.clientY ?? 0 };
    menuScreen.current = point;
    pendingConnect.current = start;
    setMenuTypes(allowed);
    synthMenu.current = true;
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: point.x, clientY: point.y }));
  }, []);

  // --- Files panel pick: rebind a Source node, or drop a new one at center. ---
  const onPickFile = useCallback((genId) => {
    setFilesOpen(false);
    if (filesTarget.current) {
      const id = filesTarget.current; filesTarget.current = null;
      setGraph((gr) => ({ ...gr, nodes: gr.nodes.map((n) => (n.id === id ? { ...n, currentGenId: genId, genIds: n.genIds.includes(genId) ? n.genIds : [...n.genIds, genId] } : n)) }));
    } else {
      const node = { ...freshNode("upload", { x: 0, y: 0 }, "") };
      const center = screenToFlowPosition({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 120 });
      node.x = center.x; node.y = center.y;
      node.currentGenId = genId; node.genIds = [genId];
      pendingIds.current.add(node.id);
      setGraph((gr) => ({ ...gr, nodes: [...gr.nodes, node] }));
    }
    save(true);
  }, [screenToFlowPosition, save]);

  const stackNode = stackNodeId ? graph.nodes.find((n) => n.id === stackNodeId) : null;
  const stackGens = stackNode ? (stackNode.genIds || []).map((gid) => genById.get(gid)).filter(Boolean) : [];
  const isEmpty = graph.nodes.length === 0;

  // The canvas itself — rendered in exactly one place at a time (inline or in the
  // fullscreen modal), since two <ReactFlow> instances can't share one provider.
  const canvas = (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-full w-full">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onPaneContextMenu={onPaneContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.5}
            panOnScroll
            proOptions={{ hideAttribution: true }}
            className="bg-muted/30"
          >
            <Background gap={20} size={1.6} className="!bg-transparent" />
            <Controls />
            <MiniMap pannable zoomable className="!bg-card" />
            {isEmpty && (
              <FlowPanel position="top-center" className="pointer-events-none mt-16 text-center">
                <div className="pointer-events-auto rounded-none border border-dashed bg-card/90 p-6 backdrop-blur">
                  <Sparkles size={20} className="mx-auto mb-2 text-primary" />
                  <Empty>{t("right-click the canvas to add an Image, Video, Text or Source node — then wire them up and Run.")}</Empty>
                </div>
              </FlowPanel>
            )}
          </ReactFlow>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <AddNodeMenu
          allowedTypes={menuTypes}
          onAdd={(type) => addNodeAt(type, menuScreen.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 })}
        />
      </ContextMenuContent>
    </ContextMenu>
  );

  return (
    <FlowMetaProvider value={meta}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t("Visual nodes")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("Build a generation graph — wire images and prompts into nodes, then Run to generate images and video along the lineage.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {run?.active && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                <Loader2 size={12} className="animate-spin" /> {t("running {done}/{total}", { done: run.ready.length + run.errored.length, total: run.runSet.length })}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => { filesTarget.current = null; setFilesOpen(true); }}>
              <FolderOpen size={14} /> {t("Files")}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("Expand canvas to fullscreen")}
              onClick={() => setExpanded(true)}
            >
              <Expand size={15} />
            </Button>
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="h-[74vh] overflow-hidden rounded-none border bg-card">
          {expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex h-full w-full items-center justify-center text-muted-foreground"
            >
              <Empty>{t("Canvas open in fullscreen — close it to edit here.")}</Empty>
            </button>
          ) : (
            canvas
          )}
        </div>

        <FilesPanel
          open={filesOpen}
          onClose={() => { setFilesOpen(false); filesTarget.current = null; }}
          generations={generations}
          onPick={onPickFile}
          title={filesTarget.current ? t("Pick a source") : t("Files")}
        />
        <GenerationStackModal
          open={!!stackNodeId}
          onClose={() => setStackNodeId(null)}
          generations={stackGens}
          currentGenId={stackNode?.currentGenId || null}
          onSelect={(genId) => { if (stackNodeId) pickGeneration(stackNodeId, genId); }}
        />

        {/* Fullscreen canvas — near-full viewport so the graph gets all the room. */}
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="flex h-[96vh] w-[97vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
            <DialogTitle className="sr-only">{t("Visual nodes canvas")}</DialogTitle>
            <div className="min-h-0 flex-1">
              {expanded ? canvas : null}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </FlowMetaProvider>
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
