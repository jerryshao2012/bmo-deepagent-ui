# Clean Architecture Boundaries

Defines dependency rules, feature ownership, composition roots, and automated
checks used to keep application architecture maintainable.

## Dependency direction

Each capability lives under `src/features/<feature>` and may expose four
layers. Dependencies point inward:

```text
ui -> application -> domain
infrastructure -> application/domain
composition root -> ui/application/infrastructure
```

- `domain`: framework-neutral entities, value objects, and policies.
- `application`: use cases and outbound port definitions.
- `infrastructure`: HTTP, LangGraph, browser, filesystem, and persistence adapters.
- `ui`: React components and controller hooks that invoke application use cases.

Domain and application code must not import React, Next.js, LangGraph SDK, or
another outward adapter. A feature may consume another feature only through
that feature's root public entrypoint.

## Feature boundaries

| Feature         | Owns                                                               |
| --------------- | ------------------------------------------------------------------ |
| `auth`          | OAuth/passkey workflows, session lifecycle, authenticated identity |
| `chat`          | turns, streaming, interrupts, local message/file state             |
| `threads`       | thread discovery, metadata, status, retention                      |
| `wiki`          | wiki ingest, query, graph, citations, progress                     |
| `documents`     | document upload, download, rendering contracts                     |
| `skills`        | skill discovery, upload, deletion                                  |
| `markdown-sync` | editor state, images, WebSocket/SSE/polling fallback               |

Shared UI primitives remain under `src/components/ui`. Cross-cutting runtime
adapters belong under `src/platform`; they must implement ports owned by a
feature rather than expose browser or network globals to presentation code.

## Composition roots

- Next.js pages and route handlers assemble feature use cases and adapters.
- `ClientProvider` assembles LangGraph client/session dependencies.
- `server.cjs` assembles custom Node transports and persistence.

Environment access, adapter selection, and process lifecycle belong only in
composition roots. Public URLs, payloads, cookies, SSE events, and persisted
formats remain backward compatible during migration.

## Implemented dependency map

| Application port    | Active adapter              | Composition consumer                     |
| ------------------- | --------------------------- | ---------------------------------------- |
| `SessionProvider`   | `BrowserSessionProvider`    | authenticated HTTP and LangGraph clients |
| `ApiTransport`      | scoped fetch transport      | custom FastAPI clients                   |
| `ChatGateway`       | `LangGraphChatGateway`      | `useChat` state reconciliation           |
| `RunExecutor`       | `LangGraphRunExecutor`      | send, continue, resume, resolve, stop    |
| `ThreadRepository`  | `LangGraphThreadRepository` | thread list and retention hooks          |
| `WikiGateway`       | `HttpWikiGateway`           | wiki tree, file, and graph views         |
| `SkillsGateway`     | `HttpSkillsGateway`         | skills compatibility facade              |
| `MarkdownSyncStore` | browser and backend stores  | intro synchronization controller         |

Custom Node runtime responsibilities live under `runtime/`: bootstrap config,
transport helpers, bounded state, filesystem persistence, and exported-image
storage. `server.cjs` remains composition root.

## Enforcement

Run `yarn test:architecture` and `yarn contract:check`. CI runs both checks,
lint, and production build. Checker rejects outward imports from inward
layers, cross-feature internal imports, and local dependency cycles. Every new
feature slice must include application-level tests using fake ports plus adapter
contract tests at its framework boundary.

Return to [documentation index](../README.md).
