# Passkey Authentication Documentation Implementation Plan

> Historical record: source paths and commands reflect repository state when this
> plan was written. See [current passkey guide](../../authentication/passkey-authentication.md)
> and [documentation index](../../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-stack passkey guide with accurate Mermaid sequence diagrams and link it from frontend and backend setup documentation.

**Architecture:** Keep one detailed guide in UI repository because browser, BFF, and management behavior originate there. Backend README retains deployment configuration and uses a stable absolute GitHub link to the guide. Existing OAuth diagrams remain unchanged.

**Tech Stack:** Markdown, Mermaid `sequenceDiagram`, Next.js BFF, FastAPI, WebAuthn, OAuth, durable auth store

---

User constraint: edit current `main` worktrees only; do not commit or alter staging.

### Task 0: Record repository preflight

**Files:**

- Inspect: UI and backend Git worktrees

- [ ] **Step 1: Capture immutable baseline before guide or README writes**

Record `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, and `git diff --cached --name-only` in both repositories. Expected: both branches are `main`; save HEAD and cached-diff output for final comparison.

### Task 1: Add cross-stack passkey guide

**Files:**

- Create: [`../../authentication/passkey-authentication.md`](../../authentication/passkey-authentication.md)
- Reference: `src/lib/passkey-client.ts`
- Reference: `src/lib/server/passkey-bff.ts`
- Reference: `src/app/components/LoginProviders.tsx`
- Reference: `src/app/components/PasskeyManagementDialog.tsx`
- Reference: `src/lib/oauth-login.ts`
- Reference: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/webapp/auth_store.py`
- Reference: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/webapp/passkeys.py`

- [ ] **Step 1: Add architecture and contract overview**

Document Browser -> Next.js BFF -> FastAPI -> durable auth store and authenticator boundaries. State browser feature detection and visible OAuth fallback; BFF proxy/configured-origin contract and route-specific incoming Origin checks; protected-operation session forwarding; token stripping; and browser cookie behavior.

- [ ] **Step 2: Add enrollment and recovery sequence**

Show initial OAuth enrollment, subsequent recent OAuth or passkey session, `POST /registration/options`, discoverable credential and required user verification, verified `attestation: none`, `POST /registration/verify`, atomic challenge claim before session/cryptographic checks, exact origin/RP/proxy/kind/expiry binding, public credential persistence, and optional backend-generated label.

- [ ] **Step 3: Add identifier-free authentication sequence**

Show options without `allowCredentials`, authenticator account discovery, credential-ID/account lookup, immutable `userHandle`, signature/user-verification/counter checks, session creation, raw token restricted to BFF, cookie issuance, and `/chat` navigation. Distinguish configured BFF origin forwarding from route-specific incoming request-Origin enforcement.

- [ ] **Step 4: Add management and reauthentication sequence**

Show list/rename/revoke protected operations, ten-minute recent-auth check, missing-cookie/Bearer 401, current generic 400 for a present expired or unknown token, stale-valid-session `403 reauth_required`, same-provider OAuth redirect using exact `/chat?manage=passkeys`, dialog reopen, and manual retry without replay.

- [ ] **Step 5: Add deployment/security notes**

Cover five-minute challenge TTL and one-time claim; 24-hour durable sessions stored only by SHA-256 token hash and refresh semantics; default limits of 20 authenticated operations/minute/account and 300 anonymous calls/minute/proxy; ten-passkey account cap; label behavior; multi-domain RP mapping and per-RP enrollment; provider non-linking; final-key deletion; persisted public data versus prohibited private/biometric/raw-OAuth data; and SQLite Azure single-replica constraint.

### Task 2: Link guide from setup documentation

**Files:**

- Modify: `README.md`
- Modify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/README.md`

- [ ] **Step 1: Update UI README links**

Fix backend repository link and add direct link to
[`../../authentication/passkey-authentication.md`](../../authentication/passkey-authentication.md)
after UI BFF configuration.

- [ ] **Step 2: Update backend README link**

Add a concise stable GitHub link from `Passkeys with SQLite on Azure Container Apps` to the cross-stack sequence guide without duplicating diagrams.

### Task 3: Validate documentation

**Files:**

- Verify: [`../../authentication/passkey-authentication.md`](../../authentication/passkey-authentication.md)
- Verify: `README.md`
- Verify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/README.md`

- [ ] **Step 1: Check Mermaid fences and parse diagrams**

Run a Node check using installed `mermaid` dependency to extract and parse every Mermaid block. Expected: three blocks found, all parse successfully, and every participant alias is declared before use.

- [ ] **Step 2: Check endpoint and configuration names**

Run targeted `rg` comparisons against UI routes, `webapp/passkeys.py`, and `webapp/auth_store.py`. Check local Markdown targets exist and README cross-repository links equal the canonical GitHub URLs. Expected: every documented route/key exists and links resolve to intended files.

- [ ] **Step 3: Inspect final diffs and repository state**

Repeat Task 0 commands after edits and compare branch, HEAD, and cached diff. Run `git diff --check`, `git diff --no-index --check /dev/null docs/passkey-authentication.md`, and inspect `git diff -- README.md` plus new file contents in UI repository; run `git diff --check` and inspect `git diff -- README.md` in backend repository. Expected: both remain on `main`, HEAD/cached diff are unchanged, no whitespace errors, and only intended documentation files changed.
