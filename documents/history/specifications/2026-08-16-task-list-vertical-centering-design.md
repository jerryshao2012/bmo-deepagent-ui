# Task List Vertical Centering Design

## Goal

Visually center the entire task-list block within the expanded Tasks panel shown in `ChatInterface`, while preserving natural panel height and existing row alignment.

## Root Cause

Expanded panel wrapper supplies horizontal padding only. Each rendered status group adds `mb-4`, including the final group. With no matching top space, single-group lists appear shifted upward.

## Design

- Apply `py-2` only when `metaOpen === "tasks"`; keep the shared wrapper's existing spacing for Files, Documents, and Wiki.
- Keep spacing between multiple status groups.
- Render each visible status group with `mb-4 last:mb-0` so groups retain separation but the final group adds no trailing margin.
- Do not add a fixed/minimum panel height or change task-row icon/text alignment.

## Components and Data Flow

Change only task-list layout classes in `../../../src/app/components/ChatInterface.tsx`: make the shared content wrapper's `py-2` conditional on the Tasks view and add `last:mb-0` to visible task groups. Todo grouping, filtering, status ordering, scroll behavior, Files/Documents/Wiki spacing, and click behavior remain unchanged.

## Error Handling

No new runtime paths or failure modes. Empty task state remains unreachable for this panel because it renders only when tasks exist.

## Verification

- Add a focused source-level regression test asserting symmetric wrapper spacing and no trailing margin on final group.
- Run regression test and `yarn lint`.
- Inspect rendered layout if existing local app setup permits it without unrelated configuration changes.

## Out of Scope

- `TasksFilesSidebar` layout.
- Task row icon alignment.
- Header/tab spacing.
- Panel height or scrolling changes.
