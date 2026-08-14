# Enterprise Knowledge Intro Page Design

## Goal

Redesign the intro page for enterprise decision-makers around one credible promise: turn enterprise documents into reusable, decision-ready knowledge. Show the existing workspace as product proof, explain uploaded research skills as the extensibility layer, and make the existing workspace demo the primary conversion path.

## Audience and Conversion

- Primary audience: enterprise decision-makers evaluating knowledge reuse, research governance, and organizational consistency.
- Primary CTA: `Launch Workspace Demo`, linking to the existing `/chat` route and its current authentication flow.
- Secondary CTA: `See How It Works`, scrolling to the value-flow section.
- Primary promise: transform reports, policies, research, presentations, and other enterprise documents into persistent knowledge that can ground new research and reusable deliverables.

No new lead-capture, booking, CRM, email, or demo-request workflow is part of this design.

## Product-Truth Guardrails

Intro copy must describe capabilities implemented by the current UI and deep-research backend:

- Upload documents into a thread workspace.
- Track document ingestion progress.
- Browse an ingested wiki as a tree or knowledge graph.
- Combine document grounding with optional web research.
- Follow task planning, delegated research activity, gap filling, and verification rounds.
- Review source-linked reports and generated state files.
- Browse, upload, remove, and apply backend-provided research skills when the connected backend supports those endpoints.
- Review a skill invocation draft before sending it in the current conversation.

Intro copy must not claim automatic local-repository access, passive operational observation, shell execution, Docker/WASM confinement, compile/lint correction, deterministic output, or general-purpose plugins. Verification should be described as report-coverage, citation, and gap checks rather than a guarantee of correctness.

## Approved Page Story

### 1. Header

Keep a compact, sticky header with product identity and anchor links for `How It Works`, `Research Skills`, and `Trust`. Use stable section IDs `how-it-works`, `research-skills`, and `trust`. Keep the collaborative markdown launcher available under its existing behavior. Use `Launch Workspace Demo` as the primary header action.

The header should not show engineering phase names such as `Discover`, `Structure`, and `Verify`; navigation should use buyer-oriented language.

### 2. Hero: Enterprise Outcome

Lead with this message hierarchy:

- Eyebrow: `Enterprise Research Intelligence`
- Headline: `Turn enterprise documents into reusable, decision-ready knowledge.`
- Supporting copy: explain grounded research, source lineage, and reusable skill-guided outputs in one short paragraph.
- Primary CTA: `Launch Workspace Demo`
- Secondary CTA: `See How It Works`

Hero visual should communicate document-to-knowledge transformation. It should not use a fabricated terminal, code-build sequence, or generic agent command log.

### 3. Value Flow: Source Material to Reusable Output

Present one four-stage flow:

1. `Source material` — reports, policies, research, presentations.
2. `Living knowledge` — ingested wiki, structured pages, knowledge graph, reusable thread context.
3. `Grounded research` — planned tasks, document queries, optional web research, cited synthesis, verification.
4. `Reusable outputs` — executive briefs, datasets, slides, interview material, and organization-specific formats.

Desktop uses a horizontal flow. Mobile stacks the stages vertically with directional continuity and no clipped fixed-width graph.

### 4. Product Proof: Authentic Workspace

Replace the current terminal mock with a simplified but visually faithful representation of the existing workspace. Show:

- Documents, wiki, tasks, and files controls.
- A document-ingestion or research-progress state.
- Parallel research or task progress without exposing internal implementation jargon.
- A verification round indicator.
- A source-linked `final_report.md` result.

The mock is illustrative, not live application state. It should use current design tokens and component language so the transition into `/chat` feels continuous.

### 5. Research Skills: Extensibility and Reuse

Position research skills as reusable, organization-specific workflows applied to grounded thread context.

Explain the real interaction:

1. Upload or enable a research skill through settings when backend supports skill management.
2. Browse and search available skills in the workspace catalog.
3. Select a skill to draft an explicit invocation using current thread context.
4. Review or edit the draft, then send it in the conversation.
5. Review the generated deliverable against its source material.

Use representative examples already supported by the backend, such as golden datasets, study slides, interview materials, humanized writing, and custom organization-specific skills. Do not use the term `plugin` on the intro page.

### 6. Trust and Governance

Use concise proof points tied to implemented behavior:

- Traceable document and web citations.
- Human-reviewed skill invocation before execution.
- Persistent thread files and wiki knowledge.
- Visible task and verification progress.
- Configurable backend deployment and authentication.

Avoid absolute safety, accuracy, determinism, or compliance claims. Generated outputs remain subject to human review.

### 7. Final Conversion

Close with: `See how your documents become reusable knowledge.`

Primary action: `Launch Workspace Demo` → `/chat`.

Do not add a separate form, calendar integration, or external request-demo destination.

## Visual Direction

- Reuse application design tokens, Geist typography, and blue/teal product accents.
- Remove repeated hard-coded orange and stone marketing colors unless promoted into intentional shared brand tokens.
- Favor editorial whitespace, a restrained enterprise palette, authentic UI proof, and clear process diagrams.
- Keep motion subtle and functional: short reveal transitions and restrained progress movement.
- Respect `prefers-reduced-motion`.
- Avoid glow-heavy AI styling, decorative terminal chrome, and excessive rounded cards.

## Component Architecture

The current intro page combines marketing content, synchronization, image handling, export behavior, and dialog presentation in one large client component. The redesign should separate static content from the collaborative markdown workspace without changing its behavior.

Proposed boundaries:

- `../../../src/app/intro/page.tsx` — server-rendered page composition and section order.
- `src/app/intro/components/IntroHeader.tsx` — responsive header, anchors, workspace CTA, and markdown-launch control.
- `src/app/intro/components/IntroHero.tsx` — hero copy and transformation visual.
- `src/app/intro/components/KnowledgeValueFlow.tsx` — four-stage responsive value flow.
- `src/app/intro/components/WorkspaceProof.tsx` — authentic static product proof.
- `src/app/intro/components/ResearchSkillsSection.tsx` — skill workflow and examples.
- `src/app/intro/components/TrustSection.tsx` — implemented trust proof points and final CTA.
- `src/app/intro/components/CollaborativeMarkdownWorkspace.tsx` — extracted existing markdown synchronization, assets, export, and dialog behavior.
- `src/app/intro/components/MarkdownWorkspaceLauncher.tsx` — small client boundary that resolves the current markdown ID and lazy-loads the collaborative workspace when opened.

Static page sections should remain server-renderable. The collaborative editor and heavy markdown-rendering dependencies should not enter the initial client bundle until needed. The root route should no longer require `force-dynamic` solely for client-side query handling.

## Collaborative Markdown Preservation

Existing collaborative markdown behavior remains in scope only as a preservation requirement during extraction:

- Six-digit markdown IDs and current URL/local-storage behavior remain unchanged.
- WebSocket, HTTP fallback, backend mirror, pending-edit, image, export, inactivity, and focus-restoration behavior remain unchanged.
- Existing markdown synchronization and lifecycle regression tests remain authoritative.

This design does not change collaboration security, room identifiers, or the boundary between markdown collaboration IDs and LangGraph chat thread IDs.

## Accessibility

- Use one `h1` and sequential section headings.
- Give anchor navigation a useful accessible label.
- Use semantic lists for value stages and trust points.
- Implement collaborative workspace with dialog semantics, `aria-modal`, labelled title/description, initial focus, focus trap, Escape close, and trigger-focus restoration.
- Keep all icon controls labelled.
- Preserve visible keyboard focus.
- Make both CTAs keyboard accessible and avoid nested interactive controls.
- Ensure desktop flows become readable vertical sequences on small screens.
- Maintain WCAG AA contrast for text and controls in both color schemes.

## Performance and Rendering

- Server-render static marketing sections.
- Lazy-load collaborative editor, markdown renderer, Mermaid, image workflow, and export logic after launcher activation.
- Remove root `force-dynamic` if verification confirms static rendering remains correct.
- Avoid scroll listeners for behavior achievable through CSS or scoped observers.
- Use optimized local assets or CSS-based mock UI; do not add render-blocking remote font or image requests.
- Prevent layout shift by reserving dimensions for product-proof visuals.

## Testing

- Add intro-content tests that reject removed unsupported claims and assert the approved buyer-oriented sections and workspace CTA.
- Add component tests for the value-flow order, skill workflow, trust statements, and `/chat` CTA destination.
- Add keyboard-focused dialog tests for open, focus containment, Escape, close, and focus restoration.
- Add responsive browser tests at phone, tablet, and desktop sizes; assert no horizontal overflow and usable navigation/CTA layout.
- Keep all existing markdown sync, attachment, lifecycle, and architecture tests green after extraction.
- Run `yarn lint`, targeted tests, and `yarn build` before completion.

## Non-Goals

- No collaboration authentication or room-ID changes.
- No merge between collaboration rooms and LangGraph chat threads.
- No new lead-capture or request-demo backend.
- No new general plugin system, connector framework, or MCP integration.
- No deep-research backend changes.
- No chat workspace redesign beyond the static proof shown on intro.
- No new claims of guaranteed accuracy, compliance, or deterministic behavior.
