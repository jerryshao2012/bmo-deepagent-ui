import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PresentationChrome } from "../src/app/intro/presentation-chrome";
import {
  INTRO_SLIDES,
  type IntroSlideId,
} from "../src/app/intro/presentation-navigation";

afterEach(cleanup);

const defaultProps = {
  activeSlideId: "phase1" as IntroSlideId,
  isFullscreen: false,
  fullscreenStatus: "",
  suspended: false,
  onNavigate: (_id: IntroSlideId) => undefined,
  onToggleFullscreen: () => undefined,
};

function renderChrome(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <PresentationChrome
      {...defaultProps}
      {...overrides}
    />
  );
}

test("renders progress and counter for active phase 1", () => {
  renderChrome();

  const progress = screen.getByRole("progressbar");
  assert.equal(progress.getAttribute("aria-valuemin"), "1");
  assert.equal(progress.getAttribute("aria-valuemax"), "6");
  assert.equal(progress.getAttribute("aria-valuenow"), "3");
  assert.match(progress.getAttribute("aria-label") || "", /Slide progress/);
  assert.equal(progress.firstElementChild?.style.transform, "scaleX(0.5)");
  assert.ok(screen.getByText("03 / 06"));
});

test("uses hero consistently for an invalid runtime slide ID", () => {
  renderChrome({ activeSlideId: "missing" as IntroSlideId });

  assert.equal(
    screen.getByRole("progressbar").getAttribute("aria-valuenow"),
    "1"
  );
  assert.ok(screen.getByText("01 / 06"));
  assert.equal(
    screen.getByRole("status").textContent,
    "Slide 1 of 6: Overview"
  );
  assert.equal(
    screen
      .getByRole("button", { name: "Go to slide 1: Overview" })
      .getAttribute("aria-current"),
    "step"
  );
});

test("renders one accessible dot per navigation slide and marks active slide", () => {
  renderChrome();

  assert.equal(new Set(INTRO_SLIDES.map((slide) => slide.id)).size, 6);
  const dots = INTRO_SLIDES.map((slide, index) =>
    screen.getByRole("button", {
      name: `Go to slide ${index + 1}: ${slide.label}`,
    })
  );

  assert.equal(dots.length, 6);
  assert.deepEqual(
    dots.map((dot) => dot.getAttribute("aria-label")),
    INTRO_SLIDES.map(
      (slide, index) => `Go to slide ${index + 1}: ${slide.label}`
    )
  );
  assert.equal(dots[2].getAttribute("aria-current"), "step");
  assert.equal(dots[0].hasAttribute("aria-current"), false);
});

test("navigates to clicked dot", () => {
  const navigated: IntroSlideId[] = [];
  renderChrome({ onNavigate: (id) => navigated.push(id) });

  fireEvent.click(
    screen.getByRole("button", { name: "Go to slide 6: Launch" })
  );

  assert.deepEqual(navigated, ["launch"]);
});

test("toggles fullscreen and updates its accessible label", () => {
  let toggles = 0;
  const view = renderChrome({ onToggleFullscreen: () => toggles++ });

  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  assert.equal(toggles, 1);

  view.rerender(
    <PresentationChrome
      {...defaultProps}
      isFullscreen
      onToggleFullscreen={() => toggles++}
    />
  );
  assert.ok(screen.getByRole("button", { name: "Exit fullscreen" }));
});

test("shows keyboard hint with arrow keys and F", () => {
  renderChrome();

  const hint = screen.getByText(/Arrow keys to navigate/);
  const hintContainer = hint.parentElement;

  assert.ok(hintContainer);
  assert.equal(hintContainer.classList.contains("pointer-events-none"), true);
  assert.match(hintContainer.textContent || "", /Arrow/);
  assert.match(hintContainer.textContent || "", /F/);
});

test("keeps overlay pointer-transparent while controls intercept input", () => {
  renderChrome();

  const overlay = screen.getByRole("group", { name: "Presentation controls" });
  const navigation = screen.getByRole("navigation", {
    name: "Presentation slides",
  });
  const fullscreen = screen.getByRole("button", { name: "Enter fullscreen" });

  assert.equal(overlay.classList.contains("pointer-events-none"), true);
  assert.equal(navigation.classList.contains("pointer-events-auto"), true);
  assert.equal(fullscreen.classList.contains("pointer-events-auto"), true);
  assert.equal(
    fullscreen.hasAttribute("data-presentation-fullscreen-control"),
    true
  );
});

test("disables every chrome input while the preview dialog suspends presentation", () => {
  const navigated: IntroSlideId[] = [];
  let fullscreenToggles = 0;
  renderChrome({
    suspended: true,
    onNavigate: (id) => navigated.push(id),
    onToggleFullscreen: () => fullscreenToggles++,
  });

  const dots = INTRO_SLIDES.map((slide, index) =>
    screen.getByRole("button", {
      name: `Go to slide ${index + 1}: ${slide.label}`,
    })
  );
  const fullscreen = screen.getByRole("button", {
    name: "Enter fullscreen",
  });

  for (const input of [...dots, fullscreen]) {
    assert.equal(input.hasAttribute("disabled"), true);
    fireEvent.click(input);
  }
  assert.deepEqual(navigated, []);
  assert.equal(fullscreenToggles, 0);
});

test("uses motion-safe transforms for the fullscreen control", () => {
  renderChrome();

  const fullscreen = screen.getByRole("button", {
    name: "Enter fullscreen",
  });
  assert.equal(fullscreen.classList.contains("motion-safe:transition"), true);
  assert.equal(
    fullscreen.classList.contains("motion-safe:active:scale-95"),
    true
  );
  assert.equal(fullscreen.classList.contains("active:scale-95"), false);
});

test("activates dots and fullscreen controls from the keyboard", async () => {
  const user = userEvent.setup();
  const navigated: IntroSlideId[] = [];
  let fullscreenToggles = 0;
  renderChrome({
    onNavigate: (id) => navigated.push(id),
    onToggleFullscreen: () => fullscreenToggles++,
  });

  const launch = screen.getByRole("button", { name: "Go to slide 6: Launch" });
  launch.focus();
  await user.keyboard("{Enter}");
  assert.deepEqual(navigated, ["launch"]);

  const fullscreen = screen.getByRole("button", { name: "Enter fullscreen" });
  fullscreen.focus();
  await user.keyboard("{Enter}");
  assert.equal(fullscreenToggles, 1);
});

test("announces current slide and fullscreen status after rerender", () => {
  const view = renderChrome({ fullscreenStatus: "Entered fullscreen" });

  const status = screen.getByRole("status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.equal(
    status.textContent,
    "Slide 3 of 6: Phase 1: Ground. Entered fullscreen"
  );

  view.rerender(
    <PresentationChrome
      {...defaultProps}
      activeSlideId="phase2"
    />
  );
  assert.equal(status.textContent, "Slide 4 of 6: Phase 2: Research");
});
