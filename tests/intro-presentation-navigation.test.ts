import assert from "node:assert/strict";
import test from "node:test";

import {
  INTRO_SLIDES,
  adjacentIntroSlide,
  directionForPresentationKey,
  isPresentationEditableTarget,
  isPresentationInteractiveTarget,
  shouldLeaveOverflowingSlide,
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
});

test("maps presentation keys to forward, backward, or no direction", () => {
  for (const key of ["ArrowRight", "ArrowDown", "PageDown", "Space"]) {
    assert.equal(directionForPresentationKey(key, false), 1, key);
  }
  for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) {
    assert.equal(directionForPresentationKey(key, false), -1, key);
  }
  assert.equal(directionForPresentationKey("Space", true), -1);
  assert.equal(directionForPresentationKey("ArrowRight", true), 1);
  assert.equal(directionForPresentationKey("Enter", false), null);
});

test("leaves an overflowing slide only at the direction boundary", () => {
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 120, bottom: 798, viewportHeight: 800 },
      1
    ),
    true
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 120, bottom: 810, viewportHeight: 800 },
      1
    ),
    false
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 72, bottom: 700, viewportHeight: 800 },
      -1,
      72
    ),
    true
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 68, bottom: 700, viewportHeight: 800 },
      -1,
      72
    ),
    false
  );
  assert.equal(
    shouldLeaveOverflowingSlide(
      { top: 100, bottom: 700, viewportHeight: 800 },
      -1,
      72
    ),
    true
  );
});

test("classifies editable presentation targets", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(isPresentationEditableTarget({ tagName }), true, tagName);
  }
  assert.equal(isPresentationEditableTarget({ isContentEditable: true }), true);
  assert.equal(isPresentationEditableTarget({ tagName: "BUTTON" }), false);
});

test("classifies interactive presentation targets", () => {
  for (const target of [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { isContentEditable: true },
    { tagName: "BUTTON" },
    { tagName: "A" },
  ]) {
    assert.equal(isPresentationInteractiveTarget(target), true);
  }
  assert.equal(isPresentationInteractiveTarget({ tagName: "DIV" }), false);
});
