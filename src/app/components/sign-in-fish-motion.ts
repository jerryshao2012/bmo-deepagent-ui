const TWO_PI = Math.PI * 2;
const MAX_FRAME_DELTA_SECONDS = 1 / 30;
const AVOIDANCE_RADIUS = 150;
const MAX_AVOIDANCE_WEIGHT = 0.85;
const HEADING_GAIN = 1.8;
const TURN_SLOWDOWN = 0.18;
const SLOWDOWN_DAMPING = 4;
const RECOVERY_DAMPING = 2;

export interface FishMotionState {
  x: number;
  y: number;
  heading: number;
  turnRate: number;
  currentSpeed: number;
}

export interface FishMotionLimits {
  cruiseSpeed: number;
  maxTurnRate: number;
  angularAcceleration: number;
}

export interface DesiredHeadingInput {
  fishX: number;
  fishY: number;
  heading: number;
  ambientHeading: number;
  pointerX: number;
  pointerY: number;
}

export interface FishSpineInput {
  length: number;
  phase: number;
  wavenumber: number;
  swimAmplitudeMult: number;
  turnRate: number;
  maxTurnRate: number;
  segments?: number;
}

export interface FishSpinePoint {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const moveTowards = (current: number, target: number, maximumDelta: number) => {
  if (Math.abs(target - current) <= maximumDelta) return target;
  return current + Math.sign(target - current) * maximumDelta;
};

export function normalizeAngle(angle: number): number {
  return ((((angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

export function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function resolveDesiredHeading({
  fishX,
  fishY,
  heading,
  ambientHeading,
  pointerX,
  pointerY,
}: DesiredHeadingInput): number {
  const normalizedAmbientHeading = normalizeAngle(ambientHeading);
  const dx = fishX - pointerX;
  const dy = fishY - pointerY;
  const distance = Math.hypot(dx, dy);

  if (distance >= AVOIDANCE_RADIUS) return normalizedAmbientHeading;

  const awayHeading =
    distance > Number.EPSILON
      ? Math.atan2(dy, dx)
      : normalizeAngle(heading + Math.PI);
  const proximity = clamp(1 - distance / AVOIDANCE_RADIUS, 0, 1);
  const smoothProximity = proximity * proximity * (3 - 2 * proximity);
  const avoidanceWeight = MAX_AVOIDANCE_WEIGHT * smoothProximity;

  return normalizeAngle(
    normalizedAmbientHeading +
      shortestAngleDelta(normalizedAmbientHeading, awayHeading) *
        avoidanceWeight
  );
}

export function stepFishMotion(
  state: FishMotionState,
  desiredHeading: number,
  limits: FishMotionLimits,
  deltaSeconds: number
): FishMotionState {
  const dt = clamp(deltaSeconds, 0, MAX_FRAME_DELTA_SECONDS);
  const headingDelta = shortestAngleDelta(state.heading, desiredHeading);
  const desiredTurnRate = clamp(
    headingDelta * HEADING_GAIN,
    -limits.maxTurnRate,
    limits.maxTurnRate
  );
  const turnRate = moveTowards(
    state.turnRate,
    desiredTurnRate,
    limits.angularAcceleration * dt
  );
  const heading = normalizeAngle(state.heading + turnRate * dt);
  const turnIntensity = clamp(Math.abs(turnRate) / limits.maxTurnRate, 0, 1);
  const targetSpeed = limits.cruiseSpeed * (1 - TURN_SLOWDOWN * turnIntensity);
  const damping =
    targetSpeed < state.currentSpeed ? SLOWDOWN_DAMPING : RECOVERY_DAMPING;
  const currentSpeed =
    targetSpeed + (state.currentSpeed - targetSpeed) * Math.exp(-damping * dt);

  return {
    x: state.x + Math.cos(heading) * currentSpeed * dt,
    y: state.y + Math.sin(heading) * currentSpeed * dt,
    heading,
    turnRate,
    currentSpeed,
  };
}

export function buildFishSpine({
  length,
  phase,
  wavenumber,
  swimAmplitudeMult,
  turnRate,
  maxTurnRate,
  segments = 12,
}: FishSpineInput): FishSpinePoint[] {
  const normalizedTurn =
    maxTurnRate > Number.EPSILON ? clamp(turnRate / maxTurnRate, -1, 1) : 0;
  const turnIntensity = Math.abs(normalizedTurn);
  const points: FishSpinePoint[] = [];

  for (let index = 0; index <= segments; index++) {
    const s = index / segments;
    const tailBias = s * s;
    const turnOffset = -normalizedTurn * length * 0.22 * tailBias;
    const swimAmplitude =
      length * 0.18 * tailBias * swimAmplitudeMult * (1 + turnIntensity * 0.25);

    points.push({
      x: index === 0 ? 0 : -length * s,
      y: turnOffset + Math.sin(phase - wavenumber * s) * swimAmplitude,
      tx: 0,
      ty: 0,
    });
  }

  for (let index = 0; index <= segments; index++) {
    const previous = points[Math.max(index - 1, 0)];
    const next = points[Math.min(index + 1, segments)];
    const dx = previous.x - next.x;
    const dy = previous.y - next.y;
    const tangentLength = Math.hypot(dx, dy);

    if (tangentLength <= Number.EPSILON) {
      points[index].tx = 1;
      points[index].ty = 0;
    } else {
      points[index].tx = dx / tangentLength;
      points[index].ty = dy / tangentLength;
    }
  }

  return points;
}
