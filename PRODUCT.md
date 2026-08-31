# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are enterprise knowledge workers and research analysts who conduct in-depth multi-step research investigations, synthesize findings across large document corpora, and evaluate autonomous agent outputs. Secondary users include developers and operations engineers configuring, monitoring, and debugging LangGraph agent deployments.

## Product Purpose

Provide an enterprise-grade operational interface for interacting with autonomous LangGraph and Deep Agents. The product enables analysts to trigger and monitor deep research runs, inspect streaming execution traces, manage human-in-the-loop approvals for sensitive agent actions, view generated document artifacts (PDF, DOCX, PPTX, XLSX) in-place, query grounded thread-scoped wiki knowledge bases, and collaborate via live synchronized Markdown editing.

## Positioning

Enterprise-grade deep research console with integrated artifact viewers, grounded wiki queries, and human-in-the-loop approval. Unlike generic chat interfaces or developer-only trace logs, it bridges autonomous agent execution with enterprise governance, auditability, and in-place document verification.

## Operating Context

- Enterprise research environments requiring high auditability, session persistence, and secure authentication (OAuth via Google/GitHub, WebAuthn passkeys).
- High-concurrency agent workflows utilizing streaming SSE and WebSockets for real-time trace inspection and collaborative document editing.
- Deployed across varied enterprise hosting environments (local development, Docker containers, Azure Container Apps, AWS ECS, Azure App Service).

## Capabilities and Constraints

- Capabilities:
  - Real-time agent streaming via LangGraph SDK with interrupt handling for human-in-the-loop tool approvals.
  - Step-by-step Debug Mode for running agents incrementally and re-executing steps.
  - Native in-app file viewers for PDF (PDF.js), Word (DOCX via Mammoth), PowerPoint (PPTX), and Excel (XLSX).
  - Grounded LLM Wiki document ingestion, workspace inspection, and citation-backed question answering.
  - Real-time collaborative Markdown editing on `/` with dual-transport resilience (Node.js WebSocket primary with SSE/POST bridge fallback).
  - Secure enterprise authentication supporting OAuth (Google, GitHub) and WebAuthn Passkeys.
- Constraints:
  - Requires connection to a compatible LangGraph / Deep Agents backend deployment.
  - Browser-stored configuration in `localStorage` under `deep-agent-config` with environment variable fallbacks.
  - Next.js 16 App Router + React 19 stack served via custom `server.cjs` runtime.

## Brand Commitments

- Product name: BMO Deep Agents UI (and Deep Agents UI).
- Professional, high-density enterprise aesthetic: neutral, clear, and scannable interface prioritizing data readability and operational control over decorative flair.

## Evidence on Hand

- Production Next.js 16 App Router codebase with comprehensive test suites (tests for authentication, passkeys, markdown sync, architecture boundaries).
- Implemented viewer components under `src/components/viewers/` supporting PDF, DOCX, PPTX, XLSX.
- Custom WebSocket and persistence server (`server.cjs`).
- OpenAPI backend contracts under `contracts/backend-api.openapi.json`.
- Comprehensive documentation under `documents/` (authentication, deployment, LLM Wiki).

## Product Principles

1. High-Trust Supervision: Keep analysts in control of autonomous agent actions through transparent step-by-step tracing and explicit approval interrupts.
2. Artifact-Centric Exploration: Deliver generated reports, spreadsheets, and presentations directly in native viewers without forcing context-switching or local downloads.
3. Resilient Communication: Ensure uninterrupted work through dual-channel streaming architectures and persistent thread state.
4. Enterprise Rigor: Enforce strong security boundaries, authentication hygiene, and accessible, responsive interaction models suited for high-stakes enterprise research.

## Accessibility & Inclusion

- Adherence to WAI-ARIA standards powered by Radix UI primitives across dialogs, tooltips, dropdowns, and tab panels.
- Full keyboard navigation and high-contrast readable type hierarchy for complex data tables, markdown documents, and execution traces.
