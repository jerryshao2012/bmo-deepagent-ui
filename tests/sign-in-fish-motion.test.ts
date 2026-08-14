import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildFishSpine,
  normalizeAngle,
  resolveDesiredHeading,
  shortestAngleDelta,
  stepFishMotion,
  type FishMotionLimits,
  type FishMotionState,
} from "../src/app/components/sign-in-fish-motion";

const degrees = (value: number) => (value * Math.PI) / 180;

test("normalizes angles to the canonical range", () => {
  assert.equal(normalizeAngle(Math.PI * 3), -Math.PI);
  assert.equal(normalizeAngle(-Math.PI * 3), -Math.PI);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 4 + 0.25) - 0.25) < 1e-12);
});

test("chooses the shortest turn across the angle boundary", () => {
  assert.ok(
    Math.abs(shortestAngleDelta(degrees(179), degrees(-179)) - degrees(2)) <
      1e-12
  );
  assert.ok(
    Math.abs(shortestAngleDelta(degrees(-179), degrees(179)) + degrees(2)) <
      1e-12
  );
});

const adultLimits: FishMotionLimits = {
  cruiseSpeed: 30,
  maxTurnRate: 0.55,
  angularAcceleration: 1.2,
};

const createState = (
  overrides: Partial<FishMotionState> = {}
): FishMotionState => ({
  x: 0,
  y: 0,
  heading: 0,
  turnRate: 0,
  currentSpeed: 30,
  ...overrides,
});

test("eases pointer avoidance into the ambient heading and stays finite at overlap", () => {
  assert.equal(
    resolveDesiredHeading({
      fishX: 0,
      fishY: 0,
      heading: 0,
      ambientHeading: Math.PI / 2,
      pointerX: 1000,
      pointerY: 1000,
    }),
    Math.PI / 2
  );

  const nearbyHeading = resolveDesiredHeading({
    fishX: 0,
    fishY: 0,
    heading: 0,
    ambientHeading: Math.PI / 2,
    pointerX: 0,
    pointerY: 75,
  });
  assert.ok(nearbyHeading < Math.PI / 2);
  assert.ok(nearbyHeading > 0);

  const overlapHeading = resolveDesiredHeading({
    fishX: 0,
    fishY: 0,
    heading: 0,
    ambientHeading: 0,
    pointerX: 0,
    pointerY: 0,
  });
  assert.ok(Number.isFinite(overlapHeading));
});

test("bounds angular acceleration, turn rate, and per-frame heading change", () => {
  const dt = 1 / 60;
  const next = stepFishMotion(createState(), Math.PI / 2, adultLimits, dt);

  assert.ok(Math.abs(next.turnRate) <= adultLimits.angularAcceleration * dt);
  assert.ok(Math.abs(next.turnRate) <= adultLimits.maxTurnRate);
  assert.ok(
    Math.abs(shortestAngleDelta(0, next.heading)) <=
      adultLimits.maxTurnRate * dt
  );
});

test("slows gently in a hard turn and recovers cruise speed without reversing", () => {
  let state = createState();
  for (let frame = 0; frame < 120; frame++) {
    state = stepFishMotion(state, Math.PI, adultLimits, 1 / 60);
  }

  assert.ok(state.currentSpeed >= adultLimits.cruiseSpeed * 0.82);
  assert.ok(state.currentSpeed < adultLimits.cruiseSpeed);

  for (let frame = 0; frame < 180; frame++) {
    state = stepFishMotion(state, state.heading, adultLimits, 1 / 60);
  }

  assert.ok(state.currentSpeed > adultLimits.cruiseSpeed * 0.99);
  assert.ok(state.currentSpeed <= adultLimits.cruiseSpeed);
});

test("produces equivalent motion at 60Hz and 120Hz", () => {
  const simulate = (hz: number) => {
    let state = createState({ heading: degrees(179) });
    for (let frame = 0; frame < hz * 2; frame++) {
      state = stepFishMotion(state, degrees(-179), adultLimits, 1 / hz);
    }
    return state;
  };

  const at60Hz = simulate(60);
  const at120Hz = simulate(120);

  assert.ok(
    Math.abs(shortestAngleDelta(at60Hz.heading, at120Hz.heading)) < 0.03
  );
  assert.ok(Math.hypot(at60Hz.x - at120Hz.x, at60Hz.y - at120Hz.y) < 1.5);
});

test("clamps long frames and preserves legacy straight-line displacement", () => {
  const afterLongFrame = stepFishMotion(createState(), 0, adultLimits, 2);
  assert.ok(afterLongFrame.x <= adultLimits.cruiseSpeed / 30 + 1e-12);

  let state = createState();
  for (let frame = 0; frame < 60; frame++) {
    state = stepFishMotion(state, 0, adultLimits, 1 / 60);
  }
  assert.ok(Math.abs(state.x - adultLimits.cruiseSpeed) < 1e-9);
});

test("keeps long-running motion state finite", () => {
  let state = createState();
  for (let frame = 0; frame < 5000; frame++) {
    const desiredHeading = Math.sin(frame * 0.017) * Math.PI * 1.6;
    state = stepFishMotion(state, desiredHeading, adultLimits, 1 / 120);
    for (const value of Object.values(state)) {
      assert.ok(Number.isFinite(value));
    }
  }
});

test("builds a head-led spine with finite normalized tangents", () => {
  const spine = buildFishSpine({
    length: 24,
    phase: 0.8,
    wavenumber: 2.6,
    swimAmplitudeMult: 1,
    turnRate: 0,
    maxTurnRate: 0.65,
  });

  assert.equal(spine.length, 13);
  assert.equal(spine[0].x, 0);
  assert.equal(spine[0].y, 0);
  const firstSegmentLength = Math.hypot(
    spine[0].x - spine[1].x,
    spine[0].y - spine[1].y
  );
  assert.ok(
    Math.abs(spine[0].tx - (spine[0].x - spine[1].x) / firstSegmentLength) <
      1e-12
  );
  assert.ok(
    Math.abs(spine[0].ty - (spine[0].y - spine[1].y) / firstSegmentLength) <
      1e-12
  );
  assert.equal(spine.at(-1)?.x, -24);
  for (const point of spine) {
    assert.ok(Object.values(point).every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(point.tx, point.ty) - 1) < 1e-12);
  }
});

test("mirrors bounded turn curvature around the boosted turning wave", () => {
  const common = {
    length: 24,
    phase: 1.1,
    wavenumber: 2.6,
    swimAmplitudeMult: 1,
    maxTurnRate: 0.65,
  };
  const leftTurn = buildFishSpine({ ...common, turnRate: 0.65 });
  const rightTurn = buildFishSpine({ ...common, turnRate: -0.65 });

  for (let index = 0; index < leftTurn.length; index++) {
    const s = index / (leftTurn.length - 1);
    const turningWave =
      Math.sin(common.phase - common.wavenumber * s) *
      common.length *
      0.18 *
      s *
      s *
      common.swimAmplitudeMult *
      1.25;
    const leftOffset = leftTurn[index].y - turningWave;
    const rightOffset = rightTurn[index].y - turningWave;
    assert.ok(Math.abs(leftOffset + rightOffset) < 1e-12);
    assert.ok(Math.abs(leftOffset) <= common.length * 0.22 + 1e-12);
  }

  const leftTurnWithoutWave = buildFishSpine({
    ...common,
    phase: 0,
    wavenumber: 0,
    turnRate: 0.65,
  });
  const rightTurnWithoutWave = buildFishSpine({
    ...common,
    phase: 0,
    wavenumber: 0,
    turnRate: -0.65,
  });
  for (let index = 0; index < leftTurnWithoutWave.length; index++) {
    const leftTangent = leftTurnWithoutWave[index];
    const rightTangent = rightTurnWithoutWave[index];
    assert.ok(Number.isFinite(leftTangent.tx));
    assert.ok(Number.isFinite(leftTangent.ty));
    assert.ok(Number.isFinite(rightTangent.tx));
    assert.ok(Number.isFinite(rightTangent.ty));
    assert.ok(Math.abs(leftTangent.tx - rightTangent.tx) < 1e-12);
    assert.ok(Math.abs(leftTangent.ty + rightTangent.ty) < 1e-12);
  }
});

test("the login canvas uses the tested motion and spine helpers", () => {
  const source = readFileSync(
    new URL("../src/app/components/SignInAnimation.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /stepFishMotion\(/);
  assert.match(source, /buildFishSpine\(/);
  assert.doesNotMatch(source, /p\.angle \+=/);
  assert.doesNotMatch(source, /p\.angle = Math\.atan2/);
});
