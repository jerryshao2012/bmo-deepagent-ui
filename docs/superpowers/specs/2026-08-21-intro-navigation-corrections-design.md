# Intro Presentation Navigation Corrections

## Goal

Fix three presentation-controller defects without changing slide content, visual styling, or Markdown preview behavior:

1. Repeated Right Arrow presses must advance one slide per press.
2. Down Arrow must advance a normal-height slide with one press and place the destination correctly in the viewport.
3. Entering or leaving fullscreen must restore the active slide's vertical alignment after viewport dimensions settle.

## Navigation Semantics

- Left and Right Arrow are deck-navigation controls. They always request the adjacent slide and do not depend on vertical overflow boundaries.
- Up, Down, Page Up, Page Down, Space, and Shift+Space remain reading-aware. On genuinely overflowing slides they preserve native vertical scrolling until the relevant boundary is reached.
- Fixed-header space is part of the visible viewport. A normal `100dvh` slide aligned beneath the 64px header is considered at its forward boundary; it must not require an extra native-scroll keypress.
- Endpoint presses remain clamped and must not add history entries.
- All controls remain inactive while the Markdown preview dialog is open.

## Fullscreen Alignment

- On `fullscreenchange` and `webkitfullscreenchange`, update fullscreen state immediately.
- After the browser applies the new viewport dimensions, re-align the currently active slide.
- Use centered alignment when the slide fits the visible viewport. Use start alignment for a genuinely taller slide so its beginning remains readable.
- Re-alignment uses non-animated scrolling to avoid a second visible transition after fullscreen changes.
- Pending alignment frames are cancelled during controller cleanup.

## Verification

- Controller regression: two consecutive Right Arrow presses advance from hero to preview to Phase 1 without waiting for scroll geometry.
- Controller regression: a normal slide whose bounds include the fixed-header offset advances on the first Down Arrow press.
- Controller regression: fullscreen enter and exit schedule active-slide alignment after viewport settlement, with center/start behavior selected from slide height.
- Existing overflowing-slide reading, endpoint clamping, reduced-motion, dialog suspension, history, wheel, touch, and cleanup tests remain green.
- Browser check on `http://localhost:3000` confirms repeated Right, one-press Down, and fullscreen return alignment.
