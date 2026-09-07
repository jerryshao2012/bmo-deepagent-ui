# Review Gap Fixes

**Goal:** Fix five reviewed defects and merge verified changes into local main.

**Architecture:** Keep the existing routes and repository APIs. Forward only the caller's session to the backend, which owns session and thread authorization. Use the existing runtime image module for validated, bounded PNG storage. Offset cleanup pagination only by records retained in each page. Run all behavioral test files in isolated processes in CI.

**Scope:** Stream authorization, diagram validation and memory bounds, retention pagination, behavioral CI coverage, worktree lint exclusions. No remote deployment or push.

## Implementation

- Add regression tests for unauthenticated streaming, caller-scoped authorization, denied threads, malformed requests, and stream cancellation. Fix `src/app/api/stream/route.ts` without service-key fallback.
- Add runtime image tests for malformed/non-PNG input, upload limits, expiry, capacity eviction and valid PNG retrieval. Wire `runtime/images.cjs` into `server.cjs` so HTTP routes exercise the validated store.
- Add cleanup tests for multiple pages, mixed recent/expired records and deletion failures in `tests/langgraph-thread-repository.test.ts`. Fix pagination without automatically starting cleanup.
- Add `yarn test` to discover root `tests/*.test.{ts,tsx,mjs}` and run each in a separate Node process, with concurrency capped at four. Add it to CI; repair stale Azure build-script assertion based on the current Docker Hub build contract.
- Exclude `.worktrees/**` from ESLint and `.worktrees` from TypeScript, retaining checks for current source and tests.
- Repair stale deployment/markdown test expectations found by the newly enabled full suite. Restore `.env*` Docker context exclusion required by the existing deployment test. Keep AWS compatible by passing public build arguments and copying runtime modules instead of env files; ECS already injects runtime settings/secrets.

## Verification

Watch new regressions fail before implementing. Then run focused tests, `yarn test`, `yarn test:architecture`, `yarn contract:check`, `yarn lint`, and `yarn build`. Review the diff and merge into local main only after checks pass. Verify the merged tree and leave a clean working directory.
