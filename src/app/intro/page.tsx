"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const dynamic = "force-dynamic";
import { useSearchParams } from "next/navigation";
import { 
  Shield, 
  Cpu, 
  Layers, 
  Activity, 
  Terminal, 
  Search, 
  ChevronRight, 
  ArrowRight, 
  Zap, 
  Play, 
  CheckCircle,
  FileText,
  AlertTriangle,
  FolderTree,
  Lock,
  ArrowUpRight,
  MessageSquare,
  Trash2,
  ClipboardPaste,
  Copy,
  Check,
  X
} from "lucide-react";

function IntroPageContent() {
  const searchParams = useSearchParams();
  const [threadId, setThreadId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<number>(0);
  const [scrollY, setScrollY] = useState(0);
  const [visibleSections, setVisibleSections] = useState<Record<string, boolean>>({
    hero: true,
    chip: true,
    tandem: true,
    sandbox: true,
    accessories: true,
    specs: true,
    cta: true,
  });
  
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<"connected" | "disconnected" | "connecting">("disconnected");
  const [sharedText, setSharedText] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [isTelemetryFullscreen, setIsTelemetryFullscreen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedHtml, setCopiedHtml] = useState<boolean>(false);
  const [activeTelemetryTab, setActiveTelemetryTab] = useState<string>("edit");
  const previewRef = useRef<HTMLDivElement>(null);

  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Prevent background body scroll when the telemetry dialog is open
  useEffect(() => {
    if (isDialogOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setIsTelemetryFullscreen(false);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isDialogOpen]);

  const connectWS = useCallback(() => {
    if (!threadId) return;
    
    // If socket is already open or currently connecting, skip
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setWsStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws?threadId=${threadId}`;

    console.log("Attempting WebSocket connection for thread:", threadId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected for thread:", threadId);
      setSocket(ws);
      setWsStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "sync") {
          setSharedText(data.content);
        }
      } catch (err) {
        console.error("WS error parsing message:", err);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
      setSocket(null);
      setWsStatus("disconnected");
      wsRef.current = null;

      // Automatically try to reconnect after 5 seconds
      if (!reconnectTimeoutRef.current) {
        console.log("Scheduling automatic WebSocket reconnect in 5 seconds...");
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectWS();
        }, 5000);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }, [threadId]);

  // Main connection management effect
  useEffect(() => {
    connectWS();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setSocket(null);
      setWsStatus("disconnected");
    };
  }, [threadId, connectWS]);

  // Trigger immediate reconnect when the telemetry dialog is opened if it's currently disconnected
  useEffect(() => {
    if (isDialogOpen && wsStatus === "disconnected") {
      console.log("Telemetry dialog opened while disconnected. Triggering instant reconnect...");
      connectWS();
    }
  }, [isDialogOpen, wsStatus, connectWS]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setSharedText(val);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "update", content: val }));
    }
  };

  const handleClear = () => {
    setSharedText("");
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "update", content: "" }));
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setSharedText(text);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "update", content: text }));
      }
    } catch (err) {
      console.error("Failed to read from clipboard:", err);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sharedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  const handleCopyHtml = async () => {
    try {
      if (previewRef.current) {
        await navigator.clipboard.writeText(previewRef.current.innerHTML);
        setCopiedHtml(true);
        setTimeout(() => setCopiedHtml(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy HTML to clipboard:", err);
    }
  };
  
  

  // Ref elements for interactive 3D mouse parallax
  const stackRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  // Generate 6-digit Thread ID if not present in query params
  useEffect(() => {
    const tid = searchParams.get("thread_id");
    if (tid && /^\d{6}$/.test(tid)) {
      setThreadId(tid);
    } else {
      const generatedId = String(Math.floor(100000 + Math.random() * 900000));
      setThreadId(generatedId);
      
      // Update URL search parameters without reloading
      const url = new URL(window.location.href);
      url.searchParams.set("thread_id", generatedId);
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  // Track scroll state for animations
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Intersection observer for Apple-style fade-in-on-scroll
  useEffect(() => {
    // Run observer binding in a short timeout to guarantee Next.js DOM has settled
    const timer = setTimeout(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setVisibleSections((prev) => ({ ...prev, [entry.target.id]: true }));
            }
          });
        },
        { threshold: 0.15 }
      );

      const sectionIds = ["hero", "chip", "tandem", "sandbox", "accessories", "specs", "cta"];
      sectionIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          observer.observe(el);
          
          // Viewport boundary check: if it is already in view on load, show immediately
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            setVisibleSections((prev) => ({ ...prev, [id]: true }));
          }
        }
      });

      return () => observer.disconnect();
    }, 150);

    return () => clearTimeout(timer);
  }, []);

  // Handle mouse move for interactive card 3D tilt
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stackRef.current) return;
    const rect = stackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    
    // Normalize and scale tilt factors
    const tiltX = (y / (rect.height / 2)) * -12; // tilt angle degrees
    const tiltY = (x / (rect.width / 2)) * 12;
    setTilt({ x: tiltX, y: tiltY });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#000000] font-sans text-[#f5f5f7]">
      
      {/* Styles for scroll effects, custom gradients, and 3D card perspectives */}
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap');
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: #000;
        }

        .font-outfit {
          font-family: 'Outfit', sans-serif;
        }
        
        .font-mono {
          font-family: 'JetBrains Mono', monospace;
        }

        /* Apple-style smooth scroll transitions */
        .apple-fade {
          opacity: 0;
          transform: translateY(40px);
          transition: opacity 1.2s cubic-bezier(0.15, 1, 0.3, 1), 
                      transform 1.2s cubic-bezier(0.15, 1, 0.3, 1);
        }

        .apple-fade.visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* Custom Telemetry Tooltips */
        .tooltip-wrapper {
          position: relative;
          display: inline-block;
        }
        .tooltip-box {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%) translateY(4px);
          margin-bottom: 8px;
          visibility: hidden;
          opacity: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: none;
          z-index: 200;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .tooltip-wrapper:hover .tooltip-box {
          visibility: visible;
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        /* Ambient colored background lights */
        .blur-orb-indigo {
          background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0) 70%);
        }

        .blur-orb-teal {
          background: radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, rgba(6, 182, 212, 0) 70%);
        }

        .blur-orb-purple {
          background: radial-gradient(circle, rgba(168, 85, 247, 0.12) 0%, rgba(168, 85, 247, 0) 70%);
        }

        /* CPU trace animation */
        @keyframes traceFlow {
          0% { stroke-dashoffset: 200; }
          100% { stroke-dashoffset: 0; }
        }

        .animate-trace {
          stroke-dasharray: 40 160;
          animation: traceFlow 4s linear infinite;
        }

        /* Interactive Tandem Loop Animation */
        @keyframes pulseConcentric {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.05); opacity: 0.9; }
        }

        .animate-concentric {
          animation: pulseConcentric 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        /* Perspective stack details */
        .glass-layer {
          transition: transform 0.2s cubic-bezier(0.25, 1, 0.5, 1), border-color 0.3s;
        }
      ` }} />

      {/* Navigation - Apple Header Style */}
      <header 
        className={`fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between border-b px-6 transition-all duration-300 ${
          scrollY > 50 
            ? "border-white/10 bg-black/85 backdrop-blur-md" 
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="flex items-center gap-6">
          <a href="#" className="flex items-center gap-2 text-white hover:opacity-85 transition">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" className="text-white">
              <path d="M16 2L2 9L16 16L30 9L16 2Z" fill="currentColor" />
              <path d="M2 16L16 23L30 16" stroke="currentColor" strokeWidth="2" />
              <path d="M2 23L16 30L30 23" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span className="font-outfit text-sm font-semibold tracking-tight uppercase">Harness</span>
          </a>
          <span className="hidden h-4 w-px bg-white/20 sm:block" />
          <span className="hidden font-outfit text-xs text-white/50 tracking-wider uppercase sm:block">Introduction</span>
        </div>

        <nav className="hidden items-center gap-8 text-xs font-normal text-[#e8e8ed] md:flex">
          <a href="#hero" className="hover:text-white transition">Overview</a>
          <a href="#chip" className="hover:text-white transition">HE-1 Processor</a>
          <a href="#tandem" className="hover:text-white transition">Tandem Loops</a>
          <a href="#sandbox" className="hover:text-white transition">Isolation</a>
          <a href="#specs" className="hover:text-white transition">Technical Specifications</a>
        </nav>

        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-white/40 select-none">
            <span 
              onClick={() => setIsDialogOpen(true)}
              className="cursor-pointer"
              title="Click to open Markdown Online Preview"
            >
              T
            </span>
            hread: #{threadId}
          </span>
          <a 
            href={`/chat?threadId=${threadId}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0071e3] text-white hover:bg-[#147fe5] transition shadow-md shadow-blue-500/20"
            title="Launch Chat"
          >
            <MessageSquare className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* Floating background lights */}
      <div className="absolute top-[10%] left-[20%] h-[600px] w-[600px] blur-orb-indigo rounded-full pointer-events-none" />
      <div className="absolute top-[40%] right-[10%] h-[500px] w-[500px] blur-orb-teal rounded-full pointer-events-none" />
      <div className="absolute bottom-[20%] left-[10%] h-[600px] w-[600px] blur-orb-purple rounded-full pointer-events-none" />

      {/* 1. HERO SECTION (Apple "Thinpossible" style) */}
      <section 
        id="hero" 
        className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-24 text-center"
      >
        <div className={`apple-fade max-w-4xl ${visibleSections["hero"] ? "visible" : ""}`}>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/5 px-4 py-1 text-xs font-medium tracking-wide text-indigo-400 font-mono mb-6 backdrop-blur-md">
            <Zap className="h-3 w-3 animate-pulse" />
            AGENT = MODEL + HARNESS
          </div>
          
          <h1 className="font-outfit text-5xl font-extrabold tracking-tight text-white sm:text-7xl md:text-8xl">
            Harness Engineering.
          </h1>
          
          <p className="font-outfit mt-6 text-2xl font-bold tracking-tight text-[#86868b] sm:text-3xl md:text-4xl">
            Stateless intelligence meets structural execution. <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Defensive. Isolated. Absolute control.
            </span>
          </p>

          <p className="mx-auto mt-6 max-w-2xl text-base text-[#86868b] sm:text-lg leading-relaxed">
            Applying Sutton's <em>Bitter Lesson</em> to agent architecture. While core model prompts represent probabilistic suggestions, the harness establishes the deterministic governance plane.
          </p>

          {/* Interactive Layered 3D Stack Visualization */}
          <div className="mt-16 flex justify-center">
            <div 
              ref={stackRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              className="relative cursor-pointer py-12 px-6"
              style={{ perspective: "1000px" }}
            >
              <div 
                className="relative flex flex-col items-center gap-6 transition-all duration-300 ease-out"
                style={{ 
                  transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                  transformStyle: "preserve-3d"
                }}
              >
                {/* 3D Glass Layer 1: Orchestration */}
                <div 
                  className="glass-layer flex h-20 w-80 sm:w-96 items-center justify-between rounded-2xl border border-indigo-400/40 bg-indigo-950/20 px-6 backdrop-blur-lg shadow-2xl transition hover:border-indigo-400"
                  style={{ transform: "translateZ(60px)", boxShadow: "0 20px 40px rgba(99, 102, 241, 0.15)" }}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                      <Layers className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <h4 className="font-outfit font-bold text-sm tracking-tight text-white">1. Orchestration Layer</h4>
                      <p className="text-[10px] text-indigo-400/80 font-mono">PLAN-ACT-VERIFY MACHINE</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-white/30" />
                </div>

                {/* 3D Glass Layer 2: Context Engineering */}
                <div 
                  className="glass-layer flex h-20 w-80 sm:w-96 items-center justify-between rounded-2xl border border-purple-400/30 bg-purple-950/20 px-6 backdrop-blur-lg shadow-xl transition hover:border-purple-400"
                  style={{ transform: "translateZ(30px)", boxShadow: "0 15px 30px rgba(168, 85, 247, 0.1)" }}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <h4 className="font-outfit font-bold text-sm tracking-tight text-white">2. Context Engineering</h4>
                      <p className="text-[10px] text-purple-400/80 font-mono">DYNAMIC RE-RANKING & PRUNING</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-white/30" />
                </div>

                {/* 3D Glass Layer 3: Sandbox Environment */}
                <div 
                  className="glass-layer flex h-20 w-80 sm:w-96 items-center justify-between rounded-2xl border border-cyan-400/30 bg-cyan-950/20 px-6 backdrop-blur-lg shadow-lg transition hover:border-cyan-400"
                  style={{ transform: "translateZ(0px)", boxShadow: "0 10px 20px rgba(6, 182, 212, 0.1)" }}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <h4 className="font-outfit font-bold text-sm tracking-tight text-white">3. Isolated Sandbox</h4>
                      <p className="text-[10px] text-cyan-400/80 font-mono">DOCKER CONTAINER BOUNDS</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-white/30" />
                </div>

              </div>
            </div>
          </div>
          
          <div className="mt-8 text-xs text-[#86868b] font-mono tracking-wider">
            💡 PERSPECTIVE GRID: DRAG OR MOVE CURSOR OVER STACK
          </div>
        </div>
      </section>

      {/* 2. THE CHIP SECTION (Apple's M4 Chip style) */}
      <section 
        id="chip" 
        className="relative flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center bg-[#050505]"
      >
        <div className={`apple-fade max-w-4xl ${visibleSections["chip"] ? "visible" : ""}`}>
          <h2 className="font-outfit text-xs font-bold tracking-widest text-[#86868b] uppercase mb-4">
            System Engine
          </h2>
          
          <h3 className="font-outfit text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Introducing HE-1. <br />
            <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
              The engine of autonomous policy.
            </span>
          </h3>

          <p className="mx-auto mt-6 max-w-2xl text-base text-[#86868b] sm:text-lg">
            Harness Engine 1 (HE-1) isn't a models weights file. It's the structural compiler written in Rust & TypeScript that manages system tools, schedules execution steps, and validates model output loops.
          </p>

          {/* Glowing Processor Graphic inside HTML/SVG */}
          <div className="relative mt-16 flex justify-center">
            <div className="relative h-64 w-64 rounded-3xl border border-white/5 bg-neutral-900/60 p-6 backdrop-blur-md shadow-[0_0_80px_rgba(245,158,11,0.05)]">
              {/* Golden circular circuitry animations */}
              <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 256 256">
                {/* Circuit lines */}
                <path d="M40 40h60v30h56v-30h60" stroke="rgba(245,158,11,0.15)" strokeWidth="1.5" fill="none" />
                <path d="M40 216h60v-30h56v30h60" stroke="rgba(245,158,11,0.15)" strokeWidth="1.5" fill="none" />
                <path d="M40 128h40v40h96v-40h40" stroke="rgba(245,158,11,0.15)" strokeWidth="1.5" fill="none" />
                
                {/* Flow particles */}
                <path d="M40 40h60v30h56v-30h60" stroke="#f59e0b" strokeWidth="1.5" fill="none" className="animate-trace opacity-80" />
                <path d="M40 216h60v-30h56v30h60" stroke="#f59e0b" strokeWidth="1.5" fill="none" className="animate-trace opacity-80" style={{ animationDelay: "1.5s" }} />
              </svg>

              {/* Core Processor visual */}
              <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/5 to-amber-600/10 shadow-[inset_0_0_30px_rgba(245,158,11,0.1)]">
                <Cpu className="h-16 w-16 text-amber-500 animate-pulse" />
                <span className="font-outfit text-xl font-black text-amber-400 tracking-tighter mt-4 font-mono">HE-1</span>
                <span className="font-mono text-[9px] text-amber-500/60 mt-1 uppercase tracking-wider">Harness Engine Core</span>
              </div>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 text-left sm:grid-cols-3 max-w-3xl mx-auto">
            <div className="border-t border-white/10 pt-4">
              <h4 className="text-white font-semibold font-outfit text-sm">Deterministic Policy</h4>
              <p className="text-xs text-[#86868b] mt-2 leading-relaxed">Converts vague model intents into zero-defect execution statements.</p>
            </div>
            <div className="border-t border-white/10 pt-4">
              <h4 className="text-white font-semibold font-outfit text-sm">MCP Dynamic Contracts</h4>
              <p className="text-xs text-[#86868b] mt-2 leading-relaxed">Standardizes and strictly validates external tool interfaces.</p>
            </div>
            <div className="border-t border-white/10 pt-4">
              <h4 className="text-white font-semibold font-outfit text-sm">Runaway Budgeting</h4>
              <p className="text-xs text-[#86868b] mt-2 leading-relaxed">Cuts off loop iteration spend to protect execution costs dynamically.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. TANDEM LOOP ARCHITECTURE (Apple's Tandem OLED style) */}
      <section 
        id="tandem" 
        className="relative flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center bg-[#000]"
      >
        <div className={`apple-fade max-w-5xl ${visibleSections["tandem"] ? "visible" : ""}`}>
          <h2 className="font-outfit text-xs font-bold tracking-widest text-[#86868b] uppercase mb-4">
            Double-Loop Verification
          </h2>
          
          <h3 className="font-outfit text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Tandem Verification. <br />
            <span className="bg-gradient-to-r from-purple-400 to-indigo-500 bg-clip-text text-transparent">
              Two loops work together for absolute reliability.
            </span>
          </h3>

          <p className="mx-auto mt-6 max-w-2xl text-base text-[#86868b] sm:text-lg">
            Like standard displays split bright pixels across dual OLED arrays, Harness Engineering coordinates two asynchronous validation systems in tandem to isolate faults instantly.
          </p>

          {/* Concentric Tandem Loop visual representation */}
          <div className="relative mt-16 flex flex-col items-center justify-center md:flex-row gap-12">
            
            {/* Outer Loop */}
            <div className="relative flex h-60 w-60 flex-col items-center justify-center rounded-full border border-purple-500/20 bg-purple-500/5 p-6 shadow-[inset_0_0_20px_rgba(168,85,247,0.05)]">
              <div className="absolute inset-0 rounded-full border border-dashed border-purple-500/30 animate-concentric" />
              <Activity className="h-10 w-10 text-purple-400" />
              <h4 className="font-outfit font-bold text-base text-white mt-4">1. Planning Loop</h4>
              <p className="text-[10px] text-purple-400 font-mono mt-1">PLAN-ACT-VERIFY</p>
              <p className="text-[10px] text-[#86868b] text-center mt-2 font-sans px-2">Decides strategy, writes checklists, cross-references files.</p>
            </div>

            <div className="hidden h-px w-20 bg-gradient-to-r from-purple-500/40 to-indigo-500/40 md:block" />

            {/* Inner Loop */}
            <div className="relative flex h-60 w-60 flex-col items-center justify-center rounded-full border border-indigo-500/20 bg-indigo-500/5 p-6 shadow-[inset_0_0_20px_rgba(99,102,241,0.05)]">
              <div className="absolute inset-0 rounded-full border border-dashed border-indigo-500/30 animate-concentric" style={{ animationDelay: "1.5s" }} />
              <Terminal className="h-10 w-10 text-indigo-400" />
              <h4 className="font-outfit font-bold text-base text-white mt-4">2. Execution Loop</h4>
              <p className="text-[10px] text-indigo-400 font-mono mt-1">WRITE-RUN-INSPECT-FIX</p>
              <p className="text-[10px] text-[#86868b] text-center mt-2 font-sans px-2">Executes scripts, audits linting errors, compiles environment code.</p>
            </div>

          </div>
        </div>
      </section>

      {/* 4. SANDBOX CONFINEMENT (Apple iPad thinness style) */}
      <section 
        id="sandbox" 
        className="relative flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center bg-[#050505]"
      >
        <div className={`apple-fade max-w-4xl ${visibleSections["sandbox"] ? "visible" : ""}`}>
          <h2 className="font-outfit text-xs font-bold tracking-widest text-[#86868b] uppercase mb-4">
            Security Isolation
          </h2>
          
          <h3 className="font-outfit text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Thinnest boundaries. <br />
            <span className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
              Absolute containment.
            </span>
          </h3>

          <p className="mx-auto mt-6 max-w-2xl text-base text-[#86868b] sm:text-lg">
            An autonomous agent should never run raw code directly on a bare host. The HE-1 harness seals agent logic behind an isolated container limit.
          </p>

          {/* Interactive Confinement Visualizer */}
          <div className="relative mt-16 flex flex-col md:flex-row items-stretch justify-center gap-px bg-white/5 rounded-3xl overflow-hidden border border-white/10 max-w-3xl mx-auto">
            
            {/* Safe Agent Sandbox Panel */}
            <div className="flex-1 p-8 bg-neutral-950/80 flex flex-col justify-between text-left">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold text-cyan-400 font-mono uppercase tracking-wider">CONTAINED</span>
                <h4 className="font-outfit text-xl font-bold text-white mt-4">Isolated Sandbox</h4>
                <p className="text-xs text-[#86868b] mt-2 leading-relaxed">
                  Agents execute command scripts inside Docker containers, WASM boxes, or isolated `uv venv` shells. Host filesystem is completely invisible.
                </p>
              </div>
              <ul className="mt-8 flex flex-col gap-2 font-mono text-[10px] text-cyan-400">
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3" /> Root filesystem isolated</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3" /> Restricted process limits</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3" /> Capped execution timeouts</li>
              </ul>
            </div>

            {/* Glowing Divider Line (iPad 5.1mm style) */}
            <div className="relative w-full h-1 md:w-1 md:h-auto bg-[#0071e3]/40 flex items-center justify-center">
              <div className="absolute w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_12px_#2dd4bf] animate-ping" />
            </div>

            {/* Unsecure Host Panel */}
            <div className="flex-1 p-8 bg-neutral-900/60 flex flex-col justify-between text-left">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded bg-rose-500/10 px-2 py-0.5 text-[9px] font-bold text-rose-400 font-mono uppercase tracking-wider">PROTECTED</span>
                <h4 className="font-outfit text-xl font-bold text-white mt-4">Company Host System</h4>
                <p className="text-xs text-[#86868b] mt-2 leading-relaxed">
                  Raw servers, credentials, enterprise files, and operational databases sit securely outside the sandbox boundary. Immune to runaway scripts.
                </p>
              </div>
              <ul className="mt-8 flex flex-col gap-2 font-mono text-[10px] text-[#86868b]">
                <li className="flex items-center gap-2"><Lock className="h-3 w-3 text-white/20" /> Host terminal locked</li>
                <li className="flex items-center gap-2"><Lock className="h-3 w-3 text-white/20" /> Database access strictly proxied</li>
                <li className="flex items-center gap-2"><Lock className="h-3 w-3 text-white/20" /> Zero local token leaks</li>
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* 5. ACCESSORIES & MCP (Apple Pencil Pro / Magic Keyboard style) */}
      <section 
        id="accessories" 
        className="relative flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center bg-[#000]"
      >
        <div className={`apple-fade max-w-4xl ${visibleSections["accessories"] ? "visible" : ""}`}>
          <h2 className="font-outfit text-xs font-bold tracking-widest text-[#86868b] uppercase mb-4">
            Pro Accessories
          </h2>
          
          <h3 className="font-outfit text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Model Context Protocol. <br />
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-500 bg-clip-text text-transparent">
              Tools that snap on dynamically.
            </span>
          </h3>

          <p className="mx-auto mt-6 max-w-2xl text-base text-[#86868b] sm:text-lg">
            Like a Magic Keyboard snaps onto an iPad Pro with magnetic ease, Model Context Protocol (MCP) strictly registers and connects tools with standardized APIs on dynamic demands.
          </p>

          <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 max-w-3xl mx-auto">
            <div className="p-6 rounded-2xl border border-white/5 bg-neutral-900/50 text-left hover:border-emerald-500/30 transition duration-300">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <FolderTree className="h-5 w-5" />
              </div>
              <h4 className="font-outfit font-bold text-base text-white mt-4">Durable Filesystem Workspace</h4>
              <p className="text-xs text-[#86868b] mt-2 leading-relaxed">
                The agent keeps a workspace structure where it files planning checklists, drafts, code files, and final artifacts, leaving a completely auditable workspace history.
              </p>
            </div>
            
            <div className="p-6 rounded-2xl border border-white/5 bg-neutral-900/50 text-left hover:border-cyan-500/30 transition duration-300">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Search className="h-5 w-5" />
              </div>
              <h4 className="font-outfit font-bold text-base text-white mt-4">Tool Pruning Filters</h4>
              <p className="text-xs text-[#86868b] mt-2 leading-relaxed">
                Filters and prunes unnecessary tools dynamically based on the step of the plan. Minimizes context pollution and improves execution speeds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. TECHNICAL COMPARISON & SPECS SHEET (Apple teardown style) */}
      <section 
        id="specs" 
        className="relative flex min-h-screen flex-col items-center justify-center px-6 py-24 bg-[#050505]"
      >
        <div className={`apple-fade max-w-4xl w-full mx-auto ${visibleSections["specs"] ? "visible" : ""}`}>
          <div className="text-center mb-12">
            <h2 className="font-outfit text-xs font-bold tracking-widest text-[#86868b] uppercase mb-4">
              Specs Teardown
            </h2>
            <h3 className="font-outfit text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Harness vs. Bare Model
            </h3>
            <p className="text-xs text-[#86868b] mt-2">Compare raw model completions to systemic HE-1 constraints.</p>
          </div>

          <div className="flex justify-center mb-8">
            <div className="inline-flex rounded-full bg-white/5 p-1 border border-white/10">
              <button 
                onClick={() => setActiveTab(0)}
                className={`rounded-full px-6 py-1.5 text-xs font-semibold font-outfit transition ${activeTab === 0 ? "bg-white text-black" : "text-[#86868b] hover:text-white"}`}
              >
                Harness Specifications
              </button>
              <button 
                onClick={() => setActiveTab(1)}
                className={`rounded-full px-6 py-1.5 text-xs font-semibold font-outfit transition ${activeTab === 1 ? "bg-white text-black" : "text-[#86868b] hover:text-white"}`}
              >
                Baseline Prompts
              </button>
            </div>
          </div>

          <div className="border border-white/10 rounded-2xl bg-black/60 backdrop-blur-md overflow-hidden">
            {activeTab === 0 ? (
              <div className="divide-y divide-white/5">
                <div className="flex flex-col sm:flex-row p-6">
                  <div className="sm:w-1/3 text-xs text-[#86868b] font-mono tracking-wider">CORE ORCHESTRATION</div>
                  <div className="sm:w-2/3 mt-2 sm:mt-0">
                    <h4 className="text-sm font-bold text-white font-outfit">State-Machine execution</h4>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">Driven by pregel state-machines (LangGraph framework). Runs execution loops asynchronously with safe checkpoints.</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row p-6">
                  <div className="sm:w-1/3 text-xs text-[#86868b] font-mono tracking-wider">CONTAINER ISOLATION</div>
                  <div className="sm:w-2/3 mt-2 sm:mt-0">
                    <h4 className="text-sm font-bold text-white font-outfit">Isolated Docker & WASM</h4>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">Confinement of agent tool usage inside isolated containers. High safety prevents data leakage or raw execution failures.</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row p-6">
                  <div className="sm:w-1/3 text-xs text-[#86868b] font-mono tracking-wider">WORKSPACE PERSISTENCE</div>
                  <div className="sm:w-2/3 mt-2 sm:mt-0">
                    <h4 className="text-sm font-bold text-white font-outfit">Durable Local Workspace</h4>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">Maintains checklist state documents (like `tracker.md` or `AGENTS.md`) directly in the agent's filesystem workspace.</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row p-6">
                  <div className="sm:w-1/3 text-xs text-[#86868b] font-mono tracking-wider">OUTPUT COMPLIANCE</div>
                  <div className="sm:w-2/3 mt-2 sm:mt-0">
                    <h4 className="text-sm font-bold text-white font-outfit">Double-Loop Syntactic Validators</h4>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">Syntax lints, schema verifiers, and output checkers run automatically. Re-routes execution errors directly to the planner.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                <div className="flex flex-col sm:flex-row p-6">
                  <div className="sm:w-1/3 text-xs text-rose-400 font-mono tracking-wider">CORE ORCHESTRATION</div>
                  <div className="sm:w-2/3 mt-2 sm:mt-0">
                    <h4 className="text-sm font-bold text-white font-outfit">Ephemeral Session Prompts</h4>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">Relies strictly on continuous prompt instructions in chat threads. High risk of instruction drift over long chat history.</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row p-6">
                  <div className="sm:w-1/3 text-xs text-rose-400 font-mono tracking-wider">CONTAINER ISOLATION</div>
                  <div className="sm:w-2/3 mt-2 sm:mt-0">
                    <h4 className="text-sm font-bold text-white font-outfit">Direct Host Shells</h4>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">Dangerous connection directly to developer hosts or lack of tool execution support. High vulnerability to bad terminal actions.</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row p-6">
                  <div className="sm:w-1/3 text-xs text-rose-400 font-mono tracking-wider">WORKSPACE PERSISTENCE</div>
                  <div className="sm:w-2/3 mt-2 sm:mt-0">
                    <h4 className="text-sm font-bold text-white font-outfit">Ephemeral RAM Memory</h4>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">Zero physical filesystem state. Memory decays or gets completely lost when context limits are reached.</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row p-6">
                  <div className="sm:w-1/3 text-xs text-rose-400 font-mono tracking-wider">OUTPUT COMPLIANCE</div>
                  <div className="sm:w-2/3 mt-2 sm:mt-0">
                    <h4 className="text-sm font-bold text-white font-outfit">Blind Output Completion</h4>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">No compile checks. Outputs markdown sheets blindly without running syntactic verification loops.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 7. CALL TO ACTION SECTION (Apple Upgrade style) */}
      <section 
        id="cta" 
        className="relative flex min-h-[80vh] flex-col items-center justify-center px-6 py-24 text-center bg-black"
      >
        <div className={`apple-fade max-w-4xl ${visibleSections["cta"] ? "visible" : ""}`}>
          <h2 className="font-outfit text-5xl font-extrabold tracking-tight text-white sm:text-7xl">
            Get started. <br />
            <span className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              Build your Harness today.
            </span>
          </h2>
          
          <p className="mx-auto mt-6 max-w-lg text-[#86868b] text-base sm:text-lg">
            Create structured, durable AI agents governed by isolated systems. Move beyond simple text instructions.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a 
              href={`/chat?threadId=${threadId}`}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-black hover:bg-neutral-200 transition shadow-lg shadow-white/5"
            >
              Launch Deep Agent
              <Play className="h-4 w-4 fill-current" />
            </a>
          </div>

          <div className="mt-12 text-xs text-white/30 font-mono tracking-widest uppercase">
            <a 
              href="https://medium.com/@jerry.shao/harness-engineering-building-production-grade-ai-systems-beyond-prompts-and-context-5fcdffdd6b4c"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white border-b border-white/10 hover:border-white/40 transition-colors duration-200 pb-0.5 inline-flex items-center gap-1"
            >
              Harness Engineering: Building Production-Grade AI Systems Beyond Prompts and Context
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>


      {/* Real-time Telemetry Sync Editor Modal Dialog */}
      {isDialogOpen && (
        <div className={cn(
          "fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md animate-in fade-in duration-300",
          isTelemetryFullscreen ? "p-0" : "p-4"
        )}>
          <div className={cn(
            "relative flex flex-col bg-zinc-950/90 border border-white/10 shadow-2xl transition-all duration-300 ease-in-out animate-in zoom-in-95 duration-300",
            isTelemetryFullscreen
              ? "w-screen max-w-none h-screen max-h-none rounded-none border-none p-6 sm:p-8"
              : "w-full max-w-6xl h-[85vh] rounded-3xl p-6 sm:p-8"
          )}>
            
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4 select-none">
              <div className="flex items-center gap-3 min-w-0">
                {/* macOS-style Window Control Dots */}
                <div className="flex items-center gap-[6px] mr-2 shrink-0 group/dots py-1 px-1">
                  <button
                    onClick={() => setIsDialogOpen(false)}
                    className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#FF5F56] border border-[#E0443E] active:bg-[#BF403A] focus:outline-none transition-colors"
                    aria-label="Close"
                  >
                    <svg className="absolute h-[5px] w-[5px] text-[#4C0002] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100" viewBox="0 0 6 6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                      <path d="M1 1l4 4M5 1L1 5" />
                    </svg>
                  </button>
                  <button
                    onClick={() => toast.info("Minimize is not supported in browser dialog")}
                    className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#FFBD2E] border border-[#DFA023] active:bg-[#C08E1A] focus:outline-none transition-colors"
                    aria-label="Minimize"
                  >
                    <svg className="absolute h-[5px] w-[5px] text-[#5C3E00] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100" viewBox="0 0 6 6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                      <path d="M1 3h4" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setIsTelemetryFullscreen(prev => !prev)}
                    className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#27C93F] border border-[#1AAB29] active:bg-[#12821B] focus:outline-none transition-colors"
                    aria-label="Toggle Fullscreen"
                  >
                    <svg className="absolute h-[5px] w-[5px] text-[#003300] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100" viewBox="0 0 6 6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                      <path d="M1.5 4.5l3-3 M1.5 2.5v2h2 M4.5 3.5v-2h-2" />
                    </svg>
                  </button>
                </div>
                
                {/* Divider */}
                <div className="h-4 w-[1px] bg-white/10 mr-2 shrink-0" />

                <div className="flex items-center gap-3">
                  <h3 className="font-outfit text-xl font-bold text-white leading-none">Markdown Online Preview</h3>
                  <button
                    onClick={() => {
                      if (wsStatus === "disconnected") {
                        toast.promise(
                          new Promise<void>((resolve) => {
                            connectWS();
                            resolve();
                          }),
                          {
                            loading: "Connecting to WebSocket...",
                            success: "Reconnection attempt initiated!",
                            error: "Failed to start reconnection.",
                          }
                        );
                      }
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider transition-all duration-300 select-none",
                      wsStatus === "connected" && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default",
                      wsStatus === "connecting" && "bg-amber-500/10 text-amber-400 border border-amber-500/20 cursor-default animate-pulse",
                      wsStatus === "disconnected" && "bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 cursor-pointer active:scale-95"
                    )}
                    title={
                      wsStatus === "connected" 
                        ? "Websocket Synced (Connected)" 
                        : wsStatus === "connecting"
                          ? "Websocket Connecting..."
                          : "Websocket Disconnected (Click to Reconnect)"
                    }
                  >
                    <span 
                      className={cn(
                        "h-2 w-2 rounded-full",
                        wsStatus === "connected" && "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse",
                        wsStatus === "connecting" && "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)] animate-pulse",
                        wsStatus === "disconnected" && "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                      )}
                    />
                    {wsStatus.toUpperCase()}
                  </button>
                </div>
              </div>
            </div>

            {/* Custom Text Area Container - Stretches to fill remaining space */}
            <div className="relative border border-white/10 rounded-2xl bg-black/40 focus-within:border-indigo-500/60 transition duration-300 flex-1 flex flex-col overflow-hidden">
              <Tabs value={activeTelemetryTab} onValueChange={setActiveTelemetryTab} className="flex flex-col h-full w-full gap-0">
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-zinc-950/60 shrink-0">
                  <TabsList className="grid w-full max-w-[320px] grid-cols-2">
                    <TabsTrigger value="edit">Markdown</TabsTrigger>
                    <TabsTrigger value="preview">Review Markdown</TabsTrigger>
                  </TabsList>

                  {/* Telemetry Action Icons Row */}
                  <div className="flex items-center gap-3">
                    {activeTelemetryTab === "edit" ? (
                      <>
                        {/* Copy Button */}
                        <div className="tooltip-wrapper">
                          <button
                            onClick={handleCopy}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition duration-200"
                          >
                            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                          <div className="tooltip-box">
                            <div className="bg-zinc-900 border border-white/10 text-white font-mono text-[9px] font-bold tracking-wider px-2.5 py-1 rounded-md shadow-xl whitespace-nowrap">
                              {copied ? "COPIED TO CLIPBOARD" : "COPY TO CLIPBOARD"}
                            </div>
                            <div className="w-2 h-2 bg-zinc-900 border-r border-b border-white/10 rotate-45 -mt-1" />
                          </div>
                        </div>

                        {/* Paste Button */}
                        <div className="tooltip-wrapper">
                          <button
                            onClick={handlePaste}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition duration-200"
                          >
                            <ClipboardPaste className="h-3.5 w-3.5" />
                          </button>
                          <div className="tooltip-box">
                            <div className="bg-zinc-900 border border-white/10 text-white font-mono text-[9px] font-bold tracking-wider px-2.5 py-1 rounded-md shadow-xl whitespace-nowrap">
                              PASTE FROM CLIPBOARD
                            </div>
                            <div className="w-2 h-2 bg-zinc-900 border-r border-b border-white/10 rotate-45 -mt-1" />
                          </div>
                        </div>

                        {/* Clear Button */}
                        <div className="tooltip-wrapper">
                          <button
                            onClick={handleClear}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 hover:bg-rose-500/20 hover:text-rose-400 transition duration-200"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <div className="tooltip-box">
                            <div className="bg-zinc-900 border border-rose-500/20 text-rose-400 font-mono text-[9px] font-bold tracking-wider px-2.5 py-1 rounded-md shadow-xl whitespace-nowrap">
                              CLEAR EDITOR CONTENT
                            </div>
                            <div className="w-2 h-2 bg-zinc-900 border-r border-b border-rose-500/20 rotate-45 -mt-1" />
                          </div>
                        </div>
                      </>
                    ) : (
                      /* Copy HTML Button (Matches the style of others) */
                      <div className="tooltip-wrapper">
                        <button
                          onClick={handleCopyHtml}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition duration-200"
                        >
                          {copiedHtml ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        <div className="tooltip-box">
                          <div className="bg-zinc-900 border border-white/10 text-white font-mono text-[9px] font-bold tracking-wider px-2.5 py-1 rounded-md shadow-xl whitespace-nowrap">
                            {copiedHtml ? "COPIED PREVIEW HTML" : "COPY PREVIEW HTML"}
                          </div>
                          <div className="w-2 h-2 bg-zinc-900 border-r border-b border-white/10 rotate-45 -mt-1" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tab content area */}
                <TabsContent value="edit" className="flex-1 flex flex-col min-h-0 data-[state=inactive]:hidden">
                  <textarea
                    value={sharedText}
                    onChange={handleTextChange}
                    placeholder="Type, paste, or telemetry sync here..."
                    className="w-full flex-1 bg-transparent border-0 outline-none p-6 font-mono text-sm text-white/95 placeholder-white/20 resize-none focus:ring-0 leading-relaxed"
                  />
                </TabsContent>

                <TabsContent value="preview" className="relative flex-1 flex flex-col min-h-0 bg-transparent data-[state=inactive]:hidden">
                  {sharedText ? (
                    <ScrollArea className="flex-1 min-h-0 bg-transparent w-full">
                      <div ref={previewRef} className="p-6 text-left text-neutral-100">
                        <MarkdownContent content={sharedText} />
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  ) : (
                    <div className="absolute top-0 left-0 right-0 p-6 text-left text-white/30 font-mono text-sm leading-relaxed">
                      <p>No content to preview.</p>
                      <p className="text-xs mt-1 text-white/20">Write or paste text in the Markdown tab first.</p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default function IntroPage() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center text-white/50 font-mono">
        Loading Harness Engine...
      </div>
    }>
      <IntroPageContent />
    </React.Suspense>
  );
}
