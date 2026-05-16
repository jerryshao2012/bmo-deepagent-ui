"use client";

import { useEffect, useRef, useCallback } from "react";

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  length: number;
  thickness: number;
  angle: number;
  color: string;
  alpha: number;
  speed: number;
  swimPhase: number;
  swimSpeed: number;
}

interface InkWash {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

// Xieyi colors: Ink Black and Cinnabar Red
const XIEYI_COLORS = [
  "30, 30, 30",  // Deep Ink
  "60, 60, 60",  // Medium Ink
  "200, 60, 50", // Cinnabar Red (for contrast)
];

export default function SignInAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000, tx: 0, ty: 0 });
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const inkWashesRef = useRef<InkWash[]>([]);
  const timeRef = useRef(0);

  const createParticles = useCallback((width: number, height: number) => {
    const particles: Particle[] = [];
    // Xieyi paintings have a lot of negative space. We shouldn't have too many fish.
    const count = Math.min(Math.floor((width * height) / 8000), 150);

    for (let i = 0; i < count; i++) {
      // 90% black ink fish, 10% red fish
      const color = Math.random() > 0.1 ? XIEYI_COLORS[Math.floor(Math.random() * 2)] : XIEYI_COLORS[2];
      const z = Math.random() * 0.7 + 0.3; // Less extreme depth

      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z,
        vx: 0,
        vy: 0,
        length: (Math.random() * 15 + 15) * z, // Slightly larger brush strokes
        thickness: (Math.random() * 4 + 3) * z,
        angle: Math.random() * Math.PI * 2,
        color,
        alpha: (Math.random() * 0.4 + 0.5) * z, // Slightly translucent like ink
        speed: (Math.random() * 0.5 + 0.2) * z,
        swimPhase: Math.random() * Math.PI * 2,
        swimSpeed: (Math.random() * 0.08 + 0.04),
      });
    }
    return particles;
  }, []);

  const createInkWashes = useCallback((width: number, height: number) => {
    const washes: InkWash[] = [];
    // A few abstract lotus leaf ink blobs in the corners
    for (let i = 0; i < 6; i++) {
      washes.push({
        x: (Math.random() > 0.5 ? width * Math.random() * 0.2 : width - width * Math.random() * 0.2),
        y: (Math.random() > 0.5 ? height * Math.random() * 0.3 : height - height * Math.random() * 0.3),
        radius: Math.random() * 150 + 100,
        alpha: Math.random() * 0.1 + 0.05, // very faint
      });
    }
    return washes;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.scale(dpr, dpr);

      particlesRef.current = createParticles(window.innerWidth, window.innerHeight);
      inkWashesRef.current = createInkWashes(window.innerWidth, window.innerHeight);
    };

    resize();
    window.addEventListener("resize", resize);

    const handleMouseMove = (e: MouseEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      mouseRef.current = { 
        x, 
        y, 
        tx: (x / window.innerWidth - 0.5) * 30, 
        ty: (y / window.innerHeight - 0.5) * 30 
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000, tx: 0, ty: 0 };
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    const animate = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const time = timeRef.current;

      // Clear with rice paper feel (very faint warm tint)
      ctx.fillStyle = "rgba(250, 248, 245, 0.3)";
      ctx.fillRect(0, 0, w, h);

      // 1. Static Ink Washes (Abstract Lotus Leaves)
      for (const wash of inkWashesRef.current) {
        ctx.beginPath();
        ctx.arc(wash.x, wash.y, wash.radius, 0, Math.PI * 2);
        
        const gradient = ctx.createRadialGradient(wash.x, wash.y, 0, wash.x, wash.y, wash.radius);
        gradient.addColorStop(0, `rgba(40, 50, 45, ${wash.alpha})`);
        gradient.addColorStop(0.7, `rgba(40, 50, 45, ${wash.alpha * 0.5})`);
        gradient.addColorStop(1, `rgba(40, 50, 45, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // 2. Xieyi Fish Particles
      const particles = particlesRef.current;
      const { x: mx, y: my, tx, ty } = mouseRef.current;

      for (const p of particles) {
        // Swimming Flow
        const flowAngle = 
          Math.sin(p.x * 0.001 + time * 0.002) * Math.PI * 0.8 + 
          Math.cos(p.y * 0.001 + time * 0.002) * Math.PI * 0.8;
        
        p.angle += (flowAngle - p.angle) * 0.02;
        
        p.vx = Math.cos(p.angle) * p.speed;
        p.vy = Math.sin(p.angle) * p.speed;

        // Mouse repulsion
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150) {
          const force = (150 - dist) / 150;
          p.vx += (dx / dist) * force * 5;
          p.vy += (dy / dist) * force * 5;
          p.angle = Math.atan2(p.vy, p.vx);
        }

        p.x += p.vx;
        p.y += p.vy;

        // Wrapping
        if (p.x < -50) p.x = w + 50;
        if (p.x > w + 50) p.x = -50;
        if (p.y < -50) p.y = h + 50;
        if (p.y > h + 50) p.y = -50;

        // Parallax Offset
        const px = p.x + tx * p.z;
        const py = p.y + ty * p.z;

        // Drawing Xieyi Fish (Minimalist Brush Strokes)
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.angle);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = `rgb(${p.color})`;
        
        // One fluid stroke for the body (thick head, tapering to tail)
        ctx.beginPath();
        ctx.moveTo(p.length / 2, 0); // Head
        ctx.bezierCurveTo(p.length / 4, p.thickness, -p.length / 4, p.thickness * 0.5, -p.length / 2, 0);
        ctx.bezierCurveTo(-p.length / 4, -p.thickness * 0.5, p.length / 4, -p.thickness, p.length / 2, 0);
        ctx.fill();

        // A quick flick for the tail
        const wiggle = Math.sin(time * p.swimSpeed + p.swimPhase) * (p.length * 0.4);
        ctx.beginPath();
        ctx.moveTo(-p.length / 2.2, 0);
        ctx.quadraticCurveTo(-p.length * 0.7, wiggle * 0.8, -p.length * 0.9, wiggle);
        ctx.quadraticCurveTo(-p.length * 0.6, 0, -p.length / 2.2, 0);
        ctx.fill();
        
        // Minimalist eye dot
        ctx.fillStyle = `rgba(0, 0, 0, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.length * 0.3, -p.thickness * 0.3, p.z * 1.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      timeRef.current++;
      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [createParticles, createInkWashes]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 opacity-100"
      style={{ background: "transparent" }}
    />
  );
}
