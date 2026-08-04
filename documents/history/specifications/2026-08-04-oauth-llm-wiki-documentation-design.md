# OAuth and LLM Wiki Documentation Design

## Goal

Add two cross-stack developer guides that match the depth and structure of the
existing passkey authentication guide. Document implemented OAuth authentication
and LLM Wiki document-upload/query workflows without changing application code.

## Documentation structure

Create two active guides and link them from `documents/README.md` and relevant
sections in root `README.md`:

1. `documents/authentication/oauth-authentication.md` covers Google and GitHub
   OAuth configuration, login and callback redirects, durable session handling,
   browser cookie behavior, refresh, logout, provider selection, and security
   boundaries.
2. `documents/llm-wiki/llm-wiki.md` covers thread-scoped uploads, automatic wiki
   ingestion, status and progress reporting, tree/file inspection, grounded wiki
   queries, citations, optional durable filing, and cleanup.

Both guides use concise prose, responsibility tables, focused Mermaid sequence
diagrams, endpoint tables, configuration examples, error behavior, and links to
the backend documentation where deployment-specific detail already exists.

## OAuth guide design

Document Browser -> FastAPI -> Google/GitHub -> durable auth store boundaries.
The primary sequence follows provider selection, `/auth/login/{provider}`, OAuth
state and provider redirect, `/auth/callback/{provider}`, provider identity
resolution, 24-hour application session creation, redirect through
`/login/success`, and `session_token` cookie issuance. A second sequence covers
authenticated API calls, one coordinated refresh after 401, request retry,
invalid-session routing, and logout.

Configuration notes cover provider client IDs and secrets, exact callback URLs,
`FRONTEND_URL`, domain-specific GitHub clients, allowlisted return paths, and the
requirement to keep secrets out of `NEXT_PUBLIC_*` variables. Security notes
distinguish short-lived provider artifacts from application sessions, state that
raw OAuth tokens are not persisted, explain hashed session-token storage, and
note that Google and GitHub accounts are not linked by matching email.

## LLM Wiki guide design

Document Browser -> thread client -> document API -> wiki ingestion service ->
thread wiki workspace -> query model boundaries. The upload sequence follows
thread creation/registration, multipart upload to `threads/{thread_id}`, thread
state `doc_folder`, automatic background ingestion, SSE progress with status
   fallback, and tree/file refresh. The query sequence follows wiki readiness,
`POST /threads/{thread_id}/wiki/query`, grounded retrieval, answer generation,
source citations, optional filing under `wiki/query/`, and response rendering.

Endpoint tables cover upload/list/delete; ingest/status/progress/cancel;
tree/file inspection; query; and thread-wiki deletion.
Operational notes explain thread isolation, authentication headers, accepted
multipart shape, `file_results` behavior, readiness requirements, cancellation,
cleanup, and read-only deployment restrictions. Examples use placeholders only.

## Accuracy and maintenance boundaries

- Treat generated OpenAPI types, current UI integration code, and backend route
  definitions as contract evidence; do not infer undocumented behavior.
- Keep backend-specific setup concise and link its maintained guides rather than
  copying large configuration inventories.
- Never include real client IDs, client secrets, session tokens, API keys, or
  environment-file values in examples.
- Describe current cookie and authentication behavior accurately, including any
  browser-visible session-token limitation, without presenting it as ideal.
- Keep application code, generated API clients, historical documents, staging,
  and unrelated worktree changes untouched.

## Validation

Parse each Mermaid block, confirm participant aliases are declared, verify all
relative links resolve, compare endpoint/config names with current source, run
`git diff --check`, and run `yarn lint`. Review final diff for documentation-only
changes and secret-free examples.
