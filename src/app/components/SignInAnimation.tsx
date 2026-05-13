"use client";

import { useEffect, useRef, useCallback } from "react";

interface Particle {
  x: number;
  y: number;
  z: number; // Depth (0.1 to 1.0)
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

interface GlowOrb {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
  vx: number;
  vy: number;
  pulseSpeed: number;
  pulsePhase: number;
}

const VIBRANT_COLORS = [
  "66, 133, 244",  // Blue
  "234, 67, 53",   // Red
  "251, 188, 5",   // Yellow
  "52, 168, 83",   // Green
  "103, 58, 183",  // Purple
  "0, 188, 212",   // Cyan
  "255, 64, 129",  // Pink
];

export default function SignInAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000, tx: 0, ty: 0 });
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const orbsRef = useRef<GlowOrb[]>([]);
  const timeRef = useRef(0);

  const createParticles = useCallback((width: number, height: number) => {
    const particles: Particle[] = [];
    // Slightly fewer fish than dashes to allow for more detail
    const count = Math.min(Math.floor((width * height) / 4000), 800);

    for (let i = 0; i < count; i++) {
      const color = VIBRANT_COLORS[Math.floor(Math.random() * VIBRANT_COLORS.length)];
      const z = Math.random() * 0.9 + 0.1;

      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z,
        vx: 0,
        vy: 0,
        length: (Math.random() * 6 + 6) * z,
        thickness: (Math.random() * 1.5 + 1) * z,
        angle: Math.random() * Math.PI * 2,
        color,
        alpha: (Math.random() * 0.5 + 0.4) * z,
        speed: (Math.random() * 0.4 + 0.3) * z,
        swimPhase: Math.random() * Math.PI * 2,
        swimSpeed: (Math.random() * 0.1 + 0.05),
      });
    }
    return particles;
  }, []);

  const createOrbs = useCallback((width: number, height: number) => {
    const orbs: GlowOrb[] = [];
    const orbColors = ["66, 133, 244", "103, 58, 183", "0, 188, 212", "255, 64, 129"];

    for (let i = 0; i < 8; i++) {
      orbs.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 400 + 200,
        color: orbColors[i % orbColors.length],
        alpha: 0.12 + Math.random() * 0.05,
        vx: (Math.random() - 0.5) * 0.1,
        vy: (Math.random() - 0.5) * 0.1,
        pulseSpeed: Math.random() * 0.003 + 0.002,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }
    return orbs;
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
      orbsRef.current = createOrbs(window.innerWidth, window.innerHeight);
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

      // Clear with trail
      ctx.fillStyle = "rgba(248, 250, 252, 0.2)";
      ctx.fillRect(0, 0, w, h);

      // 1. Glow Orbs (Underwater Lighting Feel)
      for (const orb of orbsRef.current) {
        orb.x += orb.vx;
        orb.y += orb.vy;

        if (orb.x < -orb.radius) orb.vx = Math.abs(orb.vx);
        if (orb.x > w + orb.radius) orb.vx = -Math.abs(orb.vx);
        if (orb.y < -orb.radius) orb.vy = Math.abs(orb.vy);
        if (orb.y > h + orb.radius) orb.vy = -Math.abs(orb.vy);

        const pulseAlpha = orb.alpha * (0.8 + 0.2 * Math.sin(time * orb.pulseSpeed + orb.pulsePhase));
        const gradient = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius);
        gradient.addColorStop(0, `rgba(${orb.color}, ${pulseAlpha})`);
        gradient.addColorStop(0.6, `rgba(${orb.color}, ${pulseAlpha * 0.2})`);
        gradient.addColorStop(1, `rgba(${orb.color}, 0)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(orb.x - orb.radius, orb.y - orb.radius, orb.radius * 2, orb.radius * 2);
      }

      // 2. Fish Particles
      const particles = particlesRef.current;
      const { x: mx, y: my, tx, ty } = mouseRef.current;

      for (const p of particles) {
        // Swimming Flow (Slightly more organic than before)
        const flowAngle = 
          Math.sin(p.x * 0.001 + time * 0.003) * Math.PI * 0.8 + 
          Math.cos(p.y * 0.001 + time * 0.003) * Math.PI * 0.8;
        
        p.angle += (flowAngle - p.angle) * 0.03;
        
        p.vx = Math.cos(p.angle) * p.speed;
        p.vy = Math.sin(p.angle) * p.speed;

        // Mouse repulsion (Scaring the fish)
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150) {
          const force = (150 - dist) / 150;
          p.vx += (dx / dist) * force * 5;
          p.vy += (dy / dist) * force * 5;
          // Quickly turn away
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

        // Drawing the Fish
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.angle);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = `rgb(${p.color})`;
        
        // Body (Teardrop/Ellipse)
        ctx.beginPath();
        ctx.moveTo(p.length / 2, 0); // Nose
        ctx.quadraticCurveTo(0, p.thickness, -p.length / 4, 0); // Bottom curve
        ctx.quadraticCurveTo(0, -p.thickness, p.length / 2, 0); // Top curve
        ctx.fill();

        // Tail Wiggle
        const wiggle = Math.sin(time * p.swimSpeed + p.swimPhase) * (p.length * 0.4);
        ctx.beginPath();
        ctx.moveTo(-p.length / 4, 0);
        ctx.lineTo(-p.length * 0.7, wiggle * 0.5);
        ctx.lineTo(-p.length * 0.8, wiggle);
        ctx.lineTo(-p.length * 0.7, wiggle * -0.5);
        ctx.closePath();
        ctx.fill();

        // Eye (Tiny dot for extra life)
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.beginPath();
        ctx.arc(p.length * 0.25, -p.thickness * 0.2, 0.8 * p.z, 0, Math.PI * 2);
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
  }, [createParticles, createOrbs]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 opacity-100"
      style={{ background: "transparent" }}
    />
  );
}
