import assert from "node:assert/strict";
import test from "node:test";

import {
  navigateToIntroPhase,
  type PhaseNavigationEnvironment,
  type PhaseNavigationEvent,
} from "../src/app/intro/phase-navigation";

function createEvent(
  overrides: Partial<PhaseNavigationEvent> = {}
): PhaseNavigationEvent & { preventDefaultCalls: number } {
  return {
    altKey: false,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefaultCalls: 0,
    preventDefault() {
      this.preventDefaultCalls += 1;
    },
    ...overrides,
  };
}

function createEnvironment({
  currentHash = "",
  reducedMotion = false,
  targetExists = true,
}: {
  currentHash?: string;
  reducedMotion?: boolean;
  targetExists?: boolean;
} = {}) {
  const calls = {
    findTarget: [] as string[],
    pushHash: [] as string[],
    scrollIntoView: [] as ScrollIntoViewOptions[],
  };
  const environment: PhaseNavigationEnvironment = {
    currentHash: () => currentHash,
    findTarget: (id) => {
      calls.findTarget.push(id);
      return targetExists
        ? {
            scrollIntoView(options) {
              calls.scrollIntoView.push(options);
            },
          }
        : null;
    },
    prefersReducedMotion: () => reducedMotion,
    pushHash: (hash) => calls.pushHash.push(hash),
  };

  return { calls, environment };
}

test("ordinary phase activation prevents native navigation, pushes hash, and scrolls smoothly", () => {
  const event = createEvent();
  const { calls, environment } = createEnvironment({ currentHash: "#phase1" });

  const handled = navigateToIntroPhase(event, "phase2", environment);

  assert.equal(handled, true);
  assert.equal(event.preventDefaultCalls, 1);
  assert.deepEqual(calls.findTarget, ["phase2"]);
  assert.deepEqual(calls.pushHash, ["#phase2"]);
  assert.deepEqual(calls.scrollIntoView, [
    { behavior: "smooth", block: "start" },
  ]);
});

test("reduced motion on the current phase prevents native navigation without duplicating history", () => {
  const event = createEvent();
  const { calls, environment } = createEnvironment({
    currentHash: "#phase2",
    reducedMotion: true,
  });

  const handled = navigateToIntroPhase(event, "phase2", environment);

  assert.equal(handled, true);
  assert.equal(event.preventDefaultCalls, 1);
  assert.deepEqual(calls.findTarget, ["phase2"]);
  assert.deepEqual(calls.pushHash, []);
  assert.deepEqual(calls.scrollIntoView, [
    { behavior: "auto", block: "start" },
  ]);
});

test("modified and non-primary clicks keep native behavior without looking up a target", () => {
  const ignoredActivations: Partial<PhaseNavigationEvent>[] = [
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { button: 1 },
  ];

  for (const overrides of ignoredActivations) {
    const event = createEvent(overrides);
    const { calls, environment } = createEnvironment();

    const handled = navigateToIntroPhase(event, "phase3", environment);

    assert.equal(handled, false);
    assert.equal(event.preventDefaultCalls, 0);
    assert.deepEqual(calls.findTarget, []);
    assert.deepEqual(calls.pushHash, []);
    assert.deepEqual(calls.scrollIntoView, []);
  }
});

test("missing destination keeps native navigation untouched", () => {
  const event = createEvent();
  const { calls, environment } = createEnvironment({ targetExists: false });

  const handled = navigateToIntroPhase(event, "phase3", environment);

  assert.equal(handled, false);
  assert.equal(event.preventDefaultCalls, 0);
  assert.deepEqual(calls.findTarget, ["phase3"]);
  assert.deepEqual(calls.pushHash, []);
  assert.deepEqual(calls.scrollIntoView, []);
});
