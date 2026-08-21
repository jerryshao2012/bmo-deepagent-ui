# Intro Presentation Navigation Corrections

## Goal

Fix three presentation-controller defects without changing slide content, visual styling, or Markdown preview behavior:

1. Repeated Right Arrow presses must advance one slide per press.
2. Down Arrow must advance a normal-height slide with one press and place the destination correctly in the viewport.
3. Entering or leaving fullscreen must restore the active slide's vertical alignment after viewport dimensions settle.

## Navigation Semantics

- Left and Right Arrow are deck-navigation controls. They always request the adjacent slide and do not depend on vertical overflow boundaries.
- Up, Down, Page Up, Page Down, Space, and Shift+Space remain reading-aware. Wheel and touch use the same boundary rules. A slide fits when `bottom - top <= window.innerHeight + 2px`; fitting slides are always ready to leave in either direction. A taller slide preserves native vertical scrolling until its forward boundary satisfies `bottom <= window.innerHeight + 64px + 2px` or its backward boundary satisfies `top >= 64px - 2px`.
- Fixed-header space is therefore part of the visible viewport. A normal `100dvh` slide aligned beneath the 64px header is ready to advance and must not require an extra native-scroll keypress.
- Ordinary navigation centers a fitting destination with `scrollIntoView({ block: "center" })`. A genuinely taller destination uses `block: "start"` so its beginning remains readable. Existing smooth/reduced-motion behavior is unchanged.
- Endpoint presses remain clamped and must not add history entries.
- All controls remain inactive while the Markdown preview dialog is open.

## Fullscreen Alignment

- On `fullscreenchange` and `webkitfullscreenchange`, update fullscreen state immediately.
- After the browser applies the new viewport dimensions, re-align the currently active slide after two nested animation frames.
- Standard and WebKit fullscreen events share one pending alignment job. A later event cancels and replaces any pending first- or second-frame job. The second frame reads the active slide and viewport dimensions at callback time.
- Use the same `bottom - top <= window.innerHeight + 2px` fit test: centered alignment for a fitting slide, start alignment for a taller slide.
- Re-alignment uses non-animated scrolling to avoid a second visible transition after fullscreen changes.
- Re-alignment changes neither history nor hash. Pending and superseded alignment frames are cancelled during controller cleanup.

## Verification

- Controller regression: two consecutive Right Arrow presses advance from hero to preview to Phase 1 without waiting for scroll geometry; Left Arrow likewise bypasses vertical overflow geometry.
- Controller regression: a fitting slide and a `100dvh` slide offset by the fixed header advance on the first Down Arrow press. Truly tall slides still require their directional boundary for Up/Down, Page, Space, wheel, and touch.
- Navigation regression asserts fitting destinations use `block: "center"`, tall destinations use `block: "start"`, and reduced motion still selects non-animated scrolling.
- Controller regression: fullscreen enter and exit do not align before two frames, use the active slide and viewport at callback time, select center/start from slide height, and mutate neither history nor hash.
- Fullscreen regression covers standard and prefixed events, duplicate-event coalescing, superseded-frame cancellation, and unmount cleanup.
- Existing endpoint clamping, dialog suspension, history, wheel, touch, and cleanup tests remain green.
- Browser check on `http://localhost:3000` confirms repeated Right, one-press Down, and fullscreen return alignment.
