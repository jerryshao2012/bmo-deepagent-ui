# Workflow Flow Animation Design

**Date:** 2026-08-15  
**Scope:** Phase 2 building-block connector interaction only

## Goal

Make workflow direction immediately legible without changing intro-page layout, copy, cards, or overall visual style.

## Approved behavior

- Keep every connector visible in neutral gray at rest.
- Hovering or focusing a block turns its complete contextual route orange.
- Animate a small glowing orange dot from source toward report only while a route is active.
- `Living Wiki` activates the upper route.
- `Research Plan` activates the lower route.
- `Source Material` and `Source-Linked Report` activate both routes, with slightly staggered dots.
- Mouse leave or focus loss restores neutral connectors and removes moving dots.

## Implementation

Reuse the existing SVG path geometry. Separate each connector into:

1. A permanent gray track.
2. A full-length orange active overlay controlled by `hoveredNode`.
3. A conditionally rendered SVG particle using `animateMotion` on the matching route path.

No request-animation-frame loop, new dependency, new page, or component extraction is needed.

## Motion and accessibility

- Particle loop duration: approximately 1.6 seconds.
- Particle size: approximately 4–5 px with a restrained orange glow.
- Route color transition: approximately 200–300 ms.
- Keyboard focus mirrors pointer hover.
- Under `prefers-reduced-motion: reduce`, routes still turn fully orange but particles remain hidden.

## Verification

- Regression test confirms permanent tracks, complete active overlays, contextual route mapping, and reduced-motion handling.
- Browser check confirms full orange routes and correct particle direction for all four blocks.
- Validate project lint and production build.
