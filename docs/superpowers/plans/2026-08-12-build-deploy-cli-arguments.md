# Build and Deployment Command Arguments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent container-runtime arguments to both build scripts and a dedicated process-local OAuth confirmation flag to both Azure deployment scripts while preserving existing environment-variable compatibility and security boundaries.

**Architecture:** Each script parses and validates arguments before configuration or side effects. Frontend normalizes runtime input into existing `CONTAINER_CLI`; backend resolves CLI → new `CONTAINER_CLI` → legacy `CONTAINER_RUNTIME` → auto-detection, then uses existing `CONTAINER_RUNTIME` adapter. Deployment flags set only an in-memory boolean consumed by the existing endpoint-change gate.

**Tech Stack:** Bash 3.2, Node.js built-in test runner, Python pytest, existing fake-runtime and fake-Azure harnesses.

---

## File map

UI worktree: `/Users/jerryshao/Documents/projects/IBM/ai/bmo-deepagent-ui/.worktrees/passkey-enrollment-recovery`

- Modify `build.sh`: early runtime/help parser and CLI precedence.
- Modify `deploy-azure-container-app.sh`: early OAuth-confirmation/help parser.
- Modify `tests/build-docker-hub.test.mjs`: black-box build argument tests.
- Modify `tests/deploy-azure-container-app.test.mjs`: black-box deploy argument tests.
- Modify `README.md`: operator examples.

Backend worktree: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/.worktrees/passkey-enrollment-recovery`

- Modify `build.sh`: early runtime/help parser and alias normalization.
- Modify `deploy.sh`: dedicated OAuth-confirmation option.
- Modify `tests/test_container_runtime_scripts.py`: runtime precedence tests.
- Modify `tests/test_azure_persistence_scripts.py`: side-effect and deploy option tests.
- Modify `documents/deployment/azure/README.md`: operator examples.

No generic parser module is added. Scripts have different security bootstraps and internal runtime names, so a shared cross-repository file adds coupling without useful reuse.

### Task 1: Frontend build runtime option

**Files:**

- Modify: `build.sh` at script entry and protected-variable cleanup
- Modify: `tests/build-docker-hub.test.mjs` in `runBuild` and runtime cases
- Modify: `README.md`

- [ ] **Step 1: Extend fixture argument support**

Add `args = []` to `runBuild` and invoke:

```js
spawnSync("/bin/bash", [path.join(fixtureRoot, "build.sh"), ...args], {
  cwd: fixtureRoot,
  env,
  encoding: "utf8",
});
```

- [ ] **Step 2: Write failing black-box cases**

Cover all accepted forms:

```text
./build.sh --container-cli podman
./build.sh --container-cli=podman
./build.sh -c podman
```

Cover CLI-over-environment precedence, environment-only fallback, missing/empty/unsupported values, duplicate same and conflicting flags, `-cpodman`, unknown arguments, unavailable selected runtime, `--help`, and `-h`. Invalid/help cases assert no resolver, dotenv, runtime, registry, build context, or manifest action.

- [ ] **Step 3: Run RED**

```bash
node --test --test-isolation=none tests/build-docker-hub.test.mjs
```

Expected: new cases fail because `build.sh` does not parse arguments.

- [ ] **Step 4: Implement minimal Bash 3.2 parser**

Before configuration loading, add:

```bash
print_usage() {
  echo "Usage: ./build.sh [--container-cli RUNTIME|-c RUNTIME]"
  echo "       ./build.sh --container-cli=RUNTIME"
  echo "RUNTIME: container, podman, or docker"
}

CLI_CONTAINER_CLI=""
CLI_CONTAINER_CLI_SEEN=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      [ "$#" -eq 1 ] || { echo "Error: --help must be used alone." >&2; exit 64; }
      print_usage
      exit 0
      ;;
    --container-cli|-c)
      [ "$CLI_CONTAINER_CLI_SEEN" = false ] || { echo "Error: container runtime option may be supplied only once." >&2; exit 64; }
      [ "$#" -ge 2 ] || { echo "Error: $1 requires a runtime value." >&2; exit 64; }
      CLI_CONTAINER_CLI="$2"
      CLI_CONTAINER_CLI_SEEN=true
      shift 2
      ;;
    --container-cli=*)
      [ "$CLI_CONTAINER_CLI_SEEN" = false ] || { echo "Error: container runtime option may be supplied only once." >&2; exit 64; }
      CLI_CONTAINER_CLI="${1#--container-cli=}"
      [ -n "$CLI_CONTAINER_CLI" ] || { echo "Error: --container-cli requires a runtime value." >&2; exit 64; }
      CLI_CONTAINER_CLI_SEEN=true
      shift
      ;;
    *) echo "Error: unknown argument '$1'." >&2; exit 64 ;;
  esac
done
case "$CLI_CONTAINER_CLI" in
  ""|container|podman|docker) ;;
  *) echo "Error: container runtime must be one of: container, podman, docker." >&2; exit 64 ;;
esac
```

Protect parser state from inherited/sourced values. After the existing isolated configuration boundary, apply CLI value only when seen; otherwise retain current `CONTAINER_CLI` behavior. Keep adapter availability/readiness semantics.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test --test-isolation=none tests/build-docker-hub.test.mjs tests/container-runtime.test.mjs
yarn lint
yarn prettier --check tests/build-docker-hub.test.mjs README.md
bash -n build.sh scripts/container-runtime.sh
git diff --check
git add build.sh tests/build-docker-hub.test.mjs README.md
git commit -m "feat: add UI build runtime option"
```

Document accepted forms, precedence, and environment compatibility.

### Task 2: Backend build runtime option and aliases

**Files:**

- Modify: `build.sh` before `source env.sh` and build transaction
- Modify: `tests/test_container_runtime_scripts.py`
- Modify: `tests/test_azure_persistence_scripts.py`
- Modify: `documents/deployment/azure/README.md`

- [ ] **Step 1: Write failing cases**

Mirror Task 1 forms/errors/help and prove:

```text
CLI -> CONTAINER_CLI -> CONTAINER_RUNTIME -> automatic selection
```

Assert CLI overrides conflicting aliases; new `CONTAINER_CLI=podman` works; legacy `CONTAINER_RUNTIME=podman` works; matching aliases work; conflicting aliases without CLI exit 64 before `env.sh`, resolver, version mutation, credential loading, runtime startup, build, login, or push.

- [ ] **Step 2: Run RED**

```bash
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run pytest -q \
  tests/test_container_runtime_scripts.py tests/test_azure_persistence_scripts.py \
  -k "container_cli_argument or container_runtime_argument or runtime_alias or build_help"
```

- [ ] **Step 3: Implement normalization**

Use Task 1 parser. Snapshot inherited aliases in parser-owned variables, validate supported values, unset both public aliases before sourcing configuration, then normalize only from the protected snapshots after the source boundary:

```bash
if [ "$CLI_CONTAINER_CLI_SEEN" = true ]; then
  CONTAINER_RUNTIME="$CLI_CONTAINER_CLI"
elif [ "${CALLER_CONTAINER_CLI_WAS_SET}" = true ]; then
  if [ "${CALLER_CONTAINER_RUNTIME_WAS_SET}" = true ] \
    && [ "$CALLER_CONTAINER_CLI" != "$CALLER_CONTAINER_RUNTIME" ]; then
    echo "Error: CONTAINER_CLI and CONTAINER_RUNTIME disagree." >&2
    exit 64
  fi
  CONTAINER_RUNTIME="$CALLER_CONTAINER_CLI"
elif [ "${CALLER_CONTAINER_RUNTIME_WAS_SET}" = true ]; then
  CONTAINER_RUNTIME="$CALLER_CONTAINER_RUNTIME"
fi
```

When CLI is present, conflicting aliases do not block. Add every parser-owned snapshot name to protected-variable boundaries so inherited shell state and sourced configuration cannot overwrite it. Explicitly unset `CONTAINER_CLI` and `CONTAINER_RUNTIME` before `source env.sh`; do not accept a runtime choice originating from sourced configuration. Do not change adapter APIs. Keep version transaction after argument and alias validation.

- [ ] **Step 4: Run GREEN and commit**

```bash
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run pytest -q \
  tests/test_container_runtime_scripts.py tests/test_azure_persistence_scripts.py
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run pytest -q tests/test_passkeys.py
/bin/bash -n build.sh scripts/container_runtime.sh
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run ruff check \
  tests/test_container_runtime_scripts.py tests/test_azure_persistence_scripts.py
git diff --check
git add build.sh tests/test_container_runtime_scripts.py \
  tests/test_azure_persistence_scripts.py documents/deployment/azure/README.md
git commit -m "feat: add backend build runtime option"
```

Docs make `--container-cli podman` primary and retain both environment aliases.

### Task 3: Frontend OAuth confirmation option

**Files:**

- Modify: `deploy-azure-container-app.sh` before configuration loading
- Modify: `tests/deploy-azure-container-app.test.mjs`
- Modify: `README.md`

- [ ] **Step 1: Add failing deploy cases**

Extend harness arguments. Cover changed endpoints with flag, missing confirmation block, existing environment compatibility, flag overriding absent/false environment, unchanged endpoints with/without flag, duplicate flag, value-bearing form, unknown argument, side-effect-free `--help` and `-h`, and help mixed with another argument.

- [ ] **Step 2: Run RED**

```bash
node --test --test-isolation=none \
  --test-name-pattern="oauth confirmation argument|deployment help" \
  tests/deploy-azure-container-app.test.mjs
```

- [ ] **Step 3: Implement dedicated boolean parser**

Before `env.sh` access:

```bash
CLI_OAUTH_REDIRECTS_CONFIRMED=false
CLI_OAUTH_REDIRECTS_CONFIRMED_SEEN=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      [ "$#" -eq 1 ] || { echo "Error: --help must be used alone." >&2; exit 64; }
      print_usage
      exit 0
      ;;
    --oauth-redirects-confirmed)
      [ "$CLI_OAUTH_REDIRECTS_CONFIRMED_SEEN" = false ] || { echo "Error: --oauth-redirects-confirmed may be supplied only once." >&2; exit 64; }
      CLI_OAUTH_REDIRECTS_CONFIRMED=true
      CLI_OAUTH_REDIRECTS_CONFIRMED_SEEN=true
      shift
      ;;
    *) echo "Error: unknown argument '$1'." >&2; exit 64 ;;
  esac
done
```

After isolated `env.sh`, set exact true only when CLI flag was seen; otherwise restore caller environment. Never persist the value or add a false/short form.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test --test-isolation=none tests/deploy-azure-container-app.test.mjs \
  tests/deployment-security.test.mjs
yarn test:passkeys
yarn lint
yarn prettier --check tests/deploy-azure-container-app.test.mjs README.md
bash -n deploy-azure-container-app.sh
git diff --check
git add deploy-azure-container-app.sh tests/deploy-azure-container-app.test.mjs README.md
git commit -m "feat: add UI OAuth confirmation option"
```

### Task 4: Backend OAuth confirmation option

**Files:**

- Modify: `deploy.sh` existing parser/help
- Modify: `tests/test_azure_persistence_scripts.py`
- Modify: `documents/deployment/azure/README.md`

- [ ] **Step 1: Add failing backend cases**

Mirror Task 3 exactly. Cover a duplicate flag, `--oauth-redirects-confirmed=<value>`, an unknown argument, `--help` and `-h` alone, and each help form mixed with another argument. Every invalid or mixed case exits 64; help alone exits 0. Assert every invalid/help path has zero `source env.sh`, sanitizer, resolver, Azure metadata-read, or PATCH calls.

- [ ] **Step 2: Run RED**

```bash
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run pytest -q \
  tests/test_azure_persistence_scripts.py \
  -k "oauth_confirmation_argument or deploy_help"
```

- [ ] **Step 3: Extend existing parser**

Accept exactly `--oauth-redirects-confirmed`, reject duplicates, keep value-bearing forms unknown, and update:

```text
Usage: ./deploy.sh [--oauth-redirects-confirmed] [--help]
```

The flag sets only process-local `OAUTH_REDIRECTS_CONFIRMED=true`; existing environment behavior and `CHANGED=true` gate remain.

- [ ] **Step 4: Run GREEN and commit**

```bash
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run pytest -q \
  tests/test_azure_persistence_scripts.py tests/test_passkeys.py
/bin/bash -n deploy.sh
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run ruff check \
  tests/test_azure_persistence_scripts.py
git diff --check
git add deploy.sh tests/test_azure_persistence_scripts.py \
  documents/deployment/azure/README.md
git commit -m "feat: add backend OAuth confirmation option"
```

### Task 5: Cross-repository verification and integration review

**Files:**

- Verify only; edit only concrete regression fixes

- [ ] **Step 1: Run complete UI affected suites**

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/bmo-deepagent-ui/.worktrees/passkey-enrollment-recovery
node --test --test-isolation=none tests/build-docker-hub.test.mjs \
  tests/container-runtime.test.mjs tests/deploy-azure-container-app.test.mjs \
  tests/deployment-security.test.mjs
yarn test:passkeys
yarn lint
bash -n build.sh deploy-azure-container-app.sh scripts/container-runtime.sh
yarn prettier --check tests/build-docker-hub.test.mjs \
  tests/deploy-azure-container-app.test.mjs README.md
git diff --check 33b93d1..HEAD
```

- [ ] **Step 2: Run complete backend affected suites**

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/deep-research/.worktrees/passkey-enrollment-recovery
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run pytest -q \
  tests/test_container_runtime_scripts.py tests/test_azure_persistence_scripts.py \
  tests/test_passkeys.py
/bin/bash -n build.sh deploy.sh scripts/container_runtime.sh
UV_CACHE_DIR=/private/tmp/uv-cache-passkey-recovery uv run ruff check \
  tests/test_container_runtime_scripts.py tests/test_azure_persistence_scripts.py
git diff --check a74b839..HEAD
```

- [ ] **Step 3: Inspect invariants**

Confirm invalid/help arguments cause no config, resolver, runtime, registry, Azure, or version action; runtime precedence matches spec; OAuth confirmation remains process-local and absent from dotenv/manifests/endpoint records/REST bodies; deploy scripts retain no secret, permission, identity, registry, or infrastructure mutation beyond approved template update.

- [ ] **Step 4: Independent final review**

Review both feature ranges for spec and quality. Fix and rerun until no Critical or Important findings remain.

- [ ] **Step 5: Merge and resume rollout**

Merge both feature branches into local `main`, rerun focused suites from main checkouts containing operator-owned ignored configuration, then resume approved backend-first build/deploy followed by frontend build/deploy.
