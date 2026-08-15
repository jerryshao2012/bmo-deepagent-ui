# Phase Navigation Smooth Scroll Design

**Date:** 2026-08-15  
**Scope:** Intro-page Phase 1, Phase 2, and Phase 3 header links only

## Goal

Replace the current instant anchor jump with a restrained vertical glide when a user selects a phase, while preserving the existing intro-page layout, sticky scroll story, copy, and visual style.

## Approved behavior

- Selecting `Phase 1: Ground`, `Phase 2: Research`, or `Phase 3: Review` smoothly scrolls the document to that phase.
- Navigation remains vertical; phase panels do not become a horizontal carousel or scroll-snap experience.
- Existing section anchors and shareable hashes remain intact.
- Direct URLs ending in `#phase1`, `#phase2`, or `#phase3` continue to open the requested section without requiring client-side transition state.
- Existing `IntersectionObserver` logic continues to determine the active orange phase while the document moves.
- Keyboard activation uses the same behavior as pointer activation.
- Users requesting reduced motion receive an immediate anchor jump.

## Implementation

Add one scoped phase-navigation handler in `src/app/intro/page.tsx`. Each of the three existing phase anchors calls the handler while retaining its native `href`.

For an ordinary primary-button activation:

1. Prevent the browser's instant anchor jump.
2. Find the requested phase element.
3. Add the destination hash to browser history.
4. Call `scrollIntoView` with `block: "start"` and either `behavior: "smooth"` or `behavior: "auto"` when `prefers-reduced-motion: reduce` matches.

Modified clicks used to open a new tab or window retain native anchor behavior. Existing `scroll-margin-top` on `.scroll-chapter` supplies the fixed-header offset, so no duplicate offset calculation is introduced.

No new dependency, global smooth-scroll rule, scroll lock, phase-transition state machine, horizontal transform, or layout change is needed.

## Interaction details

- Re-selecting the current phase glides to its aligned section start if it is not already aligned.
- Long moves, such as Phase 1 to Phase 3, pass naturally through the existing scroll story. Active-phase highlighting may progress through intermediate visible phases because it remains observer-driven.
- The animation does not add entrance effects beyond the page's existing progress-based reveal behavior.

## Accessibility and fallback

- Links remain semantic anchors and keep their visible focus behavior.
- Enter activation follows the same scoped handler.
- Modifier-assisted navigation remains native.
- Reduced-motion preference is checked at activation time so changes to the system preference are respected without a reload.
- If the destination element is unavailable, the handler leaves native navigation untouched.

## Verification

- Regression tests confirm all three phase anchors retain their hashes and use the scoped handler.
- Tests confirm smooth behavior and reduced-motion `auto` behavior are both represented.
- Browser checks confirm Phase 1 → Phase 2, Phase 2 → Phase 3, and Phase 3 → Phase 1 moves update the hash and align the requested section below the fixed header.
- Browser checks confirm keyboard activation and reduced-motion fallback.
- Run intro regression tests, project lint, and production build.
