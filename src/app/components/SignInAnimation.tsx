"use client";

import { useCallback, useEffect, useRef } from "react";

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
  fishType: "ink_veil" | "cinnabar" | "kohaku" | "tancho" | "baby_ink";
  tailLengthMult: number;
  finLengthMult: number;
  bodyPlumpness: number;
  wavenumber: number;
  swimAmplitudeMult: number;
}

interface InkWash {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

export default function SignInAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000, tx: 0, ty: 0 });
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const inkWashesRef = useRef<InkWash[]>([]);
  const inkFlowersRef = useRef<InkWash[]>([]);
  const timeRef = useRef(0);

  const createParticles = useCallback((width: number, height: number) => {
    const particles: Particle[] = [];
    // Keep a premium, spacious layout with a beautiful amount of negative space
    const count = Math.min(Math.floor((width * height) / 9500), 120);

    for (let i = 0; i < count; i++) {
      const z = Math.random() * 0.7 + 0.3; // Depth factor (scale size, speed, and opacity)

      const rand = Math.random();
      let fishType: Particle["fishType"];
      let color;
      let baseLength;
      let baseThickness;
      let baseSpeed;
      let swimSpeed;
      let tailLengthMult;
      let finLengthMult;
      let bodyPlumpness;
      let wavenumber;
      let swimAmplitudeMult;

      if (rand < 0.3) {
        // 1. Ink Veil-Tail (Classic slow black-ink fish with long flowing tails)
        fishType = "ink_veil";
        color = Math.random() > 0.5 ? "30, 30, 30" : "60, 60, 60";
        baseLength = Math.random() * 8 + 20; // 20-28px
        baseThickness = Math.random() * 1.5 + 4.5; // 4.5-6px
        baseSpeed = Math.random() * 0.15 + 0.15; // Slow, majestic glide
        swimSpeed = Math.random() * 0.015 + 0.03; // Heavy, slow sway
        tailLengthMult = 1.15; // Extremely long tail
        finLengthMult = 1.1;
        bodyPlumpness = 1.15; // Plumper, elegant head/body
        wavenumber = 2.2; // Slower, wider body wave
        swimAmplitudeMult = 0.85;
      } else if (rand < 0.5) {
        // 2. Cinnabar Red Koi (Solid, energetic red)
        fishType = "cinnabar";
        color = "210, 50, 40";
        baseLength = Math.random() * 6 + 18; // 18-24px
        baseThickness = Math.random() + 3.8; // 3.8-4.8px
        baseSpeed = Math.random() * 0.25 + 0.3; // Faster, active
        swimSpeed = Math.random() * 0.02 + 0.05;
        tailLengthMult = 0.85;
        finLengthMult = 0.85;
        bodyPlumpness = 0.95;
        wavenumber = 2.6;
        swimAmplitudeMult = 1.0;
      } else if (rand < 0.7) {
        // 3. Kohaku Koi (Creamy warm-white body with red watercolor splotches)
        fishType = "kohaku";
        color = "246, 243, 236"; // Distinct warm-white base
        baseLength = Math.random() * 6 + 18;
        baseThickness = Math.random() + 3.8;
        baseSpeed = Math.random() * 0.2 + 0.25;
        swimSpeed = Math.random() * 0.02 + 0.055;
        tailLengthMult = 0.8;
        finLengthMult = 0.8;
        bodyPlumpness = 1.0;
        wavenumber = 2.7;
        swimAmplitudeMult = 1.1;
      } else if (rand < 0.8) {
        // 4. Tancho Koi (Auspicious white body with a single red head-crown)
        fishType = "tancho";
        color = "246, 243, 236";
        baseLength = Math.random() * 6 + 19;
        baseThickness = Math.random() + 3.9;
        baseSpeed = Math.random() * 0.2 + 0.25;
        swimSpeed = Math.random() * 0.02 + 0.05;
        tailLengthMult = 0.9;
        finLengthMult = 0.9;
        bodyPlumpness = 1.0;
        wavenumber = 2.5;
        swimAmplitudeMult = 1.0;
      } else {
        // 5. Baby Ink Fish (Small, very dark black ink dart)
        fishType = "baby_ink";
        color = "15, 15, 15";
        baseLength = Math.random() * 4 + 11; // 11-15px (small)
        baseThickness = Math.random() * 0.6 + 2.4; // 2.4-3px (slender)
        baseSpeed = Math.random() * 0.3 + 0.45; // High speed darting
        swimSpeed = Math.random() * 0.03 + 0.085; // High frequency wiggle
        tailLengthMult = 0.65;
        finLengthMult = 0.65;
        bodyPlumpness = 0.85;
        wavenumber = 3.0; // Very tight wiggles
        swimAmplitudeMult = 1.35;
      }

      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z,
        vx: 0,
        vy: 0,
        length: baseLength * z,
        thickness: baseThickness * z,
        angle: Math.random() * Math.PI * 2,
        color,
        alpha: (Math.random() * 0.3 + 0.6) * z, // Faded overlay look
        speed: baseSpeed * z,
        swimPhase: Math.random() * Math.PI * 2,
        swimSpeed,
        fishType,
        tailLengthMult,
        finLengthMult,
        bodyPlumpness,
        wavenumber,
        swimAmplitudeMult,
      });
    }
    return particles;
  }, []);

  const createInkWashes = useCallback((width: number, height: number) => {
    const washes: InkWash[] = [];
    // A few abstract lotus leaf ink blobs in the corners
    for (let i = 0; i < 6; i++) {
      washes.push({
        x:
          Math.random() > 0.5
            ? width * Math.random() * 0.2
            : width - width * Math.random() * 0.2,
        y:
          Math.random() > 0.5
            ? height * Math.random() * 0.3
            : height - height * Math.random() * 0.3,
        radius: Math.random() * 150 + 100,
        alpha: Math.random() * 0.1 + 0.05, // very faint
      });
    }
    return washes;
  }, []);

  const createInkFlowers = useCallback((width: number, height: number) => {
    const flowers: InkWash[] = [];
    // Spawn 4 abstract lotus flower washes slightly offset from the leaves
    for (let i = 0; i < 4; i++) {
      flowers.push({
        x:
          Math.random() > 0.5
            ? width * (Math.random() * 0.2 + 0.05)
            : width - width * (Math.random() * 0.2 + 0.05),
        y:
          Math.random() > 0.5
            ? height * (Math.random() * 0.3 + 0.05)
            : height - height * (Math.random() * 0.3 + 0.05),
        radius: Math.random() * 70 + 60, // flower wash size (smaller than leaf washes)
        alpha: Math.random() * 0.07 + 0.04, // very faint, translucent wash
      });
    }
    return flowers;
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

      particlesRef.current = createParticles(
        window.innerWidth,
        window.innerHeight
      );
      inkWashesRef.current = createInkWashes(
        window.innerWidth,
        window.innerHeight
      );
      inkFlowersRef.current = createInkFlowers(
        window.innerWidth,
        window.innerHeight
      );
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
        ty: (y / window.innerHeight - 0.5) * 30,
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

        const gradient = ctx.createRadialGradient(
          wash.x,
          wash.y,
          0,
          wash.x,
          wash.y,
          wash.radius
        );
        gradient.addColorStop(0, `rgba(40, 50, 45, ${wash.alpha})`);
        gradient.addColorStop(0.7, `rgba(40, 50, 45, ${wash.alpha * 0.5})`);
        gradient.addColorStop(1, `rgba(40, 50, 45, 0)`);

        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // 1b. Static Ink Washes (Abstract Lotus Flowers - Soft, dilute watercolor-pink blobs)
      for (const wash of inkFlowersRef.current) {
        ctx.beginPath();
        ctx.arc(wash.x, wash.y, wash.radius, 0, Math.PI * 2);

        const gradient = ctx.createRadialGradient(
          wash.x,
          wash.y,
          0,
          wash.x,
          wash.y,
          wash.radius
        );
        gradient.addColorStop(0, `rgba(235, 120, 140, ${wash.alpha})`);
        gradient.addColorStop(0.6, `rgba(235, 120, 140, ${wash.alpha * 0.4})`);
        gradient.addColorStop(1, `rgba(235, 120, 140, 0)`);

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

        // Drawing Xieyi Fish (Dynamic Spine & Organic Swim Curve)
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.angle);
        ctx.globalAlpha = p.alpha;

        const N = 12; // Spine segments
        const points: {
          x: number;
          y: number;
          tx: number;
          ty: number;
          thickness: number;
        }[] = [];
        const phase = time * p.swimSpeed + p.swimPhase;
        const k = p.wavenumber; // Custom wavenumber per fish type

        // 1. Generate Spine Points along a Dynamic Wave
        for (let i = 0; i <= N; i++) {
          const s = i / N;
          const x = p.length * (0.5 - s);
          // Head sways slightly, tail wiggles widely (scaled by swimAmplitudeMult)
          const amp = p.length * (0.04 + 0.16 * s * s) * p.swimAmplitudeMult;
          const y = Math.sin(phase - k * s) * amp;
          points.push({ x, y, tx: 0, ty: 0, thickness: 0 });
        }

        // 2. Compute Tangents along the Spine
        for (let i = 0; i <= N; i++) {
          let tx;
          let ty;
          if (i === 0) {
            tx = points[0].x - points[1].x;
            ty = points[0].y - points[1].y;
          } else if (i === N) {
            tx = points[N - 1].x - points[N].x;
            ty = points[N - 1].y - points[N].y;
          } else {
            tx = points[i - 1].x - points[i + 1].x;
            ty = points[i - 1].y - points[i + 1].y;
          }
          const len = Math.sqrt(tx * tx + ty * ty);
          points[i].tx = tx / len;
          points[i].ty = ty / len;

          // 2b. Compute Type-Specific Body Profile (no more generic tadpole shapes!)
          const s = i / N;
          let tProfile;

          if (p.fishType === "baby_ink") {
            // Sleek darting fry profile (slender and streamlined)
            if (s < 0.3) {
              tProfile = 0.35 + 0.65 * Math.sin(((s / 0.3) * Math.PI) / 2);
            } else {
              tProfile =
                0.2 + 0.8 * Math.cos((((s - 0.3) / 0.7) * Math.PI) / 2);
            }
          } else if (p.fishType === "ink_veil" || p.fishType === "cinnabar") {
            // Plump, elegant fancy body (Goldfish / high-backed Butterfly koi style)
            if (s < 0.4) {
              tProfile = 0.25 + 0.75 * Math.sin(((s / 0.4) * Math.PI) / 2);
            } else {
              tProfile =
                0.25 + 0.75 * Math.cos((((s - 0.4) / 0.6) * Math.PI) / 2);
            }
          } else {
            // Streamlined torpedo shape (Classic elegant majestic long Koi)
            if (s < 0.35) {
              tProfile = 0.2 + 0.8 * Math.sin(((s / 0.35) * Math.PI) / 2);
            } else {
              tProfile =
                0.2 + 0.8 * Math.cos((((s - 0.35) / 0.65) * Math.PI) / 2);
            }
          }

          // Scale by bodyPlumpness per fish type
          points[i].thickness = p.thickness * tProfile * p.bodyPlumpness;
        }

        // 3. Compute Boundary Points for the Body Outline
        const leftPoints: { x: number; y: number }[] = [];
        const rightPoints: { x: number; y: number }[] = [];
        for (let i = 0; i <= N; i++) {
          const pt = points[i];
          const nx = -pt.ty;
          const ny = pt.tx;
          leftPoints.push({
            x: pt.x + nx * pt.thickness,
            y: pt.y + ny * pt.thickness,
          });
          rightPoints.push({
            x: pt.x - nx * pt.thickness,
            y: pt.y - ny * pt.thickness,
          });
        }

        const shoulderIndex = 2; // Roughly s = 0.17

        // 4a. Configure Pectoral Fin Geometry per Fish Type for natural realism
        let finLen = p.length * 0.32;
        let finSpread = 0.25; // How much the fin swells outwards
        let finAngleOffset = 0.75; // Direction (Pi * finAngleOffset) relative to body

        if (p.fishType === "baby_ink") {
          finLen = p.length * 0.18; // Small, realistic stubby fins
          finSpread = 0.15;
          finAngleOffset = 0.65;
        } else if (p.fishType === "ink_veil") {
          finLen = p.length * 0.38; // Elegant trailing ribbon but completely proportional
          finSpread = 0.2;
          finAngleOffset = 0.85; // Sweeps gracefully backwards
        } else if (p.fishType === "cinnabar") {
          finLen = p.length * 0.28;
          finSpread = 0.18; // Sleek, narrow leaf shape
          finAngleOffset = 0.75;
        } else if (p.fishType === "kohaku") {
          finLen = p.length * 0.32;
          finSpread = 0.45; // Wide, round, natural fan stroke
          finAngleOffset = 0.7;
        } else if (p.fishType === "tancho") {
          finLen = p.length * 0.35; // Highly elegant, ribbon-like but natural
          finSpread = 0.25;
          finAngleOffset = 0.8;
        }

        // 4. Draw Left Pectoral Fin (Flowing watercolor stroke)
        if (leftPoints[shoulderIndex] && leftPoints[shoulderIndex + 2]) {
          const base = leftPoints[shoulderIndex];
          const end = leftPoints[shoulderIndex + 2];
          const sTx = points[shoulderIndex].tx;
          const sTy = points[shoulderIndex].ty;
          const sNx = -sTy;
          const sNy = sTx;

          // Swaying angle relative to body direction
          const finAngleL =
            Math.PI * finAngleOffset + Math.sin(phase - 1.2) * 0.15;
          const cosL = Math.cos(finAngleL);
          const sinL = Math.sin(finAngleL);
          const finDx = sTx * cosL - sTy * sinL;
          const finDy = sTx * sinL + sTy * cosL;

          const tipX = base.x + finDx * finLen;
          const tipY = base.y + finDy * finLen;

          ctx.beginPath();
          ctx.moveTo(base.x, base.y);
          ctx.bezierCurveTo(
            base.x + finDx * finLen * 0.5 + sNx * finLen * finSpread,
            base.y + finDy * finLen * 0.5 + sNy * finLen * finSpread,
            tipX - finDx * finLen * 0.2,
            tipY - finDx * finLen * 0.2,
            tipX,
            tipY
          );
          ctx.bezierCurveTo(
            tipX - finDx * finLen * 0.3 - sNx * finLen * (finSpread * 0.4),
            tipY - finDy * finLen * 0.3 - sNy * finLen * (finSpread * 0.4),
            end.x,
            end.y,
            end.x,
            end.y
          );
          // If white body, make the translucent fin slightly warm/translucent grey-pink for elegance
          const finColor =
            p.fishType === "kohaku" || p.fishType === "tancho"
              ? "200, 160, 160"
              : p.color;
          ctx.fillStyle = `rgba(${finColor}, ${p.alpha * 0.55})`;
          ctx.fill();
        }

        // 5. Draw Right Pectoral Fin
        if (rightPoints[shoulderIndex] && rightPoints[shoulderIndex + 2]) {
          const base = rightPoints[shoulderIndex];
          const end = rightPoints[shoulderIndex + 2];
          const sTx = points[shoulderIndex].tx;
          const sTy = points[shoulderIndex].ty;
          const sNx = -sTy;
          const sNy = sTx;

          const finAngleR =
            -Math.PI * finAngleOffset - Math.sin(phase - 1.2) * 0.15;
          const cosR = Math.cos(finAngleR);
          const sinR = Math.sin(finAngleR);
          const finDx = sTx * cosR - sTy * sinR;
          const finDy = sTx * sinR + sTy * cosR;

          const tipX = base.x + finDx * finLen;
          const tipY = base.y + finDy * finLen;

          ctx.beginPath();
          ctx.moveTo(base.x, base.y);
          ctx.bezierCurveTo(
            base.x + finDx * finLen * 0.5 - sNx * finLen * finSpread,
            base.y + finDy * finLen * 0.5 - sNy * finLen * finSpread,
            tipX - finDx * finLen * 0.2,
            tipY - finDx * finLen * 0.2,
            tipX,
            tipY
          );
          ctx.bezierCurveTo(
            tipX - finDx * finLen * 0.3 + sNx * finLen * (finSpread * 0.4),
            tipY - finDy * finLen * 0.3 + sNy * finLen * (finSpread * 0.4),
            end.x,
            end.y,
            end.x,
            end.y
          );
          const finColor =
            p.fishType === "kohaku" || p.fishType === "tancho"
              ? "200, 160, 160"
              : p.color;
          ctx.fillStyle = `rgba(${finColor}, ${p.alpha * 0.55})`;
          ctx.fill();
        }

        // 6. Draw Flowing Tail Fin (Highly distinct type-specific configurations)
        const tailTip = points[N];
        const tTx = tailTip.tx;
        const tTy = tailTip.ty;
        const tNx = -tTy;
        const tNy = tTx;

        const drawTailLobe = (
          len: number,
          angleOffset: number,
          phaseDelay: number,
          thicknessMult: number,
          opacityMult: number
        ) => {
          const lobeAngle =
            Math.PI + angleOffset + Math.sin(phase - phaseDelay) * 0.25;
          const cosA = Math.cos(lobeAngle);
          const sinA = Math.sin(lobeAngle);

          const dx = tTx * cosA - tTy * sinA;
          const dy = tTx * sinA + tTy * cosA;

          const tipX = tailTip.x + dx * len;
          const tipY = tailTip.y + dy * len;

          ctx.beginPath();
          ctx.moveTo(tailTip.x, tailTip.y);
          ctx.bezierCurveTo(
            tailTip.x + dx * len * 0.4 + tNx * len * 0.2 * thicknessMult,
            tailTip.y + dy * len * 0.4 + tNy * len * 0.2 * thicknessMult,
            tipX - dx * len * 0.2,
            tipY - dy * len * 0.2,
            tipX,
            tipY
          );
          ctx.quadraticCurveTo(
            tipX - dx * len * 0.3 - tNx * len * 0.15 * thicknessMult,
            tipY - dy * len * 0.3 - tNy * len * 0.15 * thicknessMult,
            tailTip.x,
            tailTip.y
          );
          // If white body, tail has gorgeous semi-transparent cinnabar/rose tones
          const tailColor =
            p.fishType === "kohaku" || p.fishType === "tancho"
              ? "220, 160, 150"
              : p.color;
          ctx.fillStyle = `rgba(${tailColor}, ${p.alpha * 0.45 * opacityMult})`;
          ctx.fill();
        };

        // 6b. Draw Type-Specific Tail Shapes for Perfect Realistic Proportions
        if (p.fishType === "baby_ink") {
          // Playful small single arrowhead tail (1 solid quick brush stroke, no extra lobes)
          ctx.beginPath();
          ctx.moveTo(tailTip.x, tailTip.y);
          const tailWiggle = Math.sin(phase - 1.5) * (p.length * 0.12);
          const txDir = -tTx * p.length * 0.35;
          const tyDir = -tTy * p.length * 0.35;
          ctx.quadraticCurveTo(
            tailTip.x + txDir + tNx * tailWiggle * 0.5,
            tailTip.y + tyDir + tNy * tailWiggle * 0.5,
            tailTip.x + txDir + tNx * tailWiggle,
            tailTip.y + tyDir + tNy * tailWiggle
          );
          ctx.quadraticCurveTo(
            tailTip.x + txDir * 0.5,
            tailTip.y + tyDir * 0.5,
            tailTip.x,
            tailTip.y
          );
          ctx.fillStyle = `rgb(${p.color})`;
          ctx.fill();
        } else if (p.fishType === "ink_veil") {
          // Double sweeping veil-tails (veil-tail butterfly koi look, graceful and realistic)
          drawTailLobe(p.length * 0.65, 0.28, 1.6, 1.8, 0.95); // Realistic large left lobe
          drawTailLobe(p.length * 0.65, -0.28, 2.4, -1.8, 0.95); // Realistic large right lobe
        } else if (p.fishType === "cinnabar") {
          // Compact fan tail (1 large center lobe + 2 base stabilizer lobes, natural fan shape)
          drawTailLobe(p.length * 0.52, 0.0, 2.0, 1.9, 1.0); // Wide center fan
          drawTailLobe(p.length * 0.32, 0.35, 1.7, 0.6, 0.85); // Left stabilizer
          drawTailLobe(p.length * 0.32, -0.35, 2.3, -0.6, 0.85); // Right stabilizer
        } else if (p.fishType === "kohaku") {
          // Sleek, compact swallow split-tail
          drawTailLobe(p.length * 0.5, 0.16, 1.9, 0.8, 0.9); // Slender left
          drawTailLobe(p.length * 0.5, -0.16, 2.1, -0.8, 0.9); // Slender right
        } else if (p.fishType === "tancho") {
          // Elegant triple-lobed veil-tail (silk ribbon but realistically scaled)
          drawTailLobe(p.length * 0.55, 0.22, 1.7, 1.1, 0.9); // Flowing left
          drawTailLobe(p.length * 0.55, -0.22, 2.3, -1.1, 0.9); // Flowing right
          drawTailLobe(p.length * 0.38, 0.0, 2.0, 0.75, 0.8); // Elegant center
        }

        // 7. Draw Dynamic Curved Body
        ctx.beginPath();
        ctx.moveTo(leftPoints[0].x, leftPoints[0].y);

        // Left side trace
        for (let i = 1; i <= N; i++) {
          ctx.lineTo(leftPoints[i].x, leftPoints[i].y);
        }
        // Right side trace back
        ctx.lineTo(rightPoints[N].x, rightPoints[N].y);
        for (let i = N - 1; i >= 0; i--) {
          ctx.lineTo(rightPoints[i].x, rightPoints[i].y);
        }

        // Seamless rounded head cap
        const headCenterForwardX =
          points[0].x + points[0].tx * (p.thickness * 0.3);
        const headCenterForwardY =
          points[0].y + points[0].ty * (p.thickness * 0.3);
        ctx.quadraticCurveTo(
          headCenterForwardX,
          headCenterForwardY,
          leftPoints[0].x,
          leftPoints[0].y
        );

        ctx.closePath();
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.fill();

        // 7b. Draw Kohaku/Tancho red watercolor splotches (clipping ensures they sit perfectly inside the body)
        if (p.fishType === "kohaku" || p.fishType === "tancho") {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
          for (let i = 1; i <= N; i++) {
            ctx.lineTo(leftPoints[i].x, leftPoints[i].y);
          }
          ctx.lineTo(rightPoints[N].x, rightPoints[N].y);
          for (let i = N - 1; i >= 0; i--) {
            ctx.lineTo(rightPoints[i].x, rightPoints[i].y);
          }
          ctx.quadraticCurveTo(
            headCenterForwardX,
            headCenterForwardY,
            leftPoints[0].x,
            leftPoints[0].y
          );
          ctx.closePath();
          ctx.clip(); // Constrain drawing to the fish's body shape

          // Vibrant watercolor red pigment
          ctx.fillStyle = `rgba(210, 45, 35, ${p.alpha * 0.9})`;

          if (p.fishType === "tancho") {
            // Draw single round red crown on the forehead
            const crownPt = points[1] || points[0];
            ctx.beginPath();
            ctx.arc(
              crownPt.x - crownPt.tx * (p.length * 0.02),
              crownPt.y - crownPt.ty * (p.length * 0.02),
              p.thickness * 0.65,
              0,
              Math.PI * 2
            );
            ctx.fill();
          } else if (p.fishType === "kohaku") {
            // Draw 3 flowing splotches along the spine
            if (points[3]) {
              ctx.beginPath();
              ctx.arc(
                points[3].x,
                points[3].y,
                p.thickness * 0.8,
                0,
                Math.PI * 2
              );
              ctx.fill();
            }
            if (points[6]) {
              ctx.beginPath();
              ctx.arc(
                points[6].x,
                points[6].y,
                p.thickness * 0.65,
                0,
                Math.PI * 2
              );
              ctx.fill();
            }
            if (points[9]) {
              ctx.beginPath();
              ctx.arc(
                points[9].x,
                points[9].y,
                p.thickness * 0.45,
                0,
                Math.PI * 2
              );
              ctx.fill();
            }
          }
          ctx.restore(); // Exit body clipping
        }

        // 8. Eyes (Symmetrical dark ink dots wiggling with head)
        const headPt = points[0];
        const hTx = headPt.tx;
        const hTy = headPt.ty;
        const hNx = -hTy;
        const hNy = hTx;

        const eyeDistBack = p.length * 0.14;
        const eyeDistSide = p.thickness * 0.45;

        const leftEyeX = headPt.x - hTx * eyeDistBack + hNx * eyeDistSide;
        const leftEyeY = headPt.y - hTy * eyeDistBack + hNy * eyeDistSide;

        const rightEyeX = headPt.x - hTx * eyeDistBack - hNx * eyeDistSide;
        const rightEyeY = headPt.y - hTy * eyeDistBack - hNy * eyeDistSide;

        ctx.fillStyle = `rgba(15, 15, 15, ${p.alpha * 0.95})`;
        ctx.beginPath();
        ctx.arc(leftEyeX, leftEyeY, p.z, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(rightEyeX, rightEyeY, p.z, 0, Math.PI * 2);
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
  }, [createParticles, createInkWashes, createInkFlowers]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 opacity-100"
      style={{ background: "transparent" }}
    />
  );
}
