# Azure Container Apps UI Deployment Design

## Goal

Add a one-command Azure Container Apps deployment path for the UI while keeping the
existing Azure App Service ZIP deployment in `deploy.sh` unchanged as a supported
target.

The new path builds the UI image locally, pushes `latest` to an existing Azure
Container Registry, updates an existing Azure Container App, and verifies that the
new revision is serving the exact build. Existing Azure resources remain
operator-owned.

## Decisions

- Keep App Service deployment in `deploy.sh`.
- Add a separate `deploy-azure-container-app.sh` entry point.
- Require existing resource group, ACR, Container Apps environment, UI Container
  App, backend Container App, Key Vault, identities, role assignments, ingress,
  networking, scaling, and storage configuration.
- Build locally through the shared runtime priority: Apple Container, Podman, then
  Docker. Allow the existing `CONTAINER_CLI` override.
- Push and deploy only `<acr-login-server>/deepagent-ui:latest`.
- Preserve existing Container App ingress, scaling, revision mode, identities,
  registry configuration, networking, and volume mounts.
- Require single-revision mode instead of changing revision or traffic policy.
- Use the existing system-assigned identity for Key Vault-backed
  `UPLOAD_API_KEY`.
- Make every deployment create a uniquely suffixed revision even though the image
  tag remains `latest`.
- Do not implement automatic rollback. With a mutable-only tag, rollback means
  rebuilding a known-good Git revision, pushing `latest`, and deploying again.

## Configuration

`env.sh` remains the shared Azure configuration source. It owns:

- `AZURE_SUBSCRIPTION_ID`
- `RESOURCE_GROUP`
- `LOCATION`
- `ACR_NAME`
- `KV_NAME`
- `SEED`
- `NEXT_PUBLIC_LANGGRAPH_URL`
- `NEXT_PUBLIC_ASSISTANT_ID`
- `CONTAINER_APP_NAME`, defaulting to `bmo-deepagent-ui-$SEED`

The implementation must preserve the operator's current
`AZURE_SUBSCRIPTION_ID` value and other uncommitted `env.sh` edits.

Optional `.env.docker` values may supply runtime settings using the same safe,
line-oriented loading behavior as `deploy.sh`. The script must not print or copy
secret values into logs, source control, or image layers.

Configuration precedence is explicit:

1. source `env.sh`, which sources the operator's `.env` last;
2. load optional `.env.docker`, allowing it to override
   `NEXT_PUBLIC_ASSISTANT_ID`;
3. capture `NEXT_PUBLIC_ASSISTANT_ID`, defaulting to `research`; and
4. discover the backend Container App ingress URL and use that discovered URL as the
   canonical `NEXT_PUBLIC_LANGGRAPH_URL` and `BACKEND_API_URL` for both image build
   arguments and runtime environment variables.

Any `NEXT_PUBLIC_LANGGRAPH_URL` previously loaded from `env.sh` or `.env.docker` is
therefore intentionally replaced for this deployment path. Build-time and runtime
backend/assistant values must be identical because `NEXT_PUBLIC_*` values are baked
into the client bundle.

## Shared Azure Subscription Guard

Add side-effect-free-on-source `scripts/azure-subscription.sh` with a callable
subscription-selection function. The function:

1. requires a non-empty `AZURE_SUBSCRIPTION_ID`;
2. verifies Azure CLI authentication;
3. runs `az account set --subscription "$AZURE_SUBSCRIPTION_ID"`;
4. reads the active account ID back from Azure CLI; and
5. fails clearly unless it exactly matches the requested ID.

The following Azure-facing scripts call the guard after loading `env.sh` and before
their first Azure resource read or mutation:

- `build.sh`
- `deploy.sh`
- `secrets.sh`
- `secrets.sh.example`
- `deploy-azure-container-app.sh`

This removes dependence on whichever subscription happened to be active in the
operator's Azure CLI session. `all.sh` needs no direct change because it delegates to
`deploy.sh`.

## Existing Resource Contract

The Container Apps script validates all required resources before building or
mutating the UI app:

- requested Azure subscription is active;
- resource group exists;
- ACR exists and its login server is discoverable;
- UI Container App named by `CONTAINER_APP_NAME` exists;
- UI Container App uses external ingress and has a public FQDN;
- ingress target port is exactly `3000`, matching the image's server port;
- UI Container App is in single-revision mode;
- UI Container App has a system-assigned identity;
- UI Container App has exactly one application container; its existing name is
  discovered and passed explicitly to `az containerapp update --container-name`;
- UI Container App already has pull configuration for the selected ACR login server
  using its system identity;
- backend Container App `deep-research-agent-$SEED` exists and has ingress;
- Key Vault exists and contains `UPLOAD-API-KEY`; and
- current Azure principal can read the resource metadata and secret ID needed by
  preflight.

The script must not create resources, assign identities, grant roles, change ingress,
change revision mode, change scale rules, change networking, or configure volume
mounts. Missing prerequisites produce actionable errors before image build or cloud
application mutation.

The UI app's system identity must already have `AcrPull` on ACR and Key Vault secret
read access. The operator principal needs resource-read/update access, Key Vault
secret `get` access for the preflight check, ACR token/push access, and permission to
update Container App secrets and revisions.

The script does not attempt to prove effective Azure RBAC or Key Vault policy through
role-assignment enumeration because inherited scopes and vault access models make that
check unreliable. It validates observable structure and operations instead:

- `az keyvault secret show` proves the operator can resolve the secret ID;
- `az acr login --expose-token` plus image push proves operator registry access;
- Container App registry metadata must name the selected ACR and system identity; and
- new revision provisioning/readiness proves the workload identity can resolve its
  image and Key Vault reference.

If the managed identity lacks effective `AcrPull` or secret access, the new revision
fails and single-revision mode keeps traffic on the previous ready revision.

## Container Build and Push

Reuse `scripts/container-runtime.sh` for runtime selection, readiness, build, login,
and push adapters. The Azure build path follows the same Apple builder-capacity policy
as `build.sh`; shared code should own that policy rather than duplicating it.

Build steps:

1. select and ready the container runtime;
2. create a clean temporary context using `.dockerignore`;
3. generate a unique deployment marker in staged
   `public/deployment-version.txt` without modifying the source tree;
4. copy `Dockerfile` explicitly into the staged context;
5. build for `linux/amd64` with `NEXT_PUBLIC_LANGGRAPH_URL` and
   `NEXT_PUBLIC_ASSISTANT_ID` build arguments;
6. tag only `<acr-login-server>/deepagent-ui:latest`;
7. request a short-lived ACR access token with
   `az acr login --name "$ACR_NAME" --expose-token --query accessToken -o tsv`;
8. pipe the token to
   `container_cli_login --username 00000000-0000-0000-0000-000000000000 --password-stdin "$ACR_LOGIN_SERVER"`
   without echoing it, then unset the token variable; and
9. push through `container_cli_push`.

The temporary context is removed by an exit trap on success or failure. Build, login,
and push failures retain their nonzero outcome and stop before Container App update.

## Secret and Application Update

After a successful image push, configure a Container Apps secret named
`upload-api-key` as an unversioned Key Vault reference:

```text
keyvaultref:<vault-uri>/secrets/UPLOAD-API-KEY,identityref:system
```

Using an unversioned reference permits platform-managed secret refresh. The app
environment references it as:

```text
UPLOAD_API_KEY=secretref:upload-api-key
```

Generate a lowercase UTC timestamp-plus-process-ID revision suffix such as
`ui-20260811t170000-12345`. Including the process ID prevents collision between two
deployments launched during the same second. The unique suffix forces a new revision
for each `latest` deployment.

Run `az containerapp update` with the discovered `--container-name` and only
revision-scoped image and environment changes. Upsert:

- `NEXT_TELEMETRY_DISABLED=1`
- `NEXT_PUBLIC_LANGGRAPH_URL=<backend HTTPS URL>`
- `BACKEND_API_URL=<backend HTTPS URL>`
- `NEXT_PUBLIC_ASSISTANT_ID=<assistant ID>`
- `AUTH_URL=<UI HTTPS URL>`
- `NEXTAUTH_URL=<UI HTTPS URL>`
- `AUTH_TRUST_HOST=true`
- `NODE_ENV=production`
- `UPLOAD_API_KEY=secretref:upload-api-key`

Preserve unrelated environment variables and existing platform configuration.
Storage remains an existing-resource responsibility: the script does not create a
volume or alter volume mounts. Existing `MARKDOWN_STORAGE_DIR` and storage settings
remain untouched.

## Readiness and Exact-Version Verification

Record the previous active revision before updating. After update:

1. discover the new latest revision name;
2. require it to differ from the previous revision;
3. poll boundedly for successful provisioning and a running state;
4. fail immediately on failed, degraded, or activation-failed states and print
   revision diagnostics; and
5. poll the public
   `https://<container-app-fqdn>/deployment-version.txt` endpoint until it returns
   HTTP 200 with the exact staged deployment marker.

Azure Container Apps single-revision mode keeps the old revision active until the new
revision is ready. The script preserves that mode and never changes traffic weights.
If the resource is in multiple-revision mode, preflight fails before build.

If Azure reports a successful revision but exact HTTP verification fails, the script
exits nonzero and reports the app URL, previous revision, new revision, provisioning
state, and running state. It does not automatically alter traffic or reactivate a
revision.

## Failure Boundaries

- Subscription errors stop before any Azure resource access.
- Missing prerequisites stop before local build and before cloud mutation.
- Build, registry login, or push errors stop before secret/app update.
- Secret-reference failure stops before new revision creation.
- Update or readiness failures leave Azure's single-revision behavior responsible for
  retaining traffic on the old ready revision.
- Exact-version health failure is a deployment failure even if Azure reports the
  revision running.
- No command logs tokens, Key Vault values, `.env` contents, or registry credentials.

## Tests

Use Node's built-in test runner with temporary fake executables. Tests perform no real
Azure or registry operations.

### Subscription guard

- missing `AZURE_SUBSCRIPTION_ID` fails clearly;
- unauthenticated Azure CLI fails;
- `az account set` failure propagates;
- active account mismatch fails;
- success selects and confirms the exact subscription; and
- every Azure-facing script invokes selection before its first resource access.

### Container Apps deployment

- missing ACR, UI app, backend app, secret, system identity, matching system-identity
  ACR pull configuration, external ingress, target port 3000, exactly one application
  container, or single-revision mode fails before build/push;
- runtime selection preserves Apple Container, Podman, Docker priority and override;
- clean context excludes local environment and generated files;
- image is built for `linux/amd64` with exact argument boundaries;
- only `<acr-login-server>/deepagent-ui:latest` is pushed;
- ACR token is passed through stdin and absent from stdout/stderr;
- secret uses Key Vault reference with `identityref:system`;
- discovered backend URL overrides loaded backend URLs for both build and runtime;
- `.env.docker` assistant ID overrides earlier values for both build and runtime;
- update names the sole discovered container and uses a collision-resistant revision
  suffix, exact image, and required environment variables;
- no create, identity assignment, role assignment, ingress, scale, traffic, revision
  mode, network, or volume mutation command runs;
- build, login, push, secret, update, provisioning, and HTTP failures propagate; and
- success requires exact deployment marker.

### Repository verification

- `bash -n` for all changed shell scripts;
- focused subscription and Container Apps tests;
- existing container-runtime and deployment-security tests;
- Prettier on changed Markdown/JavaScript;
- `yarn lint`;
- `yarn build`; and
- `git diff --check`.

## Documentation

Add `documents/deployment/azure-container-apps.md` covering:

- existing-resource boundary;
- subscription selection;
- required Azure roles and managed identities;
- local runtime priority and override;
- build/push/deploy flow;
- Key Vault reference behavior;
- single-revision requirement;
- verification and diagnostics;
- mutable `latest` rollback limitation;
- persistent-storage ownership; and
- security, cost, and cleanup responsibilities.

Update repository deployment indexes and the App Service guide to describe explicit
subscription selection. Keep App Service and Container Apps as separate deployment
paths.

## References

- [Azure Container Apps revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
- [Azure Container Apps secrets](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Azure Container Apps secret CLI](https://learn.microsoft.com/en-us/cli/azure/containerapp/secret?view=azure-cli-latest)
- [Managed identity image pulls from ACR](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull)
- [ACR authentication troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-container-registry/acr-authentication-errors)
