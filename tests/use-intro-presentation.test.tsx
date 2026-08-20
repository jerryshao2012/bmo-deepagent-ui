import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react";

import {
  INTRO_SLIDES,
  type IntroSlideId,
} from "../src/app/intro/presentation-navigation";
import { useIntroPresentation } from "../src/app/intro/use-intro-presentation";

type SlideElements = Record<IntroSlideId, HTMLElement>;
type PropertySnapshot = {
  target: object;
  property: PropertyKey;
  descriptor: PropertyDescriptor | undefined;
};

const originalRootClassName = document.documentElement.className;
const originalProperties: PropertySnapshot[] = [
  [window, "innerHeight"],
  [window, "matchMedia"],
  [window, "IntersectionObserver"],
  [globalThis, "IntersectionObserver"],
  [window, "setTimeout"],
  [window, "clearTimeout"],
  [window.history, "pushState"],
  [window.history, "replaceState"],
  [HTMLElement.prototype, "scrollIntoView"],
  [document, "fullscreenElement"],
  [document, "webkitFullscreenElement"],
  [document, "exitFullscreen"],
  [document, "webkitExitFullscreen"],
  [document.documentElement, "requestFullscreen"],
  [document.documentElement, "webkitRequestFullscreen"],
].map(([target, property]) => ({
  target,
  property,
  descriptor: Object.getOwnPropertyDescriptor(target, property),
}));

function restoreOriginalProperties() {
  originalProperties.forEach(({ target, property, descriptor }) => {
    if (descriptor) {
      Object.defineProperty(target, property, descriptor);
    } else {
      Reflect.deleteProperty(target, property);
    }
  });
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly observed: Element[] = [];
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve(target: Element) {
    const index = this.observed.indexOf(target);
    if (index >= 0) this.observed.splice(index, 1);
  }

  disconnect() {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(target: Element, isIntersecting = true) {
    this.emitMany([{ target, isIntersecting }]);
  }

  emitMany(entries: Array<{ target: Element; isIntersecting?: boolean }>) {
    this.callback(
      entries.map(
        ({ target, isIntersecting = true }) =>
          ({
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
          } as IntersectionObserverEntry)
      ),
      this as unknown as IntersectionObserver
    );
  }
}

let scrollCalls: Array<{
  element: HTMLElement;
  options: ScrollIntoViewOptions;
}> = [];
let reducedMotion = false;
let fullscreenTarget: Element | null = null;
let requestFullscreenCalls = 0;
let exitFullscreenCalls = 0;
let webkitRequestFullscreenCalls = 0;
let webkitExitFullscreenCalls = 0;

function makeRect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 1024,
    height: bottom - top,
    top,
    right: 1024,
    bottom,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function setRect(element: HTMLElement, top: number, bottom: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => makeRect(top, bottom),
  });
}

function setupSlides(): SlideElements {
  const slides = {} as SlideElements;
  document.body.replaceChildren();

  INTRO_SLIDES.forEach((slide) => {
    const element = document.createElement("section");
    element.id = slide.id;
    element.dataset.introSlide = "";
    setRect(element, 0, 800);
    document.body.append(element);
    slides[slide.id] = element;
  });

  return slides;
}

function setHash(hash = "") {
  window.history.replaceState(null, "", `/intro${hash}`);
}

function observeHistory() {
  const calls: Array<"push" | "replace"> = [];
  const pushState = window.history.pushState;
  const replaceState = window.history.replaceState;

  Object.defineProperties(window.history, {
    pushState: {
      configurable: true,
      value: function pushStateSpy(...args: Parameters<History["pushState"]>) {
        calls.push("push");
        return pushState.apply(window.history, args);
      },
    },
    replaceState: {
      configurable: true,
      value: function replaceStateSpy(
        ...args: Parameters<History["replaceState"]>
      ) {
        calls.push("replace");
        return replaceState.apply(window.history, args);
      },
    },
  });

  return {
    calls,
    reset() {
      calls.splice(0);
    },
  };
}

function keydown(
  key: string,
  target: EventTarget = document,
  options: KeyboardEventInit = {}
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

function wheel(deltaY: number) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY,
  });
  document.dispatchEvent(event);
  return event;
}

function touch(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  clientY: number | number[]
) {
  const clientYs = Array.isArray(clientY) ? clientY : [clientY];
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = clientYs.map((value) => ({ clientY: value }));
  if (type === "touchstart" || type === "touchmove") {
    Object.defineProperty(event, "touches", {
      configurable: true,
      value: touches,
    });
  }
  if (type === "touchend") {
    Object.defineProperty(event, "changedTouches", {
      configurable: true,
      value: touches,
    });
  }
  document.dispatchEvent(event);
  return event;
}

function installFullscreen(
  options: {
    request?: () => Promise<void>;
    exit?: () => Promise<void>;
    webkitRequest?: () => Promise<void>;
    webkitExit?: () => Promise<void>;
  } = {}
) {
  Object.defineProperties(document, {
    fullscreenElement: {
      configurable: true,
      get: () => fullscreenTarget,
    },
    webkitFullscreenElement: {
      configurable: true,
      get: () => fullscreenTarget,
    },
  });

  Object.defineProperties(document.documentElement, {
    requestFullscreen: {
      configurable: true,
      value:
        options.request ??
        (() => {
          requestFullscreenCalls += 1;
          fullscreenTarget = document.documentElement;
          return Promise.resolve();
        }),
    },
    webkitRequestFullscreen: {
      configurable: true,
      value:
        options.webkitRequest ??
        (() => {
          webkitRequestFullscreenCalls += 1;
          fullscreenTarget = document.documentElement;
          return Promise.resolve();
        }),
    },
  });

  Object.defineProperties(document, {
    exitFullscreen: {
      configurable: true,
      value:
        options.exit ??
        (() => {
          exitFullscreenCalls += 1;
          fullscreenTarget = null;
          return Promise.resolve();
        }),
    },
    webkitExitFullscreen: {
      configurable: true,
      value:
        options.webkitExit ??
        (() => {
          webkitExitFullscreenCalls += 1;
          fullscreenTarget = null;
          return Promise.resolve();
        }),
    },
  });
}

function renderPresentation(suspended = false) {
  return renderHook(
    ({ suspended: isSuspended }) =>
      useIntroPresentation({ suspended: isSuspended }),
    { initialProps: { suspended } }
  );
}

beforeEach(() => {
  scrollCalls = [];
  reducedMotion = false;
  fullscreenTarget = null;
  requestFullscreenCalls = 0;
  exitFullscreenCalls = 0;
  webkitRequestFullscreenCalls = 0;
  webkitExitFullscreenCalls = 0;
  MockIntersectionObserver.instances = [];
  setHash();
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: function scrollIntoView(
      this: HTMLElement,
      options: ScrollIntoViewOptions
    ) {
      scrollCalls.push({ element: this, options });
    },
  });
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: MockIntersectionObserver,
  });
  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    value: MockIntersectionObserver,
  });
  installFullscreen();
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.documentElement.className = originalRootClassName;
  restoreOriginalProperties();
});

test("mounts at hero and replaces missing or invalid hashes with hero", () => {
  const slides = setupSlides();
  const missing = renderPresentation();

  assert.equal(missing.result.current.activeSlideId, "hero");
  assert.equal(missing.result.current.activeSlideIndex, 0);
  assert.equal(window.location.hash, "#hero");
  assert.equal(slides.hero.classList.contains("is-active"), true);
  assert.deepEqual(scrollCalls.at(-1), {
    element: slides.hero,
    options: { behavior: "smooth", block: "start" },
  });
  assert.equal(
    document.documentElement.classList.contains("intro-presentation-ready"),
    true
  );
  missing.unmount();

  setHash("#missing");
  const invalid = renderPresentation();
  assert.equal(invalid.result.current.activeSlideId, "hero");
  assert.equal(window.location.hash, "#hero");
});

test("restores a valid hash with reduced-motion scrolling", () => {
  const slides = setupSlides();
  reducedMotion = true;
  setHash("#phase2");

  const { result } = renderPresentation();

  assert.equal(result.current.activeSlideId, "phase2");
  assert.equal(result.current.activeSlideIndex, 3);
  assert.equal(window.location.hash, "#phase2");
  assert.deepEqual(scrollCalls.at(-1), {
    element: slides.phase2,
    options: { behavior: "auto", block: "start" },
  });
  assert.equal(slides.phase2.classList.contains("is-active"), true);
});

test("goToSlide replaces history by default", () => {
  setupSlides();
  const { result } = renderPresentation();
  const history = observeHistory();

  act(() => result.current.goToSlide("phase1"));

  assert.deepEqual(history.calls, ["replace"]);
  assert.equal(window.location.hash, "#phase1");
});

test("maps keyboard directions, Home and End while clamping slide navigation", () => {
  const slides = setupSlides();
  const { result } = renderPresentation();

  act(() => keydown("ArrowRight"));
  assert.equal(result.current.activeSlideId, "preview");
  act(() => keydown("PageDown"));
  assert.equal(result.current.activeSlideId, "phase1");
  act(() => keydown(" "));
  assert.equal(result.current.activeSlideId, "phase2");
  setRect(slides.phase2, 62, 800);
  act(() => keydown(" ", document, { shiftKey: true }));
  assert.equal(result.current.activeSlideId, "phase1");
  act(() => keydown("Home"));
  assert.equal(result.current.activeSlideId, "hero");
  act(() => keydown("End"));
  assert.equal(result.current.activeSlideId, "launch");

  let clamped!: KeyboardEvent;
  act(() => {
    clamped = keydown("ArrowRight");
  });
  assert.equal(clamped.defaultPrevented, true);
  assert.equal(result.current.activeSlideId, "launch");
  assert.equal(window.location.hash, "#launch");
});

test("endpoint keyboard, wheel, and touch controls do not mutate history", () => {
  setupSlides();
  const { result } = renderPresentation();
  const history = observeHistory();

  act(() => keydown("ArrowLeft"));
  act(() => wheel(-80));
  touch("touchstart", 400);
  act(() => {
    touch("touchmove", 460);
    touch("touchend", 460);
  });
  assert.deepEqual(history.calls, []);
  assert.equal(result.current.activeSlideId, "hero");

  act(() => result.current.goToSlide("launch", "replace"));
  history.reset();
  act(() => keydown("ArrowRight"));
  act(() => wheel(80));
  touch("touchstart", 400);
  act(() => {
    touch("touchmove", 340);
    touch("touchend", 340);
  });
  assert.deepEqual(history.calls, []);
  assert.equal(result.current.activeSlideId, "launch");
});

test("suspension blocks every presentation input and re-enables controls on close", async () => {
  setupSlides();
  const { result, rerender } = renderPresentation(true);
  const initialHash = window.location.hash;
  const initialScrollCount = scrollCalls.length;

  for (const [key, options] of [
    ["ArrowRight", {}],
    ["ArrowLeft", {}],
    ["PageDown", {}],
    ["PageUp", {}],
    [" ", {}],
    [" ", { shiftKey: true }],
    ["Home", {}],
    ["End", {}],
    ["f", {}],
  ] as const) {
    assert.equal(keydown(key, document, options).defaultPrevented, false, key);
  }

  assert.equal(wheel(80).defaultPrevented, false);
  assert.equal(touch("touchstart", 400).defaultPrevented, false);
  assert.equal(touch("touchend", 300).defaultPrevented, false);
  assert.equal(result.current.activeSlideId, "hero");
  assert.equal(window.location.hash, initialHash);
  assert.equal(scrollCalls.length, initialScrollCount);
  assert.equal(requestFullscreenCalls, 0);

  rerender({ suspended: false });
  let enabled!: KeyboardEvent;
  act(() => {
    enabled = keydown("ArrowRight");
  });
  assert.equal(enabled.defaultPrevented, true);
  assert.equal(result.current.activeSlideId, "preview");
  assert.equal(window.location.hash, "#preview");
  assert.equal(scrollCalls.length, initialScrollCount + 1);

  await act(async () => {
    keydown("f");
    await Promise.resolve();
  });
  assert.equal(requestFullscreenCalls, 1);

  act(() => wheel(80));
  assert.equal(result.current.activeSlideId, "phase1");

  touch("touchstart", 400);
  let touchMove!: Event;
  let touchEnd!: Event;
  act(() => {
    touchMove = touch("touchmove", 340);
    touchEnd = touch("touchend", 340);
  });
  assert.equal(touchMove.defaultPrevented, true);
  assert.equal(touchEnd.defaultPrevented, true);
  assert.equal(result.current.activeSlideId, "phase2");
});

test("preserves editable targets and button Space while allowing button F fullscreen", async () => {
  setupSlides();
  const { result } = renderPresentation();
  const textarea = document.createElement("textarea");
  const editor = document.createElement("div");
  const button = document.createElement("button");
  editor.contentEditable = "true";
  Object.defineProperty(editor, "isContentEditable", { value: true });
  document.body.append(textarea, editor, button);

  textarea.focus();
  assert.equal(keydown("ArrowRight", textarea).defaultPrevented, false);
  assert.equal(keydown("f", textarea).defaultPrevented, false);
  editor.focus();
  assert.equal(keydown("ArrowRight", editor).defaultPrevented, false);
  assert.equal(keydown("f", editor).defaultPrevented, false);
  assert.equal(requestFullscreenCalls, 0);
  assert.equal(result.current.activeSlideId, "hero");

  button.focus();
  assert.equal(keydown(" ", button).defaultPrevented, false);
  await act(async () => {
    keydown("f", button);
    await Promise.resolve();
  });
  assert.equal(requestFullscreenCalls, 1);
});

test("keeps native keyboard reading in overflowing slides until direction boundary", () => {
  const slides = setupSlides();
  setRect(slides.hero, 100, 1800);
  const { result } = renderPresentation();

  const reading = keydown("ArrowDown");
  assert.equal(reading.defaultPrevented, false);
  assert.equal(result.current.activeSlideId, "hero");

  setRect(slides.hero, 100, 800);
  let atBottom!: KeyboardEvent;
  act(() => {
    atBottom = keydown("ArrowDown");
  });
  assert.equal(atBottom.defaultPrevented, true);
  assert.equal(result.current.activeSlideId, "preview");
});

test("waits for the fixed header boundary before navigating upward", () => {
  const slides = setupSlides();
  const { result } = renderPresentation();
  act(() => result.current.goToSlide("phase1", "replace"));
  setRect(slides.phase1, 40, 800);

  const hiddenUnderHeader = keydown("ArrowUp");
  assert.equal(hiddenUnderHeader.defaultPrevented, false);
  assert.equal(result.current.activeSlideId, "phase1");

  setRect(slides.phase1, 62, 800);
  let atHeaderBoundary!: KeyboardEvent;
  act(() => {
    atHeaderBoundary = keydown("ArrowUp");
  });
  assert.equal(atHeaderBoundary.defaultPrevented, true);
  assert.equal(result.current.activeSlideId, "preview");
});

test("wheel navigation honors overflow boundaries and applies one cooldown", () => {
  const slides = setupSlides();
  setRect(slides.hero, 100, 1800);
  const { result } = renderPresentation();

  const reading = wheel(80);
  assert.equal(reading.defaultPrevented, false);
  assert.equal(result.current.activeSlideId, "hero");
  assert.equal(wheel(12).defaultPrevented, false);

  setRect(slides.hero, 100, 800);
  const beforeNavigation = scrollCalls.length;
  let boundaryWheel!: WheelEvent;
  act(() => {
    boundaryWheel = wheel(80);
  });
  assert.equal(boundaryWheel.defaultPrevented, true);
  assert.equal(result.current.activeSlideId, "preview");
  assert.equal(scrollCalls.length, beforeNavigation + 1);
  assert.equal(wheel(80).defaultPrevented, true);
  assert.equal(scrollCalls.length, beforeNavigation + 1);
});

test("touch navigation claims only boundary swipes after its threshold", () => {
  const slides = setupSlides();
  setRect(slides.hero, 100, 1800);
  const { result } = renderPresentation();

  touch("touchstart", 400);
  const readingMove = touch("touchmove", 300);
  const reading = touch("touchend", 300);
  assert.equal(readingMove.defaultPrevented, false);
  assert.equal(reading.defaultPrevented, false);
  assert.equal(result.current.activeSlideId, "hero");

  setRect(slides.hero, 100, 800);
  touch("touchstart", 400);
  const tooShortMove = touch("touchmove", 360);
  const tooShort = touch("touchend", 360);
  assert.equal(tooShortMove.defaultPrevented, false);
  assert.equal(tooShort.defaultPrevented, false);
  assert.equal(result.current.activeSlideId, "hero");

  touch("touchstart", 400);
  let navigationMove!: Event;
  let navigation!: Event;
  act(() => {
    navigationMove = touch("touchmove", 340);
    navigation = touch("touchend", 340);
  });
  assert.equal(navigationMove.defaultPrevented, true);
  assert.equal(navigation.defaultPrevented, true);
  assert.equal(result.current.activeSlideId, "preview");
});

test("touch navigation uses the slide active when the gesture started", () => {
  const slides = setupSlides();
  const { result } = renderPresentation();
  const observer = MockIntersectionObserver.instances[0];

  touch("touchstart", 400);
  act(() => {
    touch("touchmove", 340);
    observer.emit(slides.phase1);
    touch("touchend", 340);
  });

  assert.equal(result.current.activeSlideId, "preview");
  assert.equal(window.location.hash, "#preview");
});

test("multi-touch and cancelled gestures never navigate slides", () => {
  setupSlides();
  const { result } = renderPresentation();

  touch("touchstart", [400, 420]);
  touch("touchend", 300);
  assert.equal(result.current.activeSlideId, "hero");

  touch("touchstart", 400);
  touch("touchcancel", 400);
  touch("touchend", 300);
  assert.equal(result.current.activeSlideId, "hero");
  assert.equal(window.location.hash, "#hero");
});

test("center-band observer activates tall slides and replaces hash", () => {
  const slides = setupSlides();
  setRect(slides.phase2, -700, 1500);
  const { result } = renderPresentation();
  const observer = MockIntersectionObserver.instances[0];

  assert.deepEqual(observer.options, {
    rootMargin: "-49% 0px -49% 0px",
    threshold: 0,
  });
  assert.equal(observer.observed.length, INTRO_SLIDES.length);
  act(() => observer.emit(slides.phase2));

  assert.equal(result.current.activeSlideId, "phase2");
  assert.equal(result.current.activeSlideIndex, 3);
  assert.equal(window.location.hash, "#phase2");
  assert.equal(slides.phase2.classList.contains("is-active"), true);
  assert.equal(slides.hero.classList.contains("is-active"), false);
});

test("center-band observer chooses the nearest slide regardless of entry order", () => {
  const slides = setupSlides();
  setRect(slides.phase2, 350, 450);
  setRect(slides.preview, 0, 600);
  const { result } = renderPresentation();
  const observer = MockIntersectionObserver.instances[0];

  act(() => {
    observer.emitMany([{ target: slides.phase2 }, { target: slides.preview }]);
  });

  assert.equal(result.current.activeSlideId, "phase2");
  assert.equal(window.location.hash, "#phase2");
  assert.equal(slides.phase2.classList.contains("is-active"), true);
  assert.equal(slides.preview.classList.contains("is-active"), false);
});

test("fullscreen changes update state and standard enter and exit APIs", async () => {
  setupSlides();
  const { result } = renderPresentation();

  await act(async () => result.current.toggleFullscreen());
  assert.equal(requestFullscreenCalls, 1);
  act(() => document.dispatchEvent(new Event("fullscreenchange")));
  assert.equal(result.current.isFullscreen, true);
  assert.equal(result.current.fullscreenStatus, "Fullscreen enabled");

  await act(async () => result.current.toggleFullscreen());
  assert.equal(exitFullscreenCalls, 1);
  act(() => document.dispatchEvent(new Event("fullscreenchange")));
  assert.equal(result.current.isFullscreen, false);
  assert.equal(result.current.fullscreenStatus, "Fullscreen exited");
});

test("supports WebKit fullscreen events and reports rejected or unavailable fullscreen", async () => {
  setupSlides();
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: undefined,
  });
  const webkit = renderPresentation();

  await act(async () => webkit.result.current.toggleFullscreen());
  assert.equal(webkitRequestFullscreenCalls, 1);
  act(() => document.dispatchEvent(new Event("webkitfullscreenchange")));
  assert.equal(webkit.result.current.isFullscreen, true);
  assert.equal(webkit.result.current.fullscreenStatus, "Fullscreen enabled");
  await act(async () => webkit.result.current.toggleFullscreen());
  assert.equal(webkitExitFullscreenCalls, 1);
  act(() => document.dispatchEvent(new Event("webkitfullscreenchange")));
  assert.equal(webkit.result.current.isFullscreen, false);
  webkit.unmount();
  fullscreenTarget = null;

  installFullscreen({ request: () => Promise.reject(new Error("denied")) });
  const rejected = renderPresentation();
  await act(async () => rejected.result.current.toggleFullscreen());
  assert.equal(
    rejected.result.current.fullscreenStatus,
    "Fullscreen is unavailable in this browser context"
  );
  rejected.unmount();

  Object.defineProperties(document.documentElement, {
    requestFullscreen: { configurable: true, value: undefined },
    webkitRequestFullscreen: { configurable: true, value: undefined },
  });
  Object.defineProperties(document, {
    exitFullscreen: { configurable: true, value: undefined },
    webkitExitFullscreen: { configurable: true, value: undefined },
  });
  const unavailable = renderPresentation();
  await act(async () => unavailable.result.current.toggleFullscreen());
  assert.equal(
    unavailable.result.current.fullscreenStatus,
    "Fullscreen is unavailable in this browser context"
  );
});

test("cleanup removes controller effects, observer, cooldown, and ready class", () => {
  const trackedTypes = new Set([
    "keydown",
    "wheel",
    "touchstart",
    "touchmove",
    "touchend",
    "touchcancel",
    "fullscreenchange",
    "webkitfullscreenchange",
  ]);
  const added: Array<[string, EventListenerOrEventListenerObject | null]> = [];
  const removed: Array<[string, EventListenerOrEventListenerObject | null]> =
    [];
  const addEventListener = document.addEventListener;
  const removeEventListener = document.removeEventListener;
  const clearTimeout = window.clearTimeout;
  let clearedTimer: number | undefined;

  document.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) => {
    if (trackedTypes.has(type)) added.push([type, listener]);
    Reflect.apply(addEventListener, document, [type, listener, options]);
  }) as typeof document.addEventListener;
  document.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ) => {
    if (trackedTypes.has(type)) removed.push([type, listener]);
    Reflect.apply(removeEventListener, document, [type, listener, options]);
  }) as typeof document.removeEventListener;
  window.clearTimeout = ((timer) => {
    clearedTimer = Number(timer);
    return clearTimeout(timer);
  }) as typeof window.clearTimeout;

  const slides = setupSlides();
  setRect(slides.hero, 100, 800);
  try {
    const presentation = renderPresentation();
    const observer = MockIntersectionObserver.instances[0];
    act(() => wheel(80));
    const scrollCount = scrollCalls.length;

    presentation.unmount();
    assert.equal(observer.disconnected, true);
    assert.equal(clearedTimer === undefined, false);
    assert.equal(
      document.documentElement.classList.contains("intro-presentation-ready"),
      false
    );
    assert.equal(slides.hero.classList.contains("is-active"), false);
    assert.equal(keydown("ArrowRight").defaultPrevented, false);
    assert.equal(scrollCalls.length, scrollCount);
    assert.deepEqual(
      added.map(([type]) => type).sort(),
      [...trackedTypes].sort()
    );
    added.forEach(([type, listener]) => {
      assert.equal(
        removed.some(
          ([removedType, removedListener]) =>
            removedType === type && removedListener === listener
        ),
        true,
        `removes ${type} listener`
      );
    });
  } finally {
    document.addEventListener = addEventListener;
    document.removeEventListener = removeEventListener;
    window.clearTimeout = clearTimeout;
  }
});
