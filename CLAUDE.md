# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (custom server with Next.js + WebSocket on port 3000)
yarn dev

# Production build and start
yarn build
yarn start

# Linting and formatting
yarn lint                # ESLint check
yarn lint:fix            # ESLint auto-fix
yarn format              # Prettier write
yarn format:check        # Prettier check only

# Analyze HAR files
yarn analyze:har
```

## Architecture Overview

This is a **Next.js 16 App Router** UI for [LangChain Deep Agents](https://github.com/langchain-ai/deepagents), built with React 19, TypeScript, Tailwind CSS 3, and shadcn/ui (Radix primitives). It connects to a LangGraph deployment (local or remote) and provides a chat interface for interacting with AI agents.

### Custom Server (`server.cjs`)

The app uses a **custom Node.js server** (`server.cjs`) rather than `next start`. It wraps Next.js and adds:

- A **WebSocket server** (`ws`) on `/api/ws` for real-time collaborative markdown editing on the intro page. Clients are grouped by `threadId` in rooms; content changes are broadcast to all clients in the same room.
- **File-based persistence** for thread markdown content (`data/markdown_threads/`) with an LRU cache and debounced batch saves (1.5s debounce, 5-min batch flush).
- **Mermaid image endpoints** (`/api/store-mermaid-image` POST, `/api/mermaid-image/<id>.png` GET) — in-memory store for exporting diagram PNGs to Word/Outlook.
- Graceful shutdown flushes pending saves on SIGTERM/SIGINT.

### Routing & Pages

| Route | Type | Purpose |
|---|---|---|
| `/` | Server component | Renders `IntroPage` (landing/marketing page) |
| `/login` | Server component | OAuth login page; redirects to `/chat` if valid `session_token` cookie exists |
| `/login/success` | API route | Sets `session_token` cookie from query param, redirects to `/chat` |
| `/chat` | Server component | Validates session against backend `/auth/session/validate`, renders `ChatPage`; redirects to `/login` on failure |

### Providers & State

- **`ClientProvider`** — Creates the `@langchain/langgraph-sdk` `Client` instance and provides it via React context. Also installs the global 401 fetch interceptor and starts proactive session refresh (every 20 min).
- **`ChatProvider`** — Wraps the `useChat` hook, providing streaming state, messages, todos, files, and actions (send, stop, continue, resume interrupt, single-step) via context to all chat components.

### Streaming Architecture

The app uses **LangGraph SDK's `useStream`** hook (`@langchain/langgraph-sdk/react`) for real-time agent communication. State type includes `messages`, `todos`, `files`, `email`, `ui`, and `no_web`.

For the intro page's collaborative editing, a separate streaming mechanism exists in `stream-fallback.ts`:
- **Primary**: WebSocket connection to `/api/ws`
- **Fallback**: SSE via `fetchEventSource` to `/api/stream` (edge runtime proxy to backend)

### API Routes

- **`/api/stream`** (Edge runtime) — Proxies SSE streaming requests to the LangGraph backend, forwarding `X-API-Key` from `UPLOAD_API_KEY` env var.
- **`/api/ws-fallback`** (Node.js runtime) — In-memory thread content store for intro page SSE sync (GET for current content, POST for updates). Used when WebSocket is unavailable (e.g., Vercel deploys).

### Authentication

- OAuth via backend (Google/GitHub), managed by the FastAPI backend using Authlib.
- `session_token` cookie set by `/login/success` route after OAuth callback.
- **Global 401 interceptor** (`installGlobalAuthInterceptor` in `langgraph-client.ts`): wraps `window.fetch` to catch 401 responses, attempts session refresh via `/auth/session/refresh`, retries the original request on success, or redirects to `/login` on failure.
- **Proactive refresh**: `startProactiveSessionRefresh` calls the refresh endpoint every 20 minutes.
- `X-API-Key` header used for backend API calls (reads from `UPLOAD_API_KEY` env var server-side, or `session_token` cookie client-side).

### Configuration

User settings (deployment URL + assistant ID) are stored in `localStorage` under key `deep-agent-config`, with env var fallbacks:
- `NEXT_PUBLIC_LANGGRAPH_URL` — default deployment URL
- `NEXT_PUBLIC_ASSISTANT_ID` — default assistant ID

`ConfigDialog` component provides the settings UI. `nuqs` is used for URL query state management (`threadId`, `sidebar`).

### Key Components

| Component | Purpose |
|---|---|
| `ChatInterface` | Main chat UI: message list, input, debug mode controls |
| `ChatMessage` | Renders a single message with tool calls, markdown, sub-agent indicators |
| `ToolCallBox` | Displays tool call details (args, result, status) |
| `ToolApprovalInterrupt` | UI for human-in-the-loop tool approval |
| `ThreadList` | Sidebar thread list with search, favorites, title editing, deletion |
| `FileViewPanel` | File browser and viewer for agent filesystem state |
| `TasksFilesSidebar` | Combined sidebar showing agent todos and files |
| `WikiTreeViewer` | Tree view for wiki-style content |
| `MarkdownContent` | Markdown renderer with Mermaid diagram support |
| `ConfigDialog` | Deployment URL and assistant ID configuration |
| `HealthIndicator` | Backend health check display |
| `viewers/*` | Document viewers for PDF, DOCX, PPTX, XLSX files |

### Docker

Dockerfile uses multi-stage build (`node:22-bookworm-slim`):
1. **Builder stage**: installs all deps, copies `.env.docker` as `.env`, runs `yarn build`
2. **Runner stage**: production deps only, copies `.next`, `public`, `server.cjs`, `.env.docker`
3. Starts via `node server.cjs` on port 3000

Separate Dockerfiles exist for AWS deployment (`Dockerfile-aws`) with corresponding build/deploy scripts (`build-aws.sh`, `deploy-aws.sh`, `env-aws.sh`, `secrets-aws.sh`).

<!-- cce-block-version: 4 -->
## Context Engine (CCE)

This project uses Code Context Engine for intelligent code retrieval and
cross-session memory.

### Searching the codebase

**You MUST use `context_search` instead of reading files directly** when
exploring the codebase, answering questions about code, or understanding how
things work. This is a hard requirement, not a suggestion. `context_search`
returns the most relevant code chunks with confidence scores instead of whole
files, and tracks token savings automatically.

When to use `context_search`:
- Answering questions about the codebase ("how does X work?", "where is Y?")
- Exploring structure or architecture
- Finding related code, functions, or patterns
- Any time you would otherwise read a file just to understand it

When to use `Read` instead:
- You need to edit a specific file (read before editing)
- You need the exact, complete content of a known file path

Other search tools:
- `expand_chunk` — get full source for a compressed result
- `related_context` — find what calls/imports a function

### Cross-session memory — use it actively

This project has persistent memory across Claude Code sessions. **You must
use it both ways: recall before answering, record after deciding.** Memory
that is not recorded is lost; memory that is not recalled does nothing.

**Before answering a non-trivial question, call `session_recall`.**
Especially when:
- The question touches architecture, design, or naming choices
- The user asks "what / why / how did we ..."
- You are about to recommend an approach the team may have already chosen
  or already rejected

Pass a topic phrase, not a single word — e.g. `session_recall("auth flow")`,
not `session_recall("auth")`. Recall is vector-similarity-based, so paraphrases
match. If recall returns relevant entries, lead with them ("Per a prior
decision: ...") instead of re-deriving the answer.

**After making a non-obvious decision, call `record_decision`.** Especially:
- Choosing one library / pattern / approach over another
- Resolving an ambiguity in the spec or requirements
- Establishing a convention the project should follow going forward
- Anything you would not want to re-litigate next session

Format: `record_decision(decision="...", reason="...")`. Keep both fields
short and specific — they are surfaced verbatim at the start of future
sessions.

**After meaningful work in a file, call `record_code_area`.** Especially when:
- You added or substantially modified a function/class
- You traced through a non-obvious flow and want future-you to find it fast

Format: `record_code_area(file_path="...", description="...")`.

Skip recording for trivial reads, formatting changes, or one-off lookups —
the goal is durable signal, not an event log.

### Drilling deeper from a recall hit

`session_recall` results are tagged with the source session id, e.g.
`[turn sid:abc123|n:5]`. To drill in:

- `session_timeline(session_id="abc123")` — walk the per-turn summaries of
  that session in order. Use this when the user asks "what was the
  reasoning?" or "how did we get there?".
- `session_event(event_id=N)` — fetch a specific tool event's raw input
  and output (capped at 4 KB at read time). Use this when a turn summary
  references a tool result you actually need to inspect.

Both are read-only and cheap. Prefer them over re-running tool calls or
asking the user to re-paste context.

### Output style

Respond in compressed style. Drop articles (a, an, the) in prose. Use
sentence fragments over full sentences. Use short synonyms (fix not resolve,
check not investigate). Pattern: [thing] [action] [reason]. [next step].
No filler, hedging, pleasantries, trailing summaries, or restating what
the user said. One sentence if one sentence is enough.

When suggesting code changes, show only the changed lines with 3 lines of
context. Never rewrite entire files. Multiple changes in one file: show each
change separately. Never echo back unchanged code the user already has.

Code blocks, file paths, commands, error messages: always written in full.
Security warnings and destructive action confirmations: use full clarity.
<!-- /cce-block -->
