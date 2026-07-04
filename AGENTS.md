# AGENTS.md

<!-- threadroot:begin codex-context-optimizer -->
## Threadroot

Use Threadroot as the Codex context optimizer for this repo.

- Before broad exploration, run `threadroot prep "<task>" --memory tiny --json` or use MCP `context_budget`.
- Read the returned `firstReads` before opening unrelated files.
- Keep prompts small; prefer targeted files, compact failure summaries, and diff-focused follow-ups.
- Store local optimizer evidence only under `.codex/threadroot/`; do not create or rely on `.threadroot/`.
- After Codex changes code, run the narrowest relevant verification and inspect `threadroot score latest` when a run was recorded.

Verification commands:
- lint: `yarn lint`
- build: `yarn build`
<!-- threadroot:end codex-context-optimizer -->
