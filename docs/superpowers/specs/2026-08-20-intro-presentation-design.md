# Intro presentation redesign

## Goal

Turn existing intro page into six-slide presentation with read-only slide content and chrome. Preserve current content, functional interactive workspace preview, Collab Thread Markdown trigger and dialog, and in-slide animation. Add presentation navigation and fullscreen behavior modeled on `code-assistant-skill-plugin-development.html`, excluding that reference's inline HTML editing and export controls. Apply visual language inspired by BMO Personal Banking: white and pale-blue surfaces, deep navy type, BMO blue navigation/progress, and red primary actions.

## Slide structure

1. `hero` — existing title and value proposition, unchanged content.
2. `preview` — existing interactive workspace preview, unchanged content.
3. `phase1` — existing Phase 1: Ground content.
4. `phase2` — existing Phase 2: Research content.
5. `phase3` — existing Phase 3: Review content.
6. `launch` — existing final launch content and article links, unchanged content.

Each slide fills at least one dynamic viewport and has a stable anchor. Existing `#phase1`, `#phase2`, and `#phase3` links remain valid.

## Presentation controls

- `ArrowRight`, `ArrowDown`, `PageDown`, and `Space` move forward.
- `ArrowLeft`, `ArrowUp`, and `PageUp` move backward.
- `Home` and `End` move to first and last slides.
- `F` toggles browser fullscreen when focus is not in an editable control.
- Mouse wheel and vertical touch swipe move one slide at a time with input throttling.
- Header phase links, progress dots, and URL hashes navigate directly.
- Visible progress bar, active dot, slide count, keyboard hint, fullscreen control, and accessible live status expose current state.
- Slides with viewport overflow allow native reading scroll first. Wheel, touch, `Arrow`, `Page`, and `Space` inputs advance only after the user reaches the relevant top or bottom boundary; otherwise they retain native within-slide scrolling. Direct header, dot, `Home`, and `End` controls still navigate immediately.

Navigation pauses while Collab Thread dialog is open or focus is in an input, textarea, select, or editable element. Existing dialog keyboard and focus behavior keep priority.

## Motion

Retain existing hero fade, preview entrance and pointer tilt, phase chapter reveals, workflow path/node motion, and final-slide reveal. Presentation movement activates these effects through active-slide and intersection state instead of replacing them. Smooth slide movement uses transforms, opacity, and `scrollIntoView`; reduced-motion preference switches to immediate movement and disables non-essential transitions.

## Visual system

- White navigation and primary surfaces.
- Pale blue-gray slide backgrounds and separators.
- Deep navy display and body text.
- BMO blue for active navigation, slide progress, focus accents, and supporting highlights.
- Red reserved for primary launch actions.
- Large, tightly tracked headings; compact section labels; constrained line lengths.
- BMO-inspired styling only; no copied brand assets or claim that page is an official BMO property.

## Component boundaries

- Presentation navigation module: pure slide ordering, boundary, and target resolution logic.
- Presentation hook/controller: keyboard, wheel, touch, hash restoration, fullscreen, intersection state, and reduced-motion behavior.
- Presentation chrome: progress, dots, slide position, help hint, and fullscreen button.
- Existing intro content: wrapped as six slides without copy changes.
- Existing Collab Thread Markdown trigger remains visible and operable in the presentation header; its dialog, sync, and backend behavior are preserved and kept separate from presentation state.

Implementation stays in existing Next.js/React/Tailwind stack. No new UI or animation dependency.

## Failure and accessibility behavior

- Missing fullscreen API leaves deck usable and announces an accessible status message.
- Missing hash target falls back to first slide without throwing.
- Navigation controls use buttons, accessible names, visible focus rings, and `aria-current` for active slide.
- Native scrolling remains available when JavaScript or fullscreen is unavailable.
- Semantic landmarks and heading order remain intact.

## Verification

- Unit tests cover forward/back boundaries, Home/End, direct targets, and preserved phase hashes.
- Interaction tests cover shortcut suppression in Collab Thread and form controls, wheel throttling, touch threshold, reduced motion, and fullscreen fallback.
- Existing intro navigation and Markdown sync tests remain green.
- Run `yarn lint` and `yarn build`.
- Browser-check all six slides at desktop and mobile widths, including keyboard-only navigation, touch/wheel movement, dialog use, hash restoration, fullscreen entry/exit, and reduced-motion mode.

## Explicit exclusions

- No inline HTML/content editing from reference presentation.
- No HTML export/download function from reference presentation.
- No intro copy rewrite.
- No changes to `/chat`, authentication, Markdown persistence, or backend APIs.
