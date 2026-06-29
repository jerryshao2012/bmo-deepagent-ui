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
