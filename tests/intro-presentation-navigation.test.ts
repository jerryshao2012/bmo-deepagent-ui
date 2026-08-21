import assert from "node:assert/strict";
import test from "node:test";

import {
  INTRO_SLIDES,
  adjacentIntroSlide,
  directionForPresentationKey,
  isPresentationEditableTarget,
  isPresentationInteractiveTarget,
  shouldLeaveOverflowingSlide,
  type IntroSlideId,
} from "../src/app/intro/presentation-navigation";

test("defines the six intro presentation slides in order and clamps adjacency", () => {
  assert.deepEqual(INTRO_SLIDES, [
    { id: "hero", label: "Overview" },
    { id: "preview", label: "Workspace preview" },
    { id: "phase1", label: "Phase 1: Ground" },
    { id: "phase2", label: "Phase 2: Research" },
    { id: "phase3", label: "Phase 3: Review" },
    { id: "launch", label: "Launch" },
  ]);

  assert.equal(adjacentIntroSlide("hero", -1), "hero");
  assert.equal(adjacentIntroSlide("hero", 1), "preview");
  assert.equal(adjacentIntroSlide("phase2", -1), "phase1");
  assert.equal(adjacentIntroSlide("phase2", 1), "phase3");
  assert.equal(adjacentIntroSlide("launch", 1), "launch");
  assert.equal(
    adjacentIntroSlide("missing" as IntroSlideId, 1),
    "hero",
    "invalid runtime IDs fall back to the first slide"
  );
});

test("maps presentation keys to forward, backward, or no direction", () => {
  for (const key of ["ArrowRight", "ArrowDown", "PageDown", " "]) {
    assert.equal(directionForPresentationKey(key, false), 1, key);
  }
  for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) {
    assert.equal(directionForPresentationKey(key, false), -1, key);
  }
  assert.equal(directionForPresentationKey(" ", true), -1);
  assert.equal(directionForPresentationKey("ArrowRight", true), 1);
  assert.equal(directionForPresentationKey("Enter", false), null);
});

test("leaves fitting slides without waiting for a vertical boundary", () => {
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 64, bottom: 864, viewportHeight: 800 },
      1,
      64
    ),
    true
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 0, bottom: 800, viewportHeight: 800 },
      -1,
      64
    ),
    true
  );
});

test("leaves a taller slide only at the direction boundary", () => {
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: -10, bottom: 866, viewportHeight: 800 },
      1,
      64
    ),
    true
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: -10, bottom: 867, viewportHeight: 800 },
      1,
      64
    ),
    false
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 70, bottom: 900, viewportHeight: 800 },
      -1,
      72
    ),
    true
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 69, bottom: 900, viewportHeight: 800 },
      -1,
      72
    ),
    false
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 100, bottom: 900, viewportHeight: 800 },
      -1,
      72
    ),
    true
  );
});

test("classifies editable presentation targets", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input", "tExTaReA"]) {
    assert.equal(isPresentationEditableTarget({ tagName }), true, tagName);
  }
  assert.equal(isPresentationEditableTarget({ isContentEditable: true }), true);
  assert.equal(isPresentationEditableTarget({ tagName: "BUTTON" }), false);
  assert.equal(isPresentationEditableTarget(null), false);
});

test("classifies interactive presentation targets", () => {
  for (const target of [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { isContentEditable: true },
    { tagName: "BUTTON" },
    { tagName: "A" },
    { tagName: "bUtToN" },
    { tagName: "a" },
  ]) {
    assert.equal(isPresentationInteractiveTarget(target), true);
  }
  assert.equal(isPresentationInteractiveTarget({ tagName: "DIV" }), false);
  assert.equal(isPresentationInteractiveTarget(null), false);
});
