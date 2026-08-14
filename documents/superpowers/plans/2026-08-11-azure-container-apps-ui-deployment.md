# Azure Container Apps UI Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested one-command UI image build, ACR push, and deployment flow for an existing Azure Container App while making every Azure-facing script select the subscription declared in `../../../env.sh`.

**Architecture:** A side-effect-free Azure subscription helper gives all Azure scripts one fail-fast account-selection contract. A separate `../../../deploy-azure-container-app.sh` reuses the container-runtime adapter, validates existing Azure resources, builds and pushes `latest`, configures a Key Vault-backed secret, creates a uniquely suffixed single-mode revision, and verifies the exact deployed marker without changing infrastructure policy.

**Tech Stack:** Bash 3.2, Azure CLI, Azure Container Apps, Azure Container Registry, Azure Key Vault, Apple Container, Podman, Docker, Node.js built-in test runner, Yarn, Prettier

---

## Implementation constraints

- Read and follow `@superpowers:test-driven-development` before implementation.
- Use `@superpowers:verification-before-completion` before claiming completion.
- Treat the current uncommitted `../../../env.sh` edit as user-owned and in scope. Preserve its
  exact `AZURE_SUBSCRIPTION_ID`; never reset, replace, or stage unrelated changes.
- Do not run real `az`, registry, Key Vault, or deployment mutations in tests.
- Maintain Bash 3.2 compatibility: no associative arrays, `mapfile`, `${var,,}`, or
  Bash 4-only features.
- Never print ACR access tokens, Key Vault values, `../../../.env` contents, or credentials.
- Private `../../../secrets.sh` is ignored and untracked. Never inspect, copy, stage, or
  force-add it; update tracked `secrets.sh.example` and let operators regenerate their
  own local copy.
- Do not create Azure resources or change identity, RBAC, ingress, scaling, revision
  mode, traffic, networking, or volumes.

## File structure

- Create `../../../scripts/azure-subscription.sh`: reusable Azure login/subscription guard;
  no action when sourced.
- Modify `../../../env.sh`: add overridable `CONTAINER_APP_NAME` while preserving the user's
  subscription value and all other current content.
- Modify `../../../build.sh`: select Azure subscription before resource-group access and call
  shared container build-readiness policy.
- Modify `../../../deploy.sh`: select Azure subscription before App Service/backend access.
- Do not inspect or modify private `../../../secrets.sh`; it is ignored and untracked. Modify
  tracked `secrets.sh.example`, and have operators regenerate their local copy.
- Modify `../../../scripts/container-runtime.sh`: own Apple builder capacity policy used by
  local Azure image builds.
- Create `../../../deploy-azure-container-app.sh`: existing-resource preflight, image build,
  ACR login/push, Key Vault reference, Container App update, and exact verification.
- Create `../../../tests/azure-subscription.test.mjs`: helper behavior and call-order contract.
- Modify `../../../tests/container-runtime.test.mjs`: shared build-readiness behavior.
- Create `../../../tests/deploy-azure-container-app.test.mjs`: black-box deployment contract
  with fake executables.
- Modify `../../../tests/deployment-security.test.mjs`: static security and non-mutation
  boundaries.
- Create `../../deployment/azure-container-apps.md`: active operator guide.
- Modify `../../deployment/azure-app-service.md`: explicit subscription selection.
- Modify `../../../README.md` and `../../README.md`: link the new deployment path.

### Task 1: Add shared Azure subscription selection

**Files:**

- Create: `../../../scripts/azure-subscription.sh`
- Create: `../../../tests/azure-subscription.test.mjs`
- Modify: `../../../env.sh`
- Modify: `../../../build.sh`
- Modify: `../../../deploy.sh`
- Modify: `secrets.sh.example`

- [ ] **Step 1: Write helper RED tests**

Create `../../../tests/azure-subscription.test.mjs` with a temporary fake `az` executable and
these cases:

```javascript
test("missing Azure subscription fails before account access", async () => {
  const { result, log } = await runSubscriptionGuard({
    subscriptionId: undefined,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AZURE_SUBSCRIPTION_ID.*required/i);
  assert.equal(log, "");
});

test("unauthenticated Azure CLI fails clearly", async () => {
  const { result, log } = await runSubscriptionGuard({ accountShowStatus: 7 });
  assert.equal(result.status, 7);
  assert.match(result.stderr, /az login/i);
  assert.equal(log, "account show --query id -o tsv\n");
});

test("account selection failure propagates", async () => {
  const { result } = await runSubscriptionGuard({ accountSetStatus: 23 });
  assert.equal(result.status, 23);
});

test("active subscription mismatch fails", async () => {
  const { result } = await runSubscriptionGuard({
    activeId: "wrong-subscription",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active subscription.*does not match/i);
});

test("selects and confirms exact subscription", async () => {
  const subscriptionId = "11111111-2222-3333-4444-555555555555";
  const { result, log } = await runSubscriptionGuard({ subscriptionId });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    `account show --query id -o tsv\naccount set --subscription ${subscriptionId}\naccount show --query id -o tsv\n`
  );
});
```

The harness must provide only fake `az` on `PATH`, log argument boundaries, and return
configured statuses/IDs without network access.

- [ ] **Step 2: Run helper tests and confirm RED**

Run:

```bash
node --test tests/azure-subscription.test.mjs
```

Expected: FAIL because `../../../scripts/azure-subscription.sh` does not exist.

- [ ] **Step 3: Implement minimal subscription helper**

Create `../../../scripts/azure-subscription.sh`:

```bash
#!/bin/bash

select_azure_subscription() {
  if [ -z "${AZURE_SUBSCRIPTION_ID:-}" ]; then
    echo "Error: AZURE_SUBSCRIPTION_ID is required." >&2
    return 1
  fi

  local current_subscription
  if current_subscription=$(az account show --query id -o tsv); then
    :
  else
    local status=$?
    echo "Error: Azure CLI is not authenticated; run 'az login'." >&2
    return "$status"
  fi

  if az account set --subscription "$AZURE_SUBSCRIPTION_ID"; then
    :
  else
    local status=$?
    echo "Error: could not select Azure subscription '$AZURE_SUBSCRIPTION_ID'." >&2
    return "$status"
  fi

  if current_subscription=$(az account show --query id -o tsv); then
    :
  else
    local status=$?
    echo "Error: could not confirm active Azure subscription." >&2
    return "$status"
  fi

  if [ "$current_subscription" != "$AZURE_SUBSCRIPTION_ID" ]; then
    echo "Error: active subscription '$current_subscription' does not match requested '$AZURE_SUBSCRIPTION_ID'." >&2
    return 1
  fi
}
```

Implementation note: keep status capture in each `else` branch. Do not rewrite these
as `if ! command; then status=$?`, because `$?` would be the negated status.

- [ ] **Step 4: Run helper tests and confirm GREEN**

Run:

```bash
bash -n scripts/azure-subscription.sh
node --test tests/azure-subscription.test.mjs
```

Expected: all subscription helper tests PASS.

- [ ] **Step 5: Add script call-order RED tests**

Append a table-driven test that reads every Azure-facing script and asserts this
order:

```javascript
const scriptContracts = [
  ["build.sh", "az group show"],
  ["deploy.sh", "az webapp show"],
  ["secrets.sh.example", "az keyvault secret set"],
];

for (const [script, firstResourceCall] of scriptContracts) {
  test(`${script} selects configured subscription before Azure resources`, async () => {
    const contents = await readFile(path.join(repoRoot, script), "utf8");
    const sourceHelper = contents.indexOf("scripts/azure-subscription.sh");
    const select = contents.indexOf("select_azure_subscription");
    const resource = contents.indexOf(firstResourceCall);
    assert.ok(sourceHelper >= 0 && sourceHelper < select);
    assert.ok(select >= 0 && select < resource);
  });
}
```

Also assert `../../../env.sh` contains an overridable default:

```javascript
assert.match(
  envSource,
  /export CONTAINER_APP_NAME="\$\{CONTAINER_APP_NAME:-bmo-deepagent-ui-\$SEED\}"/
);
```

- [ ] **Step 6: Run call-order tests and confirm RED**

Run:

```bash
node --test tests/azure-subscription.test.mjs
```

Expected: call-order/default tests FAIL while helper unit tests remain green.

- [ ] **Step 7: Integrate helper without overwriting user configuration**

Add only this setting to `../../../env.sh` after `ENV_NAME`:

```bash
export CONTAINER_APP_NAME="${CONTAINER_APP_NAME:-bmo-deepagent-ui-$SEED}"
```

In `../../../build.sh`, `../../../deploy.sh`, and tracked `secrets.sh.example`, source the helper after
`../../../env.sh`, verify `az` exists where the script does not already do so, and call:

```bash
select_azure_subscription
echo "Azure subscription: $AZURE_SUBSCRIPTION_ID"
```

Place selection before the first resource query/mutation. Do not add literal
subscription UUIDs to any script.

- [ ] **Step 8: Verify integration and commit**

Run:

```bash
bash -n scripts/azure-subscription.sh build.sh deploy.sh secrets.sh.example
node --test tests/azure-subscription.test.mjs
git diff --check
```

Expected: syntax and tests PASS; only the existing `../../../env.sh` subscription value plus
new overridable app name appear in the intended diff.

Commit:

```bash
git add scripts/azure-subscription.sh tests/azure-subscription.test.mjs env.sh build.sh deploy.sh secrets.sh.example
git commit -m "feat: select configured Azure subscription"
```

### Task 2: Share container build-readiness policy

**Files:**

- Modify: `../../../scripts/container-runtime.sh`
- Modify: `../../../tests/container-runtime.test.mjs`
- Modify: `../../../build.sh`
- Modify: `../../../tests/deployment-security.test.mjs`

- [ ] **Step 1: Write RED behavioral tests for build readiness**

Extend the fake runtime harness to log Apple builder commands, return configured
builder JSON, and provide a `node` shim to `process.execPath`. Add tests:

```javascript
test("Apple build readiness creates an 8 GiB builder when missing", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderStatus: 1,
    body: "select_container_cli && ensure_container_cli_build_ready",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /container builder start --memory 8G/);
});

test("Apple build readiness replaces an undersized running builder", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderJson: JSON.stringify([
      {
        configuration: { resources: { memoryInBytes: 2147483648 } },
        status: { state: "running" },
      },
    ]),
    body: "select_container_cli && ensure_container_cli_build_ready",
  });
  assert.match(
    log,
    /builder stop[\s\S]*builder delete[\s\S]*builder start --memory 8G/
  );
});

for (const runtime of ["podman", "docker"]) {
  test(`${runtime} build readiness never invokes Apple builder`, async () => {
    const { result, log } = await runHelper({
      runtimes: [runtime],
      body: "select_container_cli && ensure_container_cli_build_ready",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(log, /container builder/);
  });
}
```

Preserve current `../../../build.sh` semantics: any nonzero `container builder status` means no
usable builder was found, so readiness attempts `container builder start --memory 8G`.
Do not require the status command's nonzero code to propagate. Cover exact failure
propagation for builder stop, delete, and start commands.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
node --test --test-name-pattern='build readiness' tests/container-runtime.test.mjs
```

Expected: FAIL because `ensure_container_cli_build_ready` is undefined.

- [ ] **Step 3: Move Apple capacity policy into helper**

Add `ensure_container_cli_build_ready` to `../../../scripts/container-runtime.sh`. It must:

1. call `ensure_container_cli_ready` and propagate status;
2. immediately return for Podman/Docker;
3. query Apple builder JSON;
4. use Node to read memory/state as current `../../../build.sh` does;
5. stop/delete an undersized existing builder; and
6. start missing/undersized builder with `--memory 8G`, or start a sufficient stopped
   builder without changing its memory.

Replace the inline Apple builder block in `../../../build.sh` with:

```bash
ensure_container_cli_build_ready
```

Update static deployment tests to locate memory policy in the helper, not `../../../build.sh`.

- [ ] **Step 4: Run tests and confirm GREEN**

Run:

```bash
bash -n scripts/container-runtime.sh build.sh
node --test tests/container-runtime.test.mjs
node --test tests/deployment-security.test.mjs
```

Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/container-runtime.sh tests/container-runtime.test.mjs build.sh tests/deployment-security.test.mjs
git commit -m "refactor: share container build readiness"
```

### Task 3: Define existing Container App preflight

**Files:**

- Create: `../../../deploy-azure-container-app.sh`
- Create: `../../../tests/deploy-azure-container-app.test.mjs`

- [ ] **Step 1: Build black-box fake-command harness**

Create a temporary repository fixture containing copies of the deployment script and
both helpers, plus sanitized `../../../env.sh`/`../../../.env.docker`. Fake commands must log each argv
item as `<value>`, accept scenario variables, and never access Azure.

Import `access` and `constants` from `node:fs/promises`/`node:fs`, then add an entry
point contract:

```javascript
test("Azure Container Apps deployment entry point is executable", async () => {
  await access(scriptPath, constants.X_OK);
});
```

Default fake `az` responses:

```text
account show -> requested subscription
account set -> success
group show -> existing group
acr show -> testregistry.azurecr.io
containerapp show (UI) -> external, targetPort 3000, Single, SystemAssigned,
                          one container named deepagent-ui, public UI FQDN
containerapp registry list -> testregistry.azurecr.io using system
containerapp show (backend) -> external and public backend FQDN
keyvault show -> https://testvault.vault.azure.net/
keyvault secret show -> unversioned/available secret ID
```

Provide fakes for `docker`, `rsync`, `cp`, `node`, `curl`, `sleep`, and `date`; use
real safe shell built-ins/filesystem tools where possible.

- [ ] **Step 2: Write table-driven preflight RED tests**

Add cases for missing/invalid:

```javascript
const preflightFailures = [
  ["resource-group-missing", /resource group/i],
  ["acr-missing", /container registry/i],
  ["ui-app-missing", /UI Container App/i],
  ["ui-internal-ingress", /external ingress/i],
  ["ui-missing-fqdn", /public FQDN/i],
  ["wrong-target-port", /target port.*3000/i],
  ["multiple-revision-mode", /single-revision/i],
  ["missing-system-identity", /system-assigned identity/i],
  ["zero-containers", /exactly one.*container/i],
  ["multiple-containers", /exactly one.*container/i],
  ["wrong-acr-registry", /ACR pull configuration/i],
  ["wrong-acr-identity", /system identity/i],
  ["backend-missing", /backend Container App/i],
  ["backend-internal-ingress", /backend.*external ingress/i],
  ["backend-missing-fqdn", /backend.*public FQDN/i],
  ["vault-secret-missing", /UPLOAD-API-KEY/i],
];
```

For each case, assert nonzero status and no `build`, `login`, `push`,
`containerapp secret set`, or `containerapp update` log entry.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
node --test --test-name-pattern='preflight' tests/deploy-azure-container-app.test.mjs
```

Expected: FAIL because the deployment script does not exist.

- [ ] **Step 4: Implement script configuration and preflight**

Create `../../../deploy-azure-container-app.sh` with `set -eo pipefail`, resolve its own
directory, source `../../../env.sh`, `../../../scripts/azure-subscription.sh`, and
`../../../scripts/container-runtime.sh`, then load optional `../../../.env.docker` using the existing
line-oriented parser from `../../../deploy.sh`.

After creating the file, make the operator entry point executable:

```bash
chmod 755 deploy-azure-container-app.sh
```

After loading, capture:

```bash
ASSISTANT_ID="${NEXT_PUBLIC_ASSISTANT_ID:-research}"
CONTAINER_APP_NAME="${CONTAINER_APP_NAME:-bmo-deepagent-ui-$SEED}"
```

Require `az`, `curl`, `rsync`, `node`, and the selected runtime. Select subscription
before `az group show`. Implement focused functions:

```bash
fail() {
  echo "Error: $*" >&2
  exit 1
}

require_nonempty() {
  local name="$1"
  eval "local value=\${$name:-}"
  [ -n "$value" ] || fail "$name is required."
}
```

Avoid `eval` if a Bash 3.2-safe indirect-expansion alternative already used in the
repo can express this safely. Validate all resource fields with explicit Azure CLI
queries. Require exactly one container and save its name in `TARGET_CONTAINER_NAME`.
Discover `ACR_LOGIN_SERVER`, `UI_FQDN`, `BACKEND_FQDN`, and `VAULT_URI`; set canonical:

```bash
UI_URL="https://$UI_FQDN"
BACKEND_URL="https://$BACKEND_FQDN"
NEXT_PUBLIC_LANGGRAPH_URL="$BACKEND_URL"
```

Do not enumerate role assignments and do not mutate anything during preflight.

- [ ] **Step 5: Run preflight tests and confirm GREEN**

Run:

```bash
bash -n deploy-azure-container-app.sh
node --test --test-name-pattern='entry point|preflight' tests/deploy-azure-container-app.test.mjs
```

Expected: all preflight cases PASS.

Also confirm the executable-mode test passes and `git diff --summary` reports mode
`100755` for the new script.

- [ ] **Step 6: Commit**

```bash
git add deploy-azure-container-app.sh tests/deploy-azure-container-app.test.mjs
git commit -m "feat: validate Azure Container App deployment"
```

### Task 4: Build and push `latest` to ACR

**Files:**

- Modify: `../../../deploy-azure-container-app.sh`
- Modify: `../../../tests/deploy-azure-container-app.test.mjs`

- [ ] **Step 1: Write build/push RED tests**

Add success assertions for:

```javascript
assert.match(log, /docker <build> <--platform> <linux\/amd64>/);
assert.match(
  log,
  /<--build-arg> <NEXT_PUBLIC_LANGGRAPH_URL=https:\/\/backend\.example\.test>/
);
assert.match(log, /<--build-arg> <NEXT_PUBLIC_ASSISTANT_ID=from-docker-env>/);
assert.match(log, /<-t> <testregistry\.azurecr\.io\/deepagent-ui:latest>/);
assert.match(
  log,
  /acr <login> <--name> <testregistry> <--expose-token> <--query> <accessToken> <-o> <tsv>/
);
assert.match(
  log,
  /docker <login> <--username> <00000000-0000-0000-0000-000000000000> <--password-stdin> <testregistry\.azurecr\.io>/
);
assert.match(
  log,
  /docker <push> <testregistry\.azurecr\.io\/deepagent-ui:latest>/
);
assert.equal(stdinLog, "fake-acr-token");
assert.doesNotMatch(result.stdout + result.stderr, /fake-acr-token/);
```

Inspect the staged context during fake build and assert `../../../.env`, `../../../.env.docker`, `.git`,
`.next`, and `node_modules` are absent; `../../../Dockerfile` and
`public/deployment-version.txt` are present.

Add table-driven build, ACR token, login, and push failures. Each exact nonzero status
must propagate; no secret/update command may run.

- [ ] **Step 2: Run build/push tests and confirm RED**

```bash
node --test --test-name-pattern='build|ACR|push|token' tests/deploy-azure-container-app.test.mjs
```

Expected: new tests FAIL because build/push is not implemented.

- [ ] **Step 3: Implement clean build and token login**

After successful preflight:

```bash
select_container_cli
ensure_container_cli_build_ready

IMAGE_NAME="$ACR_LOGIN_SERVER/deepagent-ui:latest"
DEPLOYMENT_MARKER="$(date -u +%Y%m%dT%H%M%SZ)-$$"
BUILD_CONTEXT_DIR=$(mktemp -d ".container-build-context.XXXXXX")
trap 'rm -rf "$BUILD_CONTEXT_DIR"' EXIT

rsync -a --exclude-from=".dockerignore" ./ "$BUILD_CONTEXT_DIR/"
cp Dockerfile "$BUILD_CONTEXT_DIR/Dockerfile"
mkdir -p "$BUILD_CONTEXT_DIR/public"
printf '%s\n' "$DEPLOYMENT_MARKER" > "$BUILD_CONTEXT_DIR/public/deployment-version.txt"

container_cli_build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_LANGGRAPH_URL="$BACKEND_URL" \
  --build-arg NEXT_PUBLIC_ASSISTANT_ID="$ASSISTANT_ID" \
  -t "$IMAGE_NAME" \
  "$BUILD_CONTEXT_DIR"

ACR_ACCESS_TOKEN=$(az acr login \
  --name "$ACR_NAME" \
  --expose-token \
  --query accessToken \
  -o tsv)
[ -n "$ACR_ACCESS_TOKEN" ] || fail "Azure returned an empty ACR access token."
printf '%s' "$ACR_ACCESS_TOKEN" | container_cli_login \
  --username 00000000-0000-0000-0000-000000000000 \
  --password-stdin \
  "$ACR_LOGIN_SERVER"
unset ACR_ACCESS_TOKEN
container_cli_push "$IMAGE_NAME"
```

Wrap each operation only when adding an operation-specific error improves diagnostics;
preserve exact status in every wrapper.

- [ ] **Step 4: Run build/push tests and confirm GREEN**

```bash
bash -n deploy-azure-container-app.sh
node --test --test-name-pattern='build|ACR|push|token' tests/deploy-azure-container-app.test.mjs
```

Expected: all build/push tests PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy-azure-container-app.sh tests/deploy-azure-container-app.test.mjs
git commit -m "feat: push UI image to Azure registry"
```

### Task 5: Configure secret and create a new revision

**Files:**

- Modify: `../../../deploy-azure-container-app.sh`
- Modify: `../../../tests/deploy-azure-container-app.test.mjs`
- Modify: `../../../tests/deployment-security.test.mjs`

- [ ] **Step 1: Write secret/update RED tests**

Assert successful command arguments include:

```text
containerapp secret set
  --name <CONTAINER_APP_NAME>
  --resource-group <RESOURCE_GROUP>
  --secrets upload-api-key=keyvaultref:<VAULT_URI>secrets/UPLOAD-API-KEY,identityref:system

containerapp update
  --name <CONTAINER_APP_NAME>
  --resource-group <RESOURCE_GROUP>
  --container-name <discovered sole container>
  --image <ACR_LOGIN_SERVER>/deepagent-ui:latest
  --revision-suffix ui-<UTC timestamp>-<PID>
  --set-env-vars <required settings>
```

Verify build and runtime use the same discovered backend URL and assistant ID. Assert
the update upserts exact values from the spec, including
`UPLOAD_API_KEY=secretref:upload-api-key`.

Add static security assertions that the script does not contain:

```javascript
for (const forbidden of [
  /az group create/,
  /az acr create/,
  /az containerapp create/,
  /identity assign/,
  /role assignment create/,
  /ingress (?:enable|update|traffic)/,
  /revision set-mode/,
  /--min-replicas|--max-replicas/,
]) {
  assert.doesNotMatch(script, forbidden);
}
```

Add secret-set and app-update failure tests that preserve exact status and never begin
readiness polling.

- [ ] **Step 2: Run tests and confirm RED**

```bash
node --test --test-name-pattern='secret|revision|update|does not mutate' tests/deploy-azure-container-app.test.mjs tests/deployment-security.test.mjs
```

Expected: new tests FAIL.

- [ ] **Step 3: Implement Key Vault reference and update**

Construct unversioned secret URI without printing it as a value-bearing secret:

```bash
KEY_VAULT_SECRET_URI="${VAULT_URI%/}/secrets/UPLOAD-API-KEY"
az containerapp secret set \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets "upload-api-key=keyvaultref:$KEY_VAULT_SECRET_URI,identityref:system" \
  -o none

REVISION_SUFFIX="ui-$(date -u +%Y%m%dt%H%M%S)-$$"
az containerapp update \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --container-name "$TARGET_CONTAINER_NAME" \
  --image "$IMAGE_NAME" \
  --revision-suffix "$REVISION_SUFFIX" \
  --set-env-vars \
    "NEXT_TELEMETRY_DISABLED=1" \
    "NEXT_PUBLIC_LANGGRAPH_URL=$BACKEND_URL" \
    "BACKEND_API_URL=$BACKEND_URL" \
    "NEXT_PUBLIC_ASSISTANT_ID=$ASSISTANT_ID" \
    "AUTH_URL=$UI_URL" \
    "NEXTAUTH_URL=$UI_URL" \
    "AUTH_TRUST_HOST=true" \
    "NODE_ENV=production" \
    "UPLOAD_API_KEY=secretref:upload-api-key" \
  -o none
```

Capture the previously serving revision before update with:

```bash
PREVIOUS_REVISION=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.latestReadyRevisionName \
  -o tsv)
```

Require it to be non-empty. Do not pass ingress, scale, identity, registry, traffic,
networking, or volume flags.

- [ ] **Step 4: Run tests and confirm GREEN**

```bash
bash -n deploy-azure-container-app.sh
node --test --test-name-pattern='secret|revision|update|does not mutate' tests/deploy-azure-container-app.test.mjs tests/deployment-security.test.mjs
```

Expected: tests PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy-azure-container-app.sh tests/deploy-azure-container-app.test.mjs tests/deployment-security.test.mjs
git commit -m "feat: update Azure Container App revision"
```

### Task 6: Verify revision state and exact deployed marker

**Files:**

- Modify: `../../../deploy-azure-container-app.sh`
- Modify: `../../../tests/deploy-azure-container-app.test.mjs`

- [ ] **Step 1: Write readiness RED tests**

Add tests for:

- latest revision equals previous revision: fail;
- provisioning state `Provisioning` then `Provisioned`: retry then continue;
- running state `Activating` then `Running`: retry then continue;
- provisioning/running states `ProvisioningFailed`, `Failed`, `Degraded`, or
  `ActivationFailed`: fail immediately with diagnostics;
- exact marker returns non-200 then correct marker: retry then pass;
- HTTP 200 with stale marker: retry and eventually fail;
- timeout: nonzero with app URL, previous/new revision, and final states; and
- `curl` errors do not bypass bounded retries.

Use fake `sleep` so tests run immediately. Make sequences deterministic through files
or counters in the temporary fixture.

- [ ] **Step 2: Run tests and confirm RED**

```bash
node --test --test-name-pattern='readiness|marker|timeout|state' tests/deploy-azure-container-app.test.mjs
```

Expected: new tests FAIL.

- [ ] **Step 3: Implement bounded revision and HTTP polling**

After update, query `properties.latestRevisionName`; require it to be non-empty and
different from `PREVIOUS_REVISION`. Poll `az containerapp revision show` up to 60
times with five-second waits (maximum five minutes), reading provisioning and running
states together.

Treat these normalized values as immediate failures:

```bash
case "$PROVISIONING_STATE|$RUNNING_STATE" in
  *Failed*|*failed*|*Degraded*|*degraded*|*ActivationFailed*|*activationFailed*)
    print_revision_diagnostics
    exit 1
    ;;
esac
```

After state readiness, poll:

```bash
HTTP_STATUS=$(curl -sS -o "$HEALTH_RESPONSE_PATH" -w "%{http_code}" \
  --connect-timeout 10 \
  --max-time 30 \
  "$UI_URL/deployment-version.txt" || true)
DEPLOYED_MARKER=""
[ -f "$HEALTH_RESPONSE_PATH" ] && DEPLOYED_MARKER=$(<"$HEALTH_RESPONSE_PATH")
```

Success requires both HTTP `200` and exact marker equality. Poll at most 36 times with
five-second waits (maximum three minutes). Use a temporary health file under the
existing deployment temp root and clean it through the same trap.

- [ ] **Step 4: Run complete deployment tests and confirm GREEN**

```bash
bash -n deploy-azure-container-app.sh
node --test tests/deploy-azure-container-app.test.mjs
```

Expected: all preflight, build, push, update, readiness, and failure tests PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy-azure-container-app.sh tests/deploy-azure-container-app.test.mjs
git commit -m "feat: verify Azure Container App deployment"
```

### Task 7: Add operator documentation and finish verification

**Files:**

- Create: `../../deployment/azure-container-apps.md`
- Modify: `../../deployment/azure-app-service.md`
- Modify: `../../../README.md`
- Modify: `../../README.md`
- Verify: all implementation/test files from Tasks 1-6

- [ ] **Step 1: Write the Container Apps operator guide**

Document the exact contract from the approved spec:

- separate `../../../deploy-azure-container-app.sh` versus App Service `../../../deploy.sh`;
- existing resource group, ACR, environment, UI/backend apps, Key Vault, identity,
  roles, external ingress, target port 3000, single-revision mode, registry pull, and
  storage prerequisites;
- `AZURE_SUBSCRIPTION_ID` selection and confirmation;
- Apple Container → Podman → Docker priority plus `CONTAINER_CLI` override;
- local `linux/amd64` build, short-lived ACR token, `latest` push, Key Vault reference,
  revision creation, and exact-marker verification;
- no infrastructure, traffic, identity, scaling, networking, or storage mutation;
- mutable `latest` rollback procedure and limitation;
- security, availability, cost, and cleanup ownership; and
- troubleshooting for every preflight/readiness failure class.

Link only current official Microsoft documentation already listed in the design spec.

- [ ] **Step 2: Update navigation and App Service guide**

Add the Container Apps guide beside App Service/AWS/Oracle deployment links in
`../../../README.md` and `../../README.md`. Update App Service prerequisites/deploy flow to
state that `../../../deploy.sh` selects and verifies `AZURE_SUBSCRIPTION_ID` before resource
access.

- [ ] **Step 3: Format docs and run shell/focused tests**

```bash
yarn prettier --write README.md documents/README.md documents/deployment/azure-app-service.md documents/deployment/azure-container-apps.md tests/azure-subscription.test.mjs tests/container-runtime.test.mjs tests/deploy-azure-container-app.test.mjs tests/deployment-security.test.mjs
yarn prettier --check README.md documents/README.md documents/deployment/azure-app-service.md documents/deployment/azure-container-apps.md tests/azure-subscription.test.mjs tests/container-runtime.test.mjs tests/deploy-azure-container-app.test.mjs tests/deployment-security.test.mjs
bash -n scripts/azure-subscription.sh scripts/container-runtime.sh build.sh deploy.sh deploy-azure-container-app.sh secrets.sh.example
node --test tests/azure-subscription.test.mjs
node --test tests/container-runtime.test.mjs
node --test tests/deploy-azure-container-app.test.mjs
node --test tests/deployment-security.test.mjs
```

Expected: formatting, syntax, and all focused suites PASS.

- [ ] **Step 4: Run repository verification**

```bash
yarn lint
yarn build
git diff --check
threadroot score latest --json
```

Expected: lint, production build, and diff check PASS. Record Threadroot's exact score
or `null` message; do not invent a score.

If Turbopack fails only because sandbox blocks local worker port binding, rerun the
same `yarn build` with the required sandbox escalation and record both results.

- [ ] **Step 5: Review final diff and user-owned configuration**

```bash
git status --short
git diff --stat HEAD~6..HEAD
git diff -- env.sh
rg -n 'AZURE_SUBSCRIPTION_ID|az account set|--subscription' --glob '*.sh' .
```

Expected: `../../../env.sh` retains the user's exact subscription ID and adds only the approved
Container App default; no Azure script contains a literal subscription UUID; no
unrelated file is staged or modified.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md documents/README.md documents/deployment/azure-app-service.md documents/deployment/azure-container-apps.md
git commit -m "docs: add Azure Container Apps deployment guide"
```

- [ ] **Step 7: Request final code review**

Invoke `@superpowers:requesting-code-review` against the implementation base. Fix all
Critical/Important findings with focused tests, re-run verification, and re-request
review until ready.
