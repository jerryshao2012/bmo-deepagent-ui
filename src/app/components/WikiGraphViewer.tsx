"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";

// ── Types ────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  title: string;
  category: string;
  tags: string[];
  community_id: number | null;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: { id: number; cohesion: number; size: number }[];
  total_pages: number;
  total_links: number;
}

interface SimNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  data: GraphNode;
}

// ── Category colors ──────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  entity: "#4ade80",
  concept: "#60a5fa",
  source: "#f59e0b",
  comparison: "#a78bfa",
  synthesis: "#f472b6",
  query: "#34d399",
  uncategorized: "#9ca3af",
};

const COMMUNITY_PALETTE = [
  "#4ade80", "#60a5fa", "#f59e0b", "#a78bfa", "#f472b6",
  "#34d399", "#fb923c", "#38bdf8", "#f87171", "#a3e635",
];

function nodeColor(node: GraphNode): string {
  if (node.community_id != null) {
    return COMMUNITY_PALETTE[node.community_id % COMMUNITY_PALETTE.length];
  }
  return CATEGORY_COLORS[node.category] ?? CATEGORY_COLORS.uncategorized;
}

// ── Force simulation ─────────────────────────────────────────────────────────

function tick(nodes: SimNode[], edges: GraphEdge[], width: number, height: number, alpha: number) {
  const alphaDecay = 0.98;
  const alphaTarget = 0.001;
  const repel = 600;
  const attract = 0.005;
  const centerForce = 0.01;
  const maxVel = 5;

  // Repel all pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = repel / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      nodes[i].vx -= fx;
      nodes[i].vy -= fy;
      nodes[j].vx += fx;
      nodes[j].vy += fy;
    }
  }

  // Attract along edges
  for (const edge of edges) {
    const s = nodes.find((n) => n.data.id === edge.source);
    const t = nodes.find((n) => n.data.id === edge.target);
    if (!s || !t) continue;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const force = dist * attract;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    s.vx += fx;
    s.vy += fy;
    t.vx -= fx;
    t.vy -= fy;
  }

  // Center gravity
  const cx = width / 2;
  const cy = height / 2;
  for (const n of nodes) {
    n.vx += (cx - n.x) * centerForce;
    n.vy += (cy - n.y) * centerForce;
  }

  // Apply velocity with damping
  for (const n of nodes) {
    n.vx *= alphaDecay;
    n.vy *= alphaDecay;
    if (Math.abs(n.vx) > maxVel) n.vx = Math.sign(n.vx) * maxVel;
    if (Math.abs(n.vy) > maxVel) n.vy = Math.sign(n.vy) * maxVel;
    n.x += n.vx;
    n.y += n.vy;
    n.x = Math.max(30, Math.min(width - 30, n.x));
    n.y = Math.max(30, Math.min(height - 30, n.y));
  }

  return alpha > alphaTarget;
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  threadId: string;
}

export default function WikiGraphViewer({ threadId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimNode[] | null>(null);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const dragRef = useRef<{ node: SimNode; ox: number; oy: number } | null>(null);

  // Fetch graph data
  useEffect(() => {
    if (!threadId) return;
    let active = true;
    const appConfig = getConfig();
    const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
    const token = getBrowserSessionToken();

    setLoading(true);
    setError(null);
    setData(null);
    fetch(`${deploymentUrl}/threads/${threadId}/wiki/graph`, {
      headers: token ? { "X-API-Key": token } : {},
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as any)?.detail ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((g: GraphData) => {
        if (!active) return;
        setData(g);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      active = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [threadId]);

  // Kick off simulation after data is set and canvas is in the DOM.
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    // Small delay to ensure layout is complete.
    const timer = setTimeout(() => initSimulation(data), 50);
    return () => clearTimeout(timer);
  }, [data]);

  // Init force simulation
  const initSimulation = useCallback((g: GraphData) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const nodes: SimNode[] = g.nodes.map((n) => ({
      x: rect.width / 2 + (Math.random() - 0.5) * 200,
      y: rect.height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
      data: n,
    }));
    simRef.current = nodes;
    edgesRef.current = g.edges;

    const run = () => {
      const active = tick(nodes, g.edges, rect.width, rect.height, 0.5);
      draw(canvas, nodes, g.edges, dpr);
      if (active) {
        animRef.current = requestAnimationFrame(run);
      }
    };
    if (animRef.current) cancelAnimationFrame(animRef.current);
    run();
  }, []);

  // Resize handler
  useEffect(() => {
    const onResize = () => {
      if (data) initSimulation(data);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [data, initSimulation]);

  // Mouse handlers
  const getMousePos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = getMousePos(e);
      const nodes = simRef.current;
      if (!nodes) return;

      // Drag
      if (dragRef.current) {
        dragRef.current.node.x = pos.x;
        dragRef.current.node.y = pos.y;
        dragRef.current.node.vx = 0;
        dragRef.current.node.vy = 0;
        const canvas = canvasRef.current;
        if (canvas) draw(canvas, nodes, edgesRef.current, window.devicePixelRatio || 1);
        return;
      }

      // Hover
      let found: GraphNode | null = null;
      for (const n of nodes) {
        const dx = n.x - pos.x;
        const dy = n.y - pos.y;
        if (Math.sqrt(dx * dx + dy * dy) < 12) {
          found = n.data;
          break;
        }
      }
      setHoveredNode(found);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = found ? "pointer" : "grab";
      }
    },
    [getMousePos]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = getMousePos(e);
      const nodes = simRef.current;
      if (!nodes) return;
      for (const n of nodes) {
        const dx = n.x - pos.x;
        const dy = n.y - pos.y;
        if (Math.sqrt(dx * dx + dy * dy) < 12) {
          dragRef.current = { node: n, ox: n.x - pos.x, oy: n.y - pos.y };
          n.vx = 0;
          n.vy = 0;
          return;
        }
      }
    },
    [getMousePos]
  );

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
          Loading graph...
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 text-sm">
          <span className="text-red-500">Failed to load graph</span>
          <span className="text-xs text-muted-foreground">{error}</span>
        </div>
      )}
      {/* Tooltip */}
      {hoveredNode && (
        <div
          className="absolute z-10 pointer-events-none bg-popover border border-border rounded-md shadow-md px-2.5 py-1.5 text-xs max-w-[220px]"
          style={{
            left: (() => {
              const n = simRef.current?.find((s) => s.data.id === hoveredNode.id);
              return n ? Math.min(n.x + 14, 200) : 0;
            })(),
            top: (() => {
              const n = simRef.current?.find((s) => s.data.id === hoveredNode.id);
              return n ? Math.max(n.y - 10, 10) : 0;
            })(),
          }}
        >
          <p className="font-semibold truncate">{hoveredNode.title}</p>
          <p className="text-muted-foreground">{hoveredNode.category}</p>
          {hoveredNode.tags.length > 0 && (
            <p className="text-muted-foreground truncate">
              {hoveredNode.tags.slice(0, 3).join(", ")}
            </p>
          )}
        </div>
      )}
      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5 text-[10px]">
        {data?.communities.slice(0, 6).map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-background/80 backdrop-blur"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor:
                  COMMUNITY_PALETTE[c.id % COMMUNITY_PALETTE.length],
              }}
            />
            community {c.id}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Canvas drawing ───────────────────────────────────────────────────────────

function draw(
  canvas: HTMLCanvasElement,
  nodes: SimNode[],
  edges: GraphEdge[],
  dpr: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Edges
  ctx.strokeStyle = "rgba(156,163,175,0.3)";
  ctx.lineWidth = 1;
  for (const edge of edges) {
    const s = nodes.find((n) => n.data.id === edge.source);
    const t = nodes.find((n) => n.data.id === edge.target);
    if (!s || !t) continue;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
  }

  // Nodes
  for (const n of nodes) {
    const r = 6 + Math.min(n.data.tags.length, 4) * 1.5;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = nodeColor(n.data);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Labels — show for all nodes, truncated
  ctx.font = "9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#9ca3af";
  for (const n of nodes) {
    const label = n.data.title.length > 18
      ? n.data.title.slice(0, 16) + "…"
      : n.data.title;
    ctx.fillText(label, n.x, n.y + 16 + (n.data.tags.length * 1.5));
  }

  ctx.restore();
}
