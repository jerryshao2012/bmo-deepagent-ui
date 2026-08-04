# OAuth and LLM Wiki Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-stack developer guides for OAuth authentication and LLM Wiki document upload/query workflows, matching existing passkey guide depth and structure.

**Architecture:** Keep current UI repository as cross-stack entry point because browser session handling and document-upload orchestration originate here. Link maintained backend guides for backend-only configuration and API detail; document only behavior confirmed by current UI code, generated OpenAPI types, and backend route definitions.

**Tech Stack:** Markdown, Mermaid `sequenceDiagram`, Next.js, FastAPI, Authlib, durable auth store, Thread Wiki

---

### Task 0: Confirm baseline and source contracts

**Files:**

- Inspect: `documents/authentication/passkey-authentication.md`
- Inspect: `documents/README.md`
- Inspect: `README.md`
- Inspect: `src/lib/oauth-login.ts`
- Inspect: `src/app/login/success/route.ts`
- Inspect: `src/platform/http/authenticated-fetch.ts`
- Inspect: `src/app/components/ChatInterface.tsx`
- Inspect: `src/generated/backend-api.ts`
- Inspect: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/documents/guides/authentication.md`
- Inspect: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/documents/api/upload.md`
- Inspect: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/documents/api/wiki.md`
- Inspect: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/webapp/routes.py`
- Inspect: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/thread_wiki/routes.py`

- [ ] **Step 1: Record current worktree state**

Run:

```bash
git -c core.fsmonitor=false branch --show-current
git -c core.fsmonitor=false rev-parse HEAD
git -c core.fsmonitor=false status --short
git -c core.fsmonitor=false diff --cached --name-only
```

Expected: current branch and HEAD recorded; pre-existing staged/unstaged changes identified before documentation edits.

- [ ] **Step 2: Confirm OAuth contracts from source**

Run targeted `rg` checks for `/auth/login/{provider}`, `/auth/callback/{provider}`, `/auth/session/validate`, `/auth/session/refresh`, `/auth/logout`, `FRONTEND_ORIGINS`, `safe_oauth_return_path`, `session_token`, and 24-hour cookie/session behavior in listed UI and backend auth files.

Expected: every planned endpoint, redirect, cookie, provider, allowlist, and session claim has current source evidence.

- [ ] **Step 3: Confirm LLM Wiki contracts from source**

Run targeted `rg` checks for `/documents/upload`, `threads/{thread_id}`, automatic ingest, `/wiki/status`, `/wiki/progress`, `/wiki/tree`, `/wiki/file`, `/wiki/query`, `file_results`, `filed_path`, `sources_cited`, and wiki deletion in listed UI/generated/backend files.

Expected: upload, readiness, query, citation, filing, and cleanup behavior matches current routes and types.

### Task 1: Add OAuth authentication guide

**Files:**

- Create: `documents/authentication/oauth-authentication.md`
- Reference: `documents/authentication/passkey-authentication.md`
- Reference: `src/lib/oauth-login.ts`
- Reference: `src/app/login/success/route.ts`
- Reference: `src/platform/http/authenticated-fetch.ts`
- Reference: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/webapp/routes.py`
- Reference: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/webapp/oauth_handler.py`
- Reference: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/webapp/auth_store.py`

- [ ] **Step 1: Add overview and trust boundaries**

Create guide with title, cross-stack summary, return link to `../README.md`, and responsibility table for Browser UI, Next.js login-success route, FastAPI OAuth routes, Google/GitHub, and durable auth store.

State exact boundaries: browser begins login against backend; backend owns provider exchange and application-session creation; frontend consumes success redirect, sets `session_token`, and redirects to allowlisted destination; protected browser requests present session token to backend.

- [ ] **Step 2: Add login and callback sequence**

Add Mermaid `sequenceDiagram` covering provider choice, `GET /auth/login/{provider}`, frontend selection, safe return-path capture, signed OAuth state/session cookie, exact callback URI, provider authorization, `GET /auth/callback/{provider}`, immutable provider identity lookup, sanitized profile persistence, random 24-hour application session creation, `/login/success?token=...`, cookie issuance, and `/chat` or allowlisted passkey-management destination.

Explicitly distinguish provider token/state from application `session_token`. Do not claim that arbitrary return paths are accepted.

- [ ] **Step 3: Add session lifecycle sequence**

Add Mermaid `sequenceDiagram` covering authenticated request, initial 401, one per-origin coordinated `POST /auth/session/refresh`, successful request retry, failed refresh routing to login, `GET /auth/session/validate`, and `POST /auth/logout` revocation.

Document 24-hour cookie/session lifetime, sliding backend validation near expiry, refresh behavior, accepted `X-API-Key`/Bearer session headers, and raw session-token hash persistence.

- [ ] **Step 4: Add endpoints, configuration, security, and troubleshooting**

Add endpoint table for login, callback, validate, refresh, and logout. Add placeholder-only configuration examples for Google/GitHub IDs and secrets, exact callback URLs, `FRONTEND_URLS`, optional per-domain GitHub client mappings, stable `OAUTH_SECRET_KEY`, and durable auth-store selection.

Cover exact origins and proxy forwarded-header trust, HTTPS, token-in-query exposure during current success redirect, browser-visible cookie limitation, secret handling, non-linking of Google/GitHub by email, sanitized validation responses, and common provider/redirect/session errors. State that raw provider OAuth tokens are not persisted and OAuth/client secrets must never use `NEXT_PUBLIC_*` variables. Link backend authentication guide for exhaustive setup.

- [ ] **Step 5: Run focused guide checks**

Run:

```bash
rg -n "auth/login|auth/callback|auth/session/validate|auth/session/refresh|auth/logout|FRONTEND_URLS|GITHUB_CLIENT_IDS|OAUTH_SECRET_KEY|session_token" documents/authentication/oauth-authentication.md
git -c core.fsmonitor=false diff --check -- documents/authentication/oauth-authentication.md
```

Expected: required contracts appear; no whitespace errors; examples contain placeholders only.

- [ ] **Step 6: Commit OAuth guide**

```bash
git add documents/authentication/oauth-authentication.md
git commit --only documents/authentication/oauth-authentication.md -m "docs: add OAuth authentication guide"
```

Expected: only OAuth guide is committed; any unrelated pre-staged paths remain staged.

### Task 2: Add LLM Wiki upload and query guide

**Files:**

- Create: `documents/llm-wiki/llm-wiki.md`
- Reference: `src/app/components/ChatInterface.tsx`
- Reference: `src/platform/http/authenticated-fetch.ts`
- Reference: `src/features/wiki/infrastructure/http-wiki-gateway.ts`
- Reference: `src/generated/backend-api.ts`
- Reference: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/webapp/routes.py`
- Reference: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/thread_wiki/routes.py`
- Reference: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/thread_wiki/service.py`

- [ ] **Step 1: Add overview and storage boundaries**

Create guide with title, workflow summary, return link to `../README.md`, and responsibility table for Browser UI, LangGraph thread client, document API, background wiki ingestion, thread workspace, and query model.

State thread isolation: uploaded sources use `docs/threads/<thread-id>/`; derived wiki workspace uses backend-managed `threads-wiki/<thread-id>/`; wiki context is queried explicitly rather than injected automatically into each research request.

- [ ] **Step 2: Add document-upload and ingestion sequence**

Add Mermaid `sequenceDiagram` covering new/existing thread registration, graph ID metadata, multipart `POST /documents/upload` with `folder=threads/<thread-id>` and repeated `files`, successful saves, automatic ingest trigger, `doc_folder` state update, SSE `/wiki/progress`, `/wiki/status` fallback, and tree/file refresh when ready.

Document accepted static-key and OAuth-session headers, default/max upload constraints only where source confirms them, path normalization, upload response fields, automatic ingestion condition, and partial failure/error reporting.

- [ ] **Step 3: Add LLM Wiki query sequence**

Add Mermaid `sequenceDiagram` covering readiness check, authenticated `POST /threads/{thread_id}/wiki/query`, `question` plus defaulted `file_results`, grounded retrieval from original sources, answer generation, citation validation, optional filing under `/wiki/query/`, and response fields `answer`, `sources_cited`, and nullable `filed_path`.

State that query returns 409 until wiki is ready, durable filing is conditional, derived indexes are navigation aids rather than citation targets, and research-agent use requires explicit `llm_wiki_query` invocation.

- [ ] **Step 4: Add focused endpoint tables and operations**

Document only upload/query workflow endpoints: document upload/list/delete; wiki ingest/status/progress/cancel; tree/file inspection; query; and thread-wiki deletion. Explain deletion consequences, cancellation/retry, readiness troubleshooting, 401/404/409 behavior, read-only deployment restrictions, and link backend upload/wiki guides for the complete API.

- [ ] **Step 5: Run focused guide checks**

Run:

```bash
rg -n "documents/upload|threads/<thread-id>|wiki/progress|wiki/status|wiki/tree|wiki/file|wiki/query|file_results|sources_cited|filed_path|llm_wiki_query" documents/llm-wiki/llm-wiki.md
git -c core.fsmonitor=false diff --check -- documents/llm-wiki/llm-wiki.md
```

Expected: upload and query contracts appear; no graph/insights/lint/Git-import scope creep; no whitespace errors.

- [ ] **Step 6: Commit LLM Wiki guide**

```bash
git add documents/llm-wiki/llm-wiki.md
git commit --only documents/llm-wiki/llm-wiki.md -m "docs: add LLM Wiki workflow guide"
```

Expected: only LLM Wiki guide is committed; any unrelated pre-staged paths remain staged.

### Task 3: Link active guides

**Files:**

- Modify: `documents/README.md`
- Modify: `README.md`

- [ ] **Step 1: Update documentation index**

Under Authentication add OAuth guide before passkeys. Add `LLM Wiki` subsection containing LLM Wiki guide with description limited to upload, ingestion, inspection, grounded query, citations, and cleanup. Add this plan and its approved design specification to History lists.

- [ ] **Step 2: Update root README OAuth section**

Replace backend-only guide as primary explanation with local `[OAuth authentication](documents/authentication/oauth-authentication.md)` link. Retain backend guide as configuration reference. Use `FRONTEND_URLS` terminology matching current backend configuration.

- [ ] **Step 3: Add root README LLM Wiki entry**

Add feature bullet for thread-scoped document upload and grounded LLM Wiki queries. Add concise Usage paragraph linking `[LLM Wiki](documents/llm-wiki/llm-wiki.md)` without duplicating endpoint detail.

- [ ] **Step 4: Verify local links and index coverage**

Run:

```bash
rg -n "oauth-authentication|llm-wiki" README.md documents/README.md
test -f documents/authentication/oauth-authentication.md
test -f documents/llm-wiki/llm-wiki.md
```

Expected: both active guides linked from documentation index and root README; both targets exist.

- [ ] **Step 5: Commit index updates**

```bash
git add README.md documents/README.md
git commit --only README.md documents/README.md -m "docs: link OAuth and LLM Wiki guides"
```

Expected: only two index files are committed; any unrelated pre-staged paths remain staged.

### Task 4: Validate complete documentation set

**Files:**

- Verify: `README.md`
- Verify: `documents/README.md`
- Verify: `documents/authentication/oauth-authentication.md`
- Verify: `documents/llm-wiki/llm-wiki.md`

- [ ] **Step 1: Parse Mermaid diagrams**

Use installed `mermaid` package to extract every `mermaid` fence from both new guides and call `mermaid.parse` for each block.

Run:

```bash
node --input-type=module -e 'import fs from "node:fs"; import mermaid from "mermaid"; for (const file of process.argv.slice(1)) { const blocks = [...fs.readFileSync(file, "utf8").matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1]); for (const block of blocks) await mermaid.parse(block); console.log(`${file}: ${blocks.length} Mermaid blocks parsed`); }' documents/authentication/oauth-authentication.md documents/llm-wiki/llm-wiki.md
```

Expected: four diagrams found; every diagram parses and every participant alias is declared before use.

- [ ] **Step 2: Verify source-backed names**

Compare every documented route, request field, response field, configuration name, lifetime, and error code against targeted UI/generated/backend sources from Task 0.

Expected: no stale endpoint names, singular `FRONTEND_URL` claims, invented behavior, or unsupported security guarantees.

- [ ] **Step 3: Validate relative links**

Run:

```bash
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; const failures = []; for (const file of process.argv.slice(1)) { const text = fs.readFileSync(file, "utf8"); for (const match of text.matchAll(/\[[^\]]+\]\((?!https?:|mailto:|#)([^)#]+)(?:#[^)]+)?\)/g)) { const target = match[1].replace(/^<|>$/g, ""); const resolved = path.resolve(path.dirname(file), decodeURIComponent(target)); if (!fs.existsSync(resolved)) failures.push(`${file}: ${target}`); } } if (failures.length) { console.error(failures.join("\n")); process.exit(1); } console.log("Relative links resolve");' README.md documents/README.md documents/authentication/oauth-authentication.md documents/llm-wiki/llm-wiki.md
```

Expected: `Relative links resolve` and exit 0.

- [ ] **Step 4: Scan for secrets and placeholders**

Run targeted patterns over new guides for provider-secret prefixes, long token-like strings, private key blocks, and local environment-file values.

Expected: no credential-shaped values; examples use `<client-id>`, `<client-secret>`, `<session-token>`, and similarly obvious placeholders.

- [ ] **Step 5: Run repository checks**

Run:

```bash
git -c core.fsmonitor=false diff --check
yarn lint
```

Expected: both commands exit 0.

- [ ] **Step 6: Inspect final repository state**

Repeat Task 0 branch, HEAD, status, and staged-diff commands. Inspect `git diff` and commits created by this plan.

Expected: compare against Task 0 baseline; only approved documentation and index files were added by this plan. Application code, generated clients, unrelated worktree state/staging, and secrets remain untouched.
