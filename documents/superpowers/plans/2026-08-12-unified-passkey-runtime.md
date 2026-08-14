# Unified Passkey Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `FRONTEND_URLS` sole backend production-origin list, derive Azure endpoints before builds, rotate passkey proxy credential into managed runtime secrets, and deploy backend before Azure UI without placeholder applications while reserving the Vercel origin.

**Architecture:** Each independently deployed repository owns a tested endpoint resolver with same CLI contract; Container Apps environment `defaultDomain` is endpoint source of truth. Backend derives passkey origins/RP IDs from runtime-injected `FRONTEND_URLS`, including reserved Vercel mapping. Azure apps read rotated secret through Key Vault references. UI `../../../build.sh` remains sole image build/push entry point and writes a validated manifest; Azure deployment only consumes that pinned Docker Hub artifact. This rollout does not mutate or deploy Vercel. Builds never persist derived endpoints or secrets in dotenv files.

**Tech Stack:** Bash 3.2, Azure CLI, Azure Container Apps, Key Vault, Python/FastAPI, Next.js/TypeScript, pytest, Node test runner.

---

## File map

UI repository:

- Create `../../../tests/build-docker-hub.test.mjs`; implement approved split-build contract before passkey changes.
- Create `../../../scripts/resolve-azure-endpoints.sh`.
- Create `../../../scripts/sanitize-passkey-dotenv.mjs`.
- Modify `../../../build.sh`, `../../../deploy-azure-container-app.sh`, `../../../.gitignore`, `../../../.env.docker.example`.
- Modify `../../../tests/deploy-azure-container-app.test.mjs`, `../../../tests/deployment-security.test.mjs`.
- Update `../../../README.md`, `../../authentication/passkey-authentication.md`, `../../deployment/vercel.md`, `../../deployment/azure-container-apps.md`.

Backend repository:

- Create isolated worktree `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/.worktrees/passkey-unified-config` on branch `codex/passkey-unified-config`; backend paths below are relative to it.
- Create `scripts/resolve_azure_endpoints.sh`.
- Create `scripts/sanitize_passkey_dotenv.py`.
- Modify `webapp/passkeys.py`, `../../../build.sh`, `../../../deploy.sh`, `../../../.gitignore`, `.env.example`.
- Modify private ignored `../../../.env.docker` only during production rotation and never stage it.
- Modify `tests/test_passkeys.py`, `tests/test_azure_persistence_scripts.py`.
- Update `documents/guides/authentication.md` and Azure deployment documentation.

Both resolvers accept `--record`. Default compares but never writes. `--record` atomically stores only non-secret environment resource ID, default domain, app names, and derived endpoints after successful deployment. Required inputs are `AZURE_SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `ENV_NAME`, `BACKEND_APP_NAME`, and `UI_APP_NAME`. Output is strict shell-safe assignments for environment ID/domain, backend/UI URLs, combined frontend URLs, OAuth callback URLs, and changed status. Resolver performs exactly one `az containerapp env show`; it never creates an app or queries app FQDN.

### Task 0: Isolate backend work and finish UI split-build prerequisite

**Files:**

- Create backend worktree/branch named in file map.
- Create: `../../../tests/build-docker-hub.test.mjs`
- Modify: `../../../build.sh`, `../../../deploy-azure-container-app.sh`, `../../../.gitignore`

- [ ] Confirm both repositories' starting branches/worktrees are clean; create backend worktree from backend local `main` without touching private ignored files.
- [ ] Implement approved split contract in `..-11-azure-container-apps-ui-deployment-design.md` with RED tests first: `../../../build.sh` is sole build/login/push owner and writes ignored `../../../.deployment-build.json` atomically only after successful Docker Hub push.
- [ ] Make deployment reject missing/malformed/drifted manifest and invalid Docker Hub Key Vault/registry prerequisites before any cloud app mutation, including secret or app update.
- [ ] Remove all runtime/build/login/push/`rsync` dependencies from deployment; preserve unrelated secrets, registries, identities, ingress, traffic, Dapr, networking, template, scale, env, and volumes.
- [ ] Test build → login → push order, PAT only on login stdin, xtrace restoration after PAT unset, prior manifest byte preservation on every failure, and exact build-arg/manifest parity.
- [ ] Run `node --test tests/build-docker-hub.test.mjs tests/deploy-azure-container-app.test.mjs tests/deployment-security.test.mjs`, Bash syntax, `yarn lint`, and `git diff --check`.
- [ ] Commit: `git commit -m "feat: split Container App build and deploy"`.

### Task 1: Backend canonical derivation

**Files:**

- Modify: backend worktree `tests/test_passkeys.py`
- Modify: backend worktree `webapp/passkeys.py`

- [ ] Add failing tests for `PASSKEY_DERIVE_FROM_FRONTEND_URLS=true`: derive exact origins and each origin's own hostname RP ID from `FRONTEND_URLS`.
- [ ] Add rejection tests for explicit RP/origin conflicts (including empty values), missing list, duplicate normalized origins, credentials, non-root paths, query/fragment, wildcard, insecure non-loopback origin, and invalid hostname.
- [ ] Add compatibility test proving absent/false flag preserves current explicit mode.
- [ ] Run `uv run pytest tests/test_passkeys.py -q`; expect new tests to fail for missing canonical mode.
- [ ] Implement a minimal canonical branch in `PasskeyConfig.from_environ`; reuse `_validate_origin` and `_normalize_rp_id`, preserve explicit branch unchanged.
- [ ] Run `uv run pytest tests/test_passkeys.py tests/test_architecture_boundaries.py -q`; expect PASS.
- [ ] Commit: `git commit -m "feat: derive passkey origins from frontend URLs"`.

Desired assertion:

```python
assert config.origin_rp_ids == (
    ("https://ui.example.com", "ui.example.com"),
    (
        "https://bmo-deepagent-ui.vercel.app",
        "bmo-deepagent-ui.vercel.app",
    ),
)
```

### Task 2: Backend endpoint resolver

**Files:**

- Create: backend worktree `scripts/resolve_azure_endpoints.sh`
- Modify: backend worktree `tests/test_azure_persistence_scripts.py`
- Modify: backend worktree `../../../.gitignore`

- [ ] Add fake-`az` tests enforcing exact environment query and no app/create/update calls.
- [ ] Assert deterministic backend/UI/frontends/callback output, first/changed/unchanged comparison, no default-mode write, atomic `--record`, and byte-preserving failures.
- [ ] Assert empty/invalid domain, environment ID, app name, or non-`Succeeded` state fails before mutation.
- [ ] Run focused pytest; expect resolver-absent failure.
- [ ] Implement `set -euo pipefail` resolver, DNS validation, machine-readable stdout, OAuth notice on stderr, same-directory temp file and atomic rename.
- [ ] Run focused pytest and `bash -n scripts/resolve_azure_endpoints.sh`; expect PASS.
- [ ] Commit: `git commit -m "feat: resolve Azure app URLs before deployment"`.

### Task 3: Secure backend build and deployment

**Files:**

- Modify: backend `tests/test_azure_persistence_scripts.py`, `../../../build.sh`, `../../../deploy.sh`
- Create: backend `scripts/sanitize_passkey_dotenv.py`
- Modify locally during production rotation only, never stage: backend `../../../.env.docker`

- [ ] Add failing test: canonical build rejects `../../../.env.docker` containing `PASSKEY_PROXY_SECRET`, `FRONTEND_URLS`, `PASSKEY_ORIGINS`, `PASSKEY_RP_ID`, or `PASSKEY_RP_IDS` before runtime/Azure access.
- [ ] Add failing deploy test for Key Vault secret `PASSKEY-PROXY-SECRET` using existing UAI and runtime `secretRef`.
- [ ] Assert runtime YAML sets resolved `FRONTEND_URLS`, `PASSKEY_DERIVE_FROM_FRONTEND_URLS=true`, `PASSKEY_ENABLED=true`, `PASSKEY_PROXY_ID=web-bff`, and secret-ref `PASSKEY_PROXY_SECRET`.
- [ ] Assert changed endpoint notice prints exact Google/GitHub callbacks and UI homepage, then blocks before app mutation unless process has `OAUTH_REDIRECTS_CONFIRMED=true`.
- [ ] Run focused pytest; expect RED.
- [ ] Add RED tests then implement `scripts/sanitize_passkey_dotenv.py --input FILE --check` and `--sanitize [--capture-secret-to NEW_FILE]`. Strictly parse supported dotenv assignments without sourcing; reject duplicate/malformed protected keys; preserve every unrelated byte and file mode; use same-directory atomic replacement; create capture with `O_EXCL` mode `0600`; print no values; leave input unchanged on every failure.
- [ ] Build calls `--check`. Defer `--sanitize --capture-secret-to` until production rotation can retain compromised credential only in a temporary `0600` file for negative cutover test. Confirm `git check-ignore .env.docker`; never print or stage it.
- [ ] Make build consume resolver-derived endpoints before context staging and enforce private-config rejection.
- [ ] Make deploy strict-parse resolver output, inject runtime settings, force named revision, wait for readiness, and call resolver `--record` only after success.
- [ ] Run `bash -n build.sh deploy.sh scripts/resolve_azure_endpoints.sh` and focused pytest; expect PASS.
- [ ] Commit: `git commit -m "feat: deploy passkeys from managed runtime config"`.

Expected YAML fragments:

```yaml
- name: passkey-proxy-secret
  keyVaultUrl: https://${KV_NAME}.vault.azure.net/secrets/PASSKEY-PROXY-SECRET
  identity: ${USER_IDENTITY_ID}
- name: PASSKEY_PROXY_SECRET
  secretRef: passkey-proxy-secret
```

### Task 4: UI endpoint resolver

**Files:**

- Create: `../../../scripts/resolve-azure-endpoints.sh`
- Modify: `../../../tests/deploy-azure-container-app.test.mjs`, `../../../.gitignore`

- [ ] Add RED tests matching backend resolver query/output/mutation contract and UI app defaults.
- [ ] Implement resolver with same schema and validation; only filename/style may differ.
- [ ] Add normalized parity assertion between resolver copies.
- [ ] Run `node --test tests/deploy-azure-container-app.test.mjs` and Bash syntax; expect PASS.
- [ ] Commit: `git commit -m "feat: resolve UI deployment endpoints"`.

### Task 5: UI build and Azure passkey runtime

**Files:**

- Modify: `../../../tests/deploy-azure-container-app.test.mjs`, `../../../tests/deployment-security.test.mjs`
- Modify: `../../../tests/build-docker-hub.test.mjs`
- Create: `../../../scripts/sanitize-passkey-dotenv.mjs`
- Modify: `../../../build.sh`, `../../../deploy-azure-container-app.sh`, `../../../.env.docker.example`
- Modify private ignored `../../../.env.docker` without staging it.

- [ ] Add failing build test proving `NEXT_PUBLIC_LANGGRAPH_URL` comes from resolver and no placeholder app is created for URL discovery.
- [ ] Extend existing approved split-build RED coverage: `../../../build.sh` alone builds and pushes the Docker Hub image and atomically records exact image/backend/assistant/marker values in ignored `../../../.deployment-build.json`; deployment rejects missing, malformed, or drifted manifests before Azure mutation.
- [ ] Assert deployment never invokes a container runtime, build, login, push, or `rsync`; it consumes only the pinned Docker Hub artifact recorded by `../../../build.sh` and the already-configured Key Vault-backed Docker Hub registry prerequisite.
- [ ] Add failing deploy tests for existing UI system-assigned identity Key Vault reference (`identityref:system`) and runtime values: enabled, resolved Azure origin, default proxy ID, secret reference. Backend alone retains its existing UAI.
- [ ] Assert changed OAuth endpoints prevent secret/app mutation until process-local confirmation; success records endpoint metadata only after revision and HTTP verification.
- [ ] Assert image/build context never contains proxy secret or private `../../../.env.docker`.
- [ ] Run focused tests; expect RED.
- [ ] Remove production passkey origin/proxy duplication from tracked example. Add RED tests then implement `scripts/sanitize-passkey-dotenv.mjs --input FILE --check|--sanitize` with same strict parse, byte-preserving atomic rewrite, mode preservation, no-value output, and failure guarantees as backend helper. Build calls `--check`; defer private-file `--sanitize` until production rotation and never print or stage it.
- [ ] Integrate strict resolver parsing in build/deploy; never `eval` arbitrary output and never let `../../../env.sh` rewrite `../../../.env.docker` on these paths. Preserve build-manifest byte content on every build/login/push/write failure.
- [ ] Remove legacy ACR build/push logic from deployment and keep registry/application updates state-preserving; do not replace unrelated secrets, registries, ingress, traffic, template, scale, env, or volume state.
- [ ] Preserve exact runtime/build/push error statuses and existing clean build context.
- [ ] Run focused tests, `yarn test:passkeys`, and Bash syntax; expect PASS.
- [ ] Commit: `git commit -m "feat: deploy UI passkeys from Key Vault"`.

### Task 6: Documentation and examples

**Files:** UI/backend documentation listed in file map.

- [ ] Replace duplicated examples with `FRONTEND_URLS`, derivation flag, and enabled flag.
- [ ] Document legacy explicit mode, exact origin validation, reserved Vercel origin/RP mapping, secret ownership, environment-domain URL derivation, and backend → Azure UI rollout.
- [ ] Document that this rollout never mutates Vercel; future Vercel activation requires then-current server-only secret, canonical origin/proxy ID, deployment, and verification before user traffic.
- [ ] Document OAuth notice and exact Google/GitHub callback/homepage values; environment recreation requires provider updates before traffic.
- [ ] Update doc assertions, run `yarn format:check` and backend focused pytest.
- [ ] Commit docs separately in each repo as `docs: document unified passkey deployment`.

### Task 7: Full local verification and review

- [ ] UI: `yarn test:passkeys`.
- [ ] UI: run deploy and security Node test files.
- [ ] UI: `yarn lint`, `yarn build`, `git diff --check`.
- [ ] Backend: focused pytest for passkeys and Azure scripts.
- [ ] Backend: `uv run ruff check` on changed Python/tests; Bash syntax and `git diff --check`.
- [ ] Request focused code review for derivation, resolver parity, no-secret guarantees, OAuth gate, Azure YAML preservation, reserved Vercel mapping, and error propagation.
- [ ] Fix Critical/Important findings and rerun affected/full suites.

### Task 8: Local integration

- [ ] Ensure both feature worktrees are clean and commits scoped.
- [ ] Merge backend `codex/passkey-unified-config` into backend local `main`; rerun narrow smoke tests from `/Users/jerryshao/Documents/projects/IBM/ai/deep-research`.
- [ ] Merge UI `codex/passkey-unified-config` into UI local `main`; rerun narrow smoke tests from `/Users/jerryshao/Documents/projects/IBM/ai/bmo-deepagent-ui`.
- [ ] Confirm operator-owned ignored files were never copied into worktrees or staged. All remaining production commands run only from these two main checkouts, where ignored dotenv state lives.
- [ ] Do not push or open PRs unless separately requested.

### Task 9: Production rotation and deployment

Requires explicit Azure write approval. Never log secret values. Do not mutate Vercel.

- [ ] Run every step from the two local `main` checkouts named in Task 8, never from feature worktrees.
- [ ] Resolve endpoints before builds in both repos; verify identical output and show exact provider-console values.
- [ ] User updates Google/GitHub provider settings and exports process-local `OAUTH_REDIRECTS_CONFIRMED=true`.
- [ ] Create private temp directory with `umask 077`; define `OLD_SECRET_FILE` and `NEW_SECRET_FILE` within it and install EXIT trap before credential access. From backend main, require `../../../.env.docker`, then run `uv run python scripts/sanitize_passkey_dotenv.py --input .env.docker --sanitize --capture-secret-to "$OLD_SECRET_FILE"`. From UI main, run `node scripts/sanitize-passkey-dotenv.mjs --input .env.docker --sanitize` only when `../../../.env.docker` exists; xtrace remains disabled throughout.
- [ ] Generate at least 48 new random bytes directly into `"$NEW_SECRET_FILE"`; confirm both temp files are mode `0600` without reading values. Backend helper `--check` requires its configured file; UI build and helper treat absent `../../../.env.docker` as valid no-private-config state, otherwise run UI `--check`. Set Key Vault `PASSKEY-PROXY-SECRET` via `az keyvault secret set --file "$NEW_SECRET_FILE"`. Record only secret ID/version.
- [ ] Build/deploy backend first. Verify ready revision, derived Azure+Vercel mapping, Key Vault/UAI/secretRef, new secret accepted, wrong secret and request signed from `"$OLD_SECRET_FILE"` both receive exact 403, and new image lacks private passkey secret. Deactivate old revision.
- [ ] Run UI `../../../build.sh` once with resolved backend URL, then run deployment once against its pinned Docker Hub manifest; verify ready/zero restarts, Key Vault ref, root/login 200, and `/api/auth/passkeys` exact backend rejection rather than `passkeys_unavailable`.
- [ ] On Azure UI: OAuth login, **Manage passkeys** visible, list keys, start/cancel registration, preserve OAuth recovery; do not delete credentials.
- [ ] Confirm no Vercel CLI/API call occurred and reserved Vercel origin-to-RP derivation remains covered by tests only.
