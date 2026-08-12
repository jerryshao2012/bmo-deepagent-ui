# Passkey Enrollment Visibility and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide unusable passkey login until this browser has observed an enrollment, and make passkey management recover cleanly from stale or invalid OAuth sessions.

**Architecture:** Backend separates live-session listing from recent-auth mutations and returns an exact session error for missing/expired sessions. UI adds a tiny non-secret positive marker adapter, uses it to gate login, and turns known management failures into safe actionable recovery. Rollout rebuilds and deploys backend first, then UI, using existing update-only Azure scripts without permission changes.

**Tech Stack:** Python 3.12, FastAPI, pytest, TypeScript, React 19, Next.js 16, Node test runner, Testing Library, WebAuthn, Docker, Azure Container Apps.

---

## File map

### Backend repository: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research`

- Modify `webapp/passkeys.py`: exact live-session exception and non-recent credential listing.
- Modify `tests/test_passkeys.py`: service and route regression coverage.
- Modify `deploy.sh`: validate existing secret/registry references and omit
  `properties.configuration.secrets` and registries from update payload.
- Modify `build.sh`: roll back build-owned version state on build/login/push
  failure and publish `.build_version` only after successful push.
- Modify `scripts/render_azure_containerapp_config.py`: render only mutable
  template/environment fields.
- Modify `scripts/merge_azure_containerapp_config.py`: strip immutable/security
  configuration from update YAML.
- Modify `tests/test_azure_persistence_scripts.py`: forbid secret, permission,
  identity, and Key Vault mutation in deployment.
- Create `scripts/snapshot_azure_passkey_metadata.py`: deterministic,
  metadata-only Azure security snapshot and comparison CLI.

### UI repository: `/Users/jerryshao/Documents/projects/IBM/ai/bmo-deepagent-ui`

- Create `src/lib/passkey-enrollment-state.ts`: browser-local positive marker adapter.
- Create `tests/passkey-enrollment-state.test.ts`: marker parsing, storage failure, and sticky semantics.
- Modify `src/app/components/LoginProviders.tsx`: require configuration, WebAuthn support, and marker.
- Modify `src/app/components/PasskeyManagementDialog.tsx`: set marker after authoritative positive results and map recoverable errors.
- Modify `tests/passkey-login.test.tsx`: login visibility contract.
- Modify `tests/passkey-management.test.tsx`: marker and error-recovery behavior.
- Modify `package.json`: include new marker test in `test:passkeys`.
- Modify `deploy-azure-container-app.sh`: validate all existing Key Vault-backed
  app secret references and remove `containerapp secret set`.
- Modify `tests/deploy-azure-container-app.test.mjs`: require read-only secret
  preflight and forbid secret/permission/identity mutation.

### Rollout artifacts

- Backend `.resolved-azure-endpoints.json` and `.build_version`: existing ignored/generated files only.
- UI `.resolved-azure-endpoints.json` and `.deployment-build.json`: existing ignored/generated files only.

## Task 1: Backend live-session semantics

**Files:**

- Modify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/tests/test_passkeys.py`
- Modify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/webapp/passkeys.py`

- [ ] **Step 1: Write failing service tests**

Add focused tests proving a session older than ten minutes can list credentials, while registration, rename, and deletion still raise `ReauthenticationRequired`:

```python
def test_stale_live_session_can_list_but_cannot_mutate_passkeys(passkey_service):
    service, store, _user, oauth_token = passkey_service
    store.create_credential(
        identity="google:subject-123",
        rp_id="example.com",
        credential_id="credential_stale",
        public_key=b"public-key",
        sign_count=0,
        transports=["internal"],
        device_type="single_device",
        backed_up=False,
        label="Laptop",
    )
    with store._lock:
        store._connection.execute(
            "UPDATE auth_sessions SET authenticated_at = ?",
            (time.time() - 601,),
        )

    assert service.list_credentials(oauth_token)[0]["label"] == "Laptop"
    with pytest.raises(ReauthenticationRequired):
        service.rename_credential(oauth_token, "credential_stale", "Renamed")
    with pytest.raises(ReauthenticationRequired):
        service.delete_credential(oauth_token, "credential_stale")
```

- [ ] **Step 2: Write failing route tests for expired sessions**

Delete or expire the test session, then assert list and protected management routes return exact `401 {"code": "invalid_session"}`. Retain existing exact `403 reauth_required` test for a live stale registration request and existing generic `400` invalid-input tests.

- [ ] **Step 3: Run RED tests**

Run:

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/deep-research
uv run pytest -q \
  tests/test_passkeys.py::test_stale_live_session_can_list_but_cannot_mutate_passkeys \
  tests/test_passkeys.py::test_expired_session_returns_exact_management_error
```

Expected: FAIL because listing still requires recent auth and `_live_session` raises `InvalidPasskeyError`.

- [ ] **Step 4: Implement minimal backend change**

Change `_live_session` to raise `InvalidPasskeySessionError` when no live session exists, and change listing only:

```python
def _live_session(self, session_token: str, *, recent: bool = True):
    detail = self.store.get_session_detail(session_token)
    if detail is None:
        raise InvalidPasskeySessionError("Invalid or expired session")
    # existing rate-limit and recent-auth checks remain unchanged

def list_credentials(self, session_token: str) -> list[dict[str, Any]]:
    detail = self._live_session(session_token, recent=False)
    # existing serialization remains unchanged
```

- [ ] **Step 5: Run backend GREEN tests**

Run:

```bash
uv run pytest -q tests/test_passkeys.py
uv run pytest -q tests/test_architecture_boundaries.py tests/test_frontend_api_contract.py
uv run ruff check webapp/passkeys.py tests/test_passkeys.py
uv run ruff format --check webapp/passkeys.py tests/test_passkeys.py
git diff --check
```

Expected: all pass; no snapshot drift beyond intentional version behavior.

- [ ] **Step 6: Commit backend fix**

```bash
git add webapp/passkeys.py tests/test_passkeys.py
git commit -m "fix: recover passkey management sessions"
```

## Task 2: UI positive enrollment marker

**Files:**

- Create: `src/lib/passkey-enrollment-state.ts`
- Create: `tests/passkey-enrollment-state.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing marker tests**

Test absent, exact-version present, malformed, blocked-storage, and sticky behavior. The adapter API should be:

```ts
export const PASSKEY_ENROLLMENT_MARKER_KEY = "passkey_enrollment_seen_v1";
export function hasSeenPasskeyEnrollment(
  storage?: PasskeyEnrollmentStorage | null
): boolean;
export function rememberPasskeyEnrollment(
  storage?: PasskeyEnrollmentStorage | null
): boolean;
```

`rememberPasskeyEnrollment` writes only the literal value `"1"`. No clear helper is provided because account-specific empty/deletion results must not erase browser-wide positive evidence.

- [ ] **Step 2: Add test script entry and run RED**

Add `tests/passkey-enrollment-state.test.ts` to `test:passkeys`, then run:

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/bmo-deepagent-ui
node --import tsx --test --test-isolation=none tests/passkey-enrollment-state.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement minimal safe adapter**

Use a `Pick<Storage, "getItem" | "setItem">`, a guarded `window.localStorage` accessor, exact `"1"` parsing, and catch storage exceptions. Do not store account identity, provider, label, credential ID, or timestamps.

- [ ] **Step 4: Run marker GREEN tests**

Run the same focused command. Expected: all pass.

- [ ] **Step 5: Commit marker adapter**

```bash
git add package.json src/lib/passkey-enrollment-state.ts tests/passkey-enrollment-state.test.ts
git commit -m "feat: remember successful passkey enrollment"
```

## Task 3: Gate passkey login with marker

**Files:**

- Modify: `src/app/components/LoginProviders.tsx`
- Modify: `tests/passkey-login.test.tsx`

- [ ] **Step 1: Write failing visibility tests**

Change the existing “shows passkey sign-in” test to set the marker first. Add a test proving configured passkeys plus WebAuthn support still hides the button when marker is absent. Add a malformed-marker test.

Seed the exact positive marker in every existing fixture that clicks or inspects
the passkey button, including duplicate-ceremony and passkey-failure recovery
tests. Leave WebAuthn-unavailable, runtime-disabled, absent-marker, and
malformed-marker fixtures unseeded.

- [ ] **Step 2: Run RED test**

```bash
node --import tsx --test --test-isolation=none \
  --test-name-pattern="marker|enrollment" tests/passkey-login.test.tsx
```

Expected: absent-marker case FAIL because current component uses only runtime configuration and WebAuthn support.

- [ ] **Step 3: Implement login gating**

Import `hasSeenPasskeyEnrollment` and compute:

```ts
setPasskeysSupported(
  passkeysEnabled && supportsPasskeys() && hasSeenPasskeyEnrollment()
);
```

Do not remove Google/GitHub buttons or remembered OAuth account behavior.

- [ ] **Step 4: Run GREEN tests**

```bash
node --import tsx --test --test-isolation=none tests/passkey-login.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit login gating**

```bash
git add src/app/components/LoginProviders.tsx tests/passkey-login.test.tsx
git commit -m "fix: hide passkey login before enrollment"
```

## Task 4: Recover management failures and record enrollment

**Files:**

- Modify: `src/app/components/PasskeyManagementDialog.tsx`
- Modify: `tests/passkey-management.test.tsx`

- [ ] **Step 1: Write failing marker tests**

Inject real `localStorage` through the adapter and prove:

- successful non-empty list sets marker;
- successful enrollment sets marker;
- successful empty list does not clear an existing marker;
- deletion of last listed credential does not clear an existing marker;
- request or malformed-response failure does not create a marker.

- [ ] **Step 2: Write failing recovery tests**

Add exact cases:

```ts
json({ code: "reauth_required" }, { status: 403 });
json({ code: "invalid_session" }, { status: 401 });
json({ code: "authentication_required" }, { status: 401 });
json({ code: "rate_limited" }, { status: 429 });
json({ code: "authentication_service_unavailable" }, { status: 502 });
json({ code: "passkeys_unavailable" }, { status: 503 });
```

For missing or invalid backend provider, assert dialog falls back to its
authenticated `provider` prop and renders `Verify with Google` or
`Verify with GitHub`. Assert reauth navigation still uses the exact existing
allowlisted return path. Assert 429 and 502/503 messages are specific but
contain no backend body, token, credential, or proxy data. Add malformed JSON,
unknown status/code pair, and mismatched known-code tests proving the generic
fallback remains. Retain cancellation-neutral coverage.

- [ ] **Step 3: Run RED tests**

```bash
node --import tsx --test --test-isolation=none \
  --test-name-pattern="marker|invalid session|rate limit|unavailable|provider fallback" \
  tests/passkey-management.test.tsx
```

Expected: FAIL on absent marker writes and generic error mapping.

- [ ] **Step 4: Implement minimal recovery mapping**

After authoritative list/enrollment success, call `rememberPasskeyEnrollment()` only when a credential exists. Update `handleError` to:

```ts
if (caught instanceof ManagementRequestError) {
  if (
    (caught.status === 403 && caught.code === "reauth_required") ||
    (caught.status === 401 && caught.code === "invalid_session") ||
    (caught.status === 401 && caught.code === "authentication_required")
  ) {
    setReauthProvider(
      caught.status === 403 && caught.provider ? caught.provider : provider
    );
    return;
  }
  if (caught.status === 429 && caught.code === "rate_limited") {
    setError("Too many passkey requests. Wait one minute, then retry.");
    return;
  }
  if (
    (caught.status === 502 &&
      caught.code === "authentication_service_unavailable") ||
    (caught.status === 503 && caught.code === "passkeys_unavailable")
  ) {
    setError(
      "Passkey service is temporarily unavailable. Use Google or GitHub, or retry later."
    );
    return;
  }
}
```

Keep cancellation neutral and unknown failures generic. Include `provider` in callback dependencies.

The 401 tests must include a conflicting valid backend provider and prove the
dialog prop wins. The 403 test may accept a validated backend provider, with
the dialog prop as fallback. Mismatched 502/503 code pairs remain generic.

- [ ] **Step 5: Run UI GREEN tests**

```bash
yarn test:passkeys
yarn test:remembered-login
yarn lint
yarn prettier --check \
  package.json \
  src/lib/passkey-enrollment-state.ts \
  src/app/components/LoginProviders.tsx \
  src/app/components/PasskeyManagementDialog.tsx \
  tests/passkey-enrollment-state.test.ts \
  tests/passkey-login.test.tsx \
  tests/passkey-management.test.tsx
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit UI recovery**

```bash
git add src/app/components/PasskeyManagementDialog.tsx tests/passkey-management.test.tsx
git commit -m "fix: recover passkey management failures"
```

## Task 5: Make both deploy scripts secret-immutable

**Backend files:**

- Modify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/build.sh`
- Modify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/deploy.sh`
- Modify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/scripts/render_azure_containerapp_config.py`
- Modify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/scripts/merge_azure_containerapp_config.py`
- Create: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/scripts/snapshot_azure_passkey_metadata.py`
- Modify: `/Users/jerryshao/Documents/projects/IBM/ai/deep-research/tests/test_azure_persistence_scripts.py`

**UI files:**

- Modify: `deploy-azure-container-app.sh`
- Modify: `tests/deploy-azure-container-app.test.mjs`
- Modify: `tests/deployment-security.test.mjs`

- [ ] **Step 1: Write failing backend deployment tests**

Extend the fake-Azure deployment harness to assert:

- all required existing app secrets are read with metadata-only
  `az containerapp secret list` and match exact unversioned Key Vault URLs plus
  selected identity;
- existing `docker.io` registry uses expected username and
  `passwordSecretRef=docker-hub-pat`;
- update YAML contains no `properties.configuration.secrets`, registries,
  identity, access policies, or role assignments;
- no command invokes `containerapp secret set`, Key Vault writes,
  role/access-policy writes, or identity assignment;
- one exact `az rest --method patch` targets the existing app resource using
  stable `api-version=2025-07-01`, and its JSON contains only existing
  `location` plus `properties.template`;
- no command requests secret values or invokes a list-secrets-with-values path;
- missing/mismatched existing secret or registry metadata exits before
  the ARM PATCH.

Also add fake-runtime build tests proving:

- build refuses to start if tracked `webapp/config.py` already has unrelated
  working-tree changes;
- build, login, push, or cleanup failure restores exact prior
  `webapp/config.py` bytes and exact prior `.build_version` state (including
  absence);
- retry after a failed build increments only once;
- successful push retains exactly one API patch increment and atomically writes
  the matching new `.build_version` only after push succeeds;
- failure recovery never resets, checks out, or overwrites any other path.

- [ ] **Step 2: Run backend deployment RED tests**

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/deep-research
uv run pytest -q tests/test_azure_persistence_scripts.py \
  -k "secret_immutable or existing_secret_reference or update_only or build_rollback or build_version"
```

Expected: FAIL because desired/merged YAML currently includes
`properties.configuration.secrets` and registries, and failed builds retain
incremented version/build marker state.

- [ ] **Step 3: Implement backend read-only preflight and narrow update**

Before update, validate existing Container App secret metadata for the nine
required names against their exact unversioned Key Vault URLs and existing UAI.
Validate existing Docker Hub registry metadata. Change renderer/merger so the
final JSON Merge Patch contains only required existing `location` plus
deployment-owned mutable template fields:

```json
{
  "location": "<existing app location>",
  "properties": {
    "template": {
      "revisionSuffix": "...",
      "containers": [],
      "volumes": [],
      "scale": {}
    }
  }
}
```

Do not submit `properties.configuration`, `identity`, or secret values. Preserve
current state by validating prerequisites rather than rewriting them. Replace
`az containerapp update --yaml` with Azure's documented JSON Merge Patch:

```bash
az rest --method patch \
  --uri "${APP_RESOURCE_ID}?api-version=2025-07-01" \
  --headers Content-Type=application/merge-patch+json \
  --body "@$UPDATE_PATCH_JSON" \
  --output none
```

The exact named-revision readiness loop remains the completion gate. Fake-Azure
tests assert the REST path never asks Azure CLI for secret values.

Harden backend `build.sh` with a dedicated same-directory temporary backup of
`webapp/config.py` and prior `.build_version` bytes/mode. Install an EXIT trap
before version mutation. Until image push succeeds, any nonzero exit restores
only those two build-owned paths byte-for-byte and returns the original status;
it must first verify the live config still equals the script's expected
one-step increment so a concurrent edit is never overwritten. Generate the new
build marker in memory and publish `.build_version` atomically only after push
succeeds. On success, disarm rollback while retaining the one-step config bump.

- [ ] **Step 4: Write failing deterministic snapshot-helper tests**

Test `snapshot_azure_passkey_metadata.py capture` with fake `az`: exact
read-only argv, strict JSON/TSV shape rejection, deterministic sorting, no
secret-value query, mode-0600 same-directory atomic output. Test `compare`
fails on any identity/RBAC/access-policy/Key Vault secret version/app-secret or
registry difference while ignoring only revision/image fields.

- [ ] **Step 5: Implement snapshot helper**

CLI:

```bash
uv run python scripts/snapshot_azure_passkey_metadata.py capture \
  --subscription "$AZURE_SUBSCRIPTION_ID" \
  --resource-group "$RESOURCE_GROUP" \
  --vault-name "$KV_NAME" \
  --backend-app "$BACKEND_APP_NAME" \
  --ui-app "$UI_APP_NAME" \
  --output "$SNAPSHOT_DIR/before.json"

uv run python scripts/snapshot_azure_passkey_metadata.py compare \
  --before "$SNAPSHOT_DIR/before.json" \
  --after "$SNAPSHOT_DIR/after.json"
```

Capture app identities, both principal-scoped RBAC assignments, vault RBAC
mode/access policies, versioned IDs for nine fixed Key Vault secret names, app
secret metadata, registries, revision, and image. Use subprocess argument
arrays; validate every result; normalize with sorted keys and sorted unordered
lists; atomically write canonical JSON with mode 0600. Diagnostics name only
metadata fields, never values.

- [ ] **Step 6: Run backend deployment GREEN tests**

```bash
uv run pytest -q tests/test_azure_persistence_scripts.py
bash -n deploy.sh
uv run ruff check scripts/render_azure_containerapp_config.py \
  scripts/merge_azure_containerapp_config.py \
  scripts/snapshot_azure_passkey_metadata.py \
  tests/test_azure_persistence_scripts.py
uv run ruff format --check scripts/render_azure_containerapp_config.py \
  scripts/merge_azure_containerapp_config.py \
  scripts/snapshot_azure_passkey_metadata.py \
  tests/test_azure_persistence_scripts.py
git diff --check
```

- [ ] **Step 7: Commit backend deployment hardening**

```bash
git add build.sh deploy.sh scripts/render_azure_containerapp_config.py \
  scripts/merge_azure_containerapp_config.py \
  scripts/snapshot_azure_passkey_metadata.py \
  tests/test_azure_persistence_scripts.py
git commit -m "fix: keep backend secrets immutable during deploy"
```

- [ ] **Step 8: Write failing UI deployment tests**

Change the fake-Azure success fixture to provide exact existing metadata for
`upload-api-key`, `passkey-proxy-secret`, and `docker-hub-pat`. Assert the first
two use exact unversioned Key Vault URLs and selected identity, just like the
existing Docker PAT validation. Assert deployment never invokes
`az containerapp secret set` and fails before update on missing/mismatched
metadata.

- [ ] **Step 9: Run UI deployment RED tests**

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/bmo-deepagent-ui
node --test tests/deploy-azure-container-app.test.mjs \
  tests/deployment-security.test.mjs
```

Expected: FAIL because current script invokes `containerapp secret set` and
validates only `docker-hub-pat` app-secret metadata.

- [ ] **Step 10: Implement UI read-only secret preflight**

Extend existing `containerapp secret list` loop to validate all three exact
secret references and identities, then remove `UPLOAD_SECRET_URI`,
`PASSKEY_SECRET_URI`, and the complete `az containerapp secret set` block.
Leave `az containerapp update` limited to image, named revision suffix, and env
references to already-existing secret names.

- [ ] **Step 11: Run UI deployment GREEN tests**

```bash
node --test tests/deploy-azure-container-app.test.mjs \
  tests/deployment-security.test.mjs
bash -n deploy-azure-container-app.sh
yarn lint
yarn prettier --check deploy-azure-container-app.sh \
  tests/deploy-azure-container-app.test.mjs \
  tests/deployment-security.test.mjs
git diff --check
```

- [ ] **Step 12: Commit UI deployment hardening**

```bash
git add deploy-azure-container-app.sh \
  tests/deploy-azure-container-app.test.mjs \
  tests/deployment-security.test.mjs
git commit -m "fix: keep UI secrets immutable during deploy"
```

## Task 6: Integrated verification and review

- [ ] **Step 1: Verify clean repository scopes**

Run `git status --short` in both repositories. Expected: no uncommitted tracked or untracked implementation files except documented ignored rollout artifacts.

- [ ] **Step 2: Run complete affected backend verification**

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/deep-research
uv run pytest -q tests/test_passkeys.py tests/test_auth_store.py tests/test_auth_store_postgres.py
uv run pytest -q tests/test_azure_persistence_scripts.py
uv run ruff check webapp/passkeys.py tests/test_passkeys.py \
  scripts/render_azure_containerapp_config.py \
  scripts/merge_azure_containerapp_config.py \
  scripts/snapshot_azure_passkey_metadata.py
uv run ruff format --check webapp/passkeys.py tests/test_passkeys.py \
  scripts/render_azure_containerapp_config.py \
  scripts/merge_azure_containerapp_config.py \
  scripts/snapshot_azure_passkey_metadata.py
bash -n build.sh deploy.sh scripts/resolve_azure_endpoints.sh
git diff --check HEAD~2..HEAD
```

- [ ] **Step 3: Run complete affected UI verification**

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/bmo-deepagent-ui
yarn test:passkeys
yarn test:remembered-login
yarn lint
yarn build
bash -n build.sh deploy-azure-container-app.sh scripts/resolve-azure-endpoints.sh
git diff --check HEAD~4..HEAD
```

- [ ] **Step 4: Review security invariants**

Confirm diffs do not expose session tokens, proxy secrets, Key Vault values,
credential IDs, or account identity in local storage/logs. Confirm both deploy
scripts contain no secret-set, Key Vault write, role/access-policy write, or
identity-assignment commands and their update payloads omit secret
configuration.

## Task 7: Backend build and update-only deployment

- [ ] **Step 1: Resolve endpoints and check OAuth notice**

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/deep-research
./scripts/resolve_azure_endpoints.sh
```

Expected: canonical backend/UI URLs match existing environment and no changed OAuth endpoint gate is introduced.

- [ ] **Step 2: Snapshot Azure security metadata before mutation**

Run from backend repository:

```bash
SNAPSHOT_DIR=$(mktemp -d /tmp/bmo-passkey-snapshot.XXXXXX)
chmod 700 "$SNAPSHOT_DIR"
uv run python scripts/snapshot_azure_passkey_metadata.py capture \
  --subscription 31fcb880-f153-4bac-b91c-c694854c65ce \
  --resource-group resource-group-deep-agents-0312 \
  --vault-name kv-deep-agents-0312-bmo2 \
  --backend-app deep-research-agent-0312 \
  --ui-app bmo-deepagent-ui-0312 \
  --output "$SNAPSHOT_DIR/before.json"
test -s "$SNAPSHOT_DIR/before.json"
stat -f '%Lp' "$SNAPSHOT_DIR/before.json" | grep '^600$'
printf 'SNAPSHOT_DIR=%s\n' "$SNAPSHOT_DIR"
```

Retain the printed, validated `SNAPSHOT_DIR` path for Task 8 Step 6. Abort
before build/deploy if capture, shape validation, atomic write, or mode check
fails. Helper captures metadata only, never secret values.

- [ ] **Step 3: Build and push backend once**

```bash
./build.sh
```

Expected: image build/push succeeds, `webapp/config.py` advances exactly once,
and `.build_version` atomically records the new image marker only after push.
If the command fails, assert `webapp/config.py` and `.build_version` exactly
match their pre-run state and stop. A retry is then safe and still targets
version `1.8.127`; never manually edit or reset either file.

- [ ] **Step 4: Commit the build-owned version bump**

`build.sh` increments `webapp/config.py` from `1.8.126` to `1.8.127`. Verify the
only new tracked backend diff is that exact one-step version change, then:

```bash
git add webapp/config.py
git commit -m "chore: bump API version to 1.8.127"
```

If build fails, rollback is automatic and verified by `build.sh`; do not deploy
and do not commit a version not present in a successfully pushed image.

- [ ] **Step 5: Deploy existing backend app**

```bash
./deploy.sh
```

Expected: resolved endpoints are unchanged, so no acknowledgement variable is
needed; all read-only prerequisites pass; only existing Container App
template/revision is updated; health reports version `1.8.127`. If resolver
reports `CHANGED=true`, stop, update and verify Google/GitHub settings, then
rerun this one deployment with `OAUTH_REDIRECTS_CONFIRMED=true`.

- [ ] **Step 6: Backend smoke checks and UI rollout gate**

Verify direct backend `/health` returns HTTP 200/version `1.8.127`; direct
backend `GET /auth/passkeys` with valid proxy headers but no bearer session
returns `401 {"code":"invalid_session"}`; unauthenticated UI BFF
`GET /api/auth/passkeys` returns
`401 {"code":"authentication_required"}`; and UI BFF authentication options
remain HTTP 200. Do not retrieve or print secret values. Abort the UI build and
deployment if any backend smoke check fails.

Perform the direct protected-route probe inside the existing UI container with
shell tracing disabled, using its already-resolved `PASSKEY_PROXY_SECRET`
environment variable only as an outbound header. Emit only status/body, never
the command environment or header value.

## Task 8: UI build and deployment

- [ ] **Step 1: Build and push UI once with Docker**

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/bmo-deepagent-ui
CONTAINER_CLI=docker ./build.sh
```

Expected: Docker Hub push succeeds and `.deployment-build.json` records
`schemaVersion`, `deploymentMarker`, `image`, canonical `backendUrl`, and
`assistantId`. UI URL remains resolver output, not a manifest field.

- [ ] **Step 2: Deploy manifest without rebuilding**

```bash
./deploy-azure-container-app.sh
```

Expected: resolved endpoints are unchanged, so no acknowledgement variable is
needed; existing UAI/system identity, Key Vault reference, and endpoint topology
validate read-only; only existing UI Container App template/revision changes.
If resolver reports `CHANGED=true`, stop, update and verify Google/GitHub
settings, then rerun this one deployment with
`OAUTH_REDIRECTS_CONFIRMED=true`.

- [ ] **Step 3: Signed-out browser smoke check**

Clear only this site's new marker (or use a clean browser profile) and verify Google/GitHub remain visible while **Sign in with a passkey** is hidden. Do not clear unrelated browser data.

- [ ] **Step 4: Signed-in management smoke check**

Sign in with the user's chosen OAuth provider, open `/chat?manage=passkeys`, and verify an empty list loads without generic error. If recent auth is required for enrollment, use the explicit provider verification action and confirm return to the manager.

- [ ] **Step 5: Enrollment and login smoke check**

Enroll one passkey with user confirmation at the WebAuthn prompt. Sign out and verify passkey login now appears and authenticates. Google/GitHub must remain visible throughout.

- [ ] **Step 6: Final Azure safety check**

Repeat the exact pre-deployment metadata queries into the same temporary
snapshot directory. Compare identity, RBAC/access-policy, Key Vault secret
version IDs, Container App secret metadata, and registry metadata byte-for-byte;
all must be unchanged. Separately verify latest revision, image, and deployment
marker changed to the expected build artifacts. Remove the temporary snapshot
directory only after comparison succeeds. Confirm no permission, identity,
access-policy, Key Vault secret version, or Container App secret-reference
mutation occurred.

Using exact `SNAPSHOT_DIR` printed by Task 7 Step 2:

```bash
cd /Users/jerryshao/Documents/projects/IBM/ai/deep-research
uv run python scripts/snapshot_azure_passkey_metadata.py capture \
  --subscription 31fcb880-f153-4bac-b91c-c694854c65ce \
  --resource-group resource-group-deep-agents-0312 \
  --vault-name kv-deep-agents-0312-bmo2 \
  --backend-app deep-research-agent-0312 \
  --ui-app bmo-deepagent-ui-0312 \
  --output "$SNAPSHOT_DIR/after.json"
uv run python scripts/snapshot_azure_passkey_metadata.py compare \
  --before "$SNAPSHOT_DIR/before.json" \
  --after "$SNAPSHOT_DIR/after.json"
```

Expected: compare exits zero and reports unchanged security metadata. Inspect
the normalized `revision` and `image` fields separately against `.build_version`
and `.deployment-build.json`. Cleanup is recoverable and explicit only after
success; keep snapshot directory on mismatch for diagnosis.
