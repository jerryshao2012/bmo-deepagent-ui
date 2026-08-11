# Azure Container Apps UI Deployment Design

## Goal

Add a two-command Azure Container Apps deployment path for the UI while keeping the
existing Azure App Service ZIP deployment in `deploy.sh` unchanged as a supported
target.

`build.sh` builds the UI image locally and pushes `latest` to Docker Hub.
`deploy-azure-container-app.sh` deploys that already-pushed image to an existing
Azure Container App and verifies that the new revision is serving the exact build.
This mirrors the working backend deployment's Docker Hub authentication model and
does not require Azure role-assignment permissions.

## Decisions

- Keep App Service deployment in `deploy.sh`.
- Add a separate `deploy-azure-container-app.sh` entry point.
- Keep build and deployment separate: operators run `build.sh`, then
  `deploy-azure-container-app.sh`.
- Require an existing resource group, UI Container App, backend Container App, Key
  Vault, system identity, ingress, networking, scaling, and storage configuration.
- Build through the shared runtime priority: Apple Container, Podman, then Docker.
  Allow the existing `CONTAINER_CLI` override for `build.sh`; deployment has no
  container-runtime dependency.
- Push and deploy only `docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest`.
- Reuse the backend's Docker Hub account and `DOCKER-HUB-PAT` Key Vault secret.
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
- `KV_NAME`
- `SEED`
- `DOCKER_HUB_USERNAME`, defaulting to the approved shared Docker Hub account
- `NEXT_PUBLIC_LANGGRAPH_URL`
- `NEXT_PUBLIC_ASSISTANT_ID`
- `CONTAINER_APP_NAME`, defaulting to `bmo-deepagent-ui-$SEED`

The implementation must preserve the operator's current
`AZURE_SUBSCRIPTION_ID` value and other uncommitted `env.sh` edits.

Optional `.env.docker` values may supply runtime settings using the same safe,
line-oriented loading behavior as `deploy.sh`. The script must not print or copy
secret values into logs, source control, or image layers.

Configuration precedence is explicit:

1. source `env.sh`, including the backend environment values it owns;
2. load optional `.env.docker`, allowing it to override
   `NEXT_PUBLIC_ASSISTANT_ID`;
3. capture `NEXT_PUBLIC_ASSISTANT_ID`, defaulting to `research`; and
4. `build.sh` uses the backend URL loaded by `env.sh` for image build arguments; and
5. deployment rediscovers the backend Container App ingress URL and uses that
   canonical URL for runtime variables.

The backend URL in `env.sh` is maintained by the backend deployment and must match
the URL rediscovered during UI deployment. Deployment fails before mutation if the
two values differ, preventing a split build from publishing a client bundle for one
backend and deploying it with another runtime URL.

`build.sh` accepts exported Docker Hub credentials first. If they are absent, it may
load only `DOCKER_HUB_USERNAME` and `DOCKER_HUB_PAT` from the approved sibling
`../deep-research/.env`; it must not import unrelated deployment or shell-control
variables. The PAT is never written to repository files or logs.

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

The Container Apps script validates all required resources before mutating the UI
app:

- requested Azure subscription is active;
- resource group exists;
- UI Container App named by `CONTAINER_APP_NAME` exists;
- UI Container App uses external ingress and has a public FQDN;
- ingress target port is exactly `3000`, matching the image's server port;
- UI Container App is in single-revision mode;
- UI Container App has a system-assigned identity;
- UI Container App has exactly one application container; its existing name is
  discovered and passed explicitly to `az containerapp update --container-name`;
- backend Container App `deep-research-agent-$SEED` exists, uses external ingress,
  and has a public FQDN suitable for browser-facing `NEXT_PUBLIC_LANGGRAPH_URL`;
- Key Vault exists and contains both `UPLOAD-API-KEY` and `DOCKER-HUB-PAT`; and
- the local `.deployment-version` marker exists and is valid; and
- current Azure principal can read the resource metadata and secret ID needed by
  preflight.

The script must not create resources, assign identities, grant roles, change ingress,
change revision mode, change scale rules, change networking, or configure volume
mounts. Missing prerequisites produce actionable errors before cloud application
mutation.

The UI app's system identity needs Key Vault secret read access. No `AcrPull` role is
required. The operator principal needs resource-read/update access, Key Vault secret
metadata access for preflight, and permission to update Container App secrets,
registry configuration, and revisions.

The script does not attempt to prove effective Azure RBAC or Key Vault policy through
role-assignment enumeration because inherited scopes and vault access models make that
check unreliable. It validates observable structure and operations instead:

- `az keyvault secret show` proves the operator can resolve the secret ID;
- Docker Hub login and image push in `build.sh` prove operator registry access;
- Container App registry metadata must name `docker.io`, the approved username, and
  the Key Vault-backed password secret; and
- new revision provisioning/readiness proves the workload identity can resolve its
  image and Key Vault reference.

If Docker Hub credentials or Key Vault secret access are ineffective, the new
revision fails and single-revision mode keeps traffic on the previous ready revision.

## Container Build and Push (`build.sh`)

Reuse `scripts/container-runtime.sh` for runtime selection, readiness, build, login,
and push adapters. `build.sh` remains the only build entry point and owns the Apple
builder-capacity policy.

Build steps:

1. select and ready the container runtime;
2. create a clean temporary context using `.dockerignore`;
3. generate a unique deployment marker in staged
   `public/deployment-version.txt` without modifying the source tree;
4. copy `Dockerfile` explicitly into the staged context;
5. build for `linux/amd64` with `NEXT_PUBLIC_LANGGRAPH_URL` and
   `NEXT_PUBLIC_ASSISTANT_ID` build arguments;
6. tag only `docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest`;
7. pipe `DOCKER_HUB_PAT` to `container_cli_login` through stdin without echoing it,
   then unset the PAT variable;
8. push through `container_cli_push`; and
9. only after a successful push, atomically write the exact marker to ignored local
   file `.deployment-version` for the deploy step.

The temporary context is removed by an exit trap on success or failure. Build, login,
and push failures retain their nonzero outcome and do not replace a prior successful
`.deployment-version` marker.

## Docker Hub Secret, Registry, and Application Update

Deployment performs no build or push. It requires `.deployment-version`, then
configures two unversioned Key Vault references:

```text
keyvaultref:<vault-uri>/secrets/UPLOAD-API-KEY,identityref:system
keyvaultref:<vault-uri>/secrets/DOCKER-HUB-PAT,identityref:system
```

Using an unversioned reference permits platform-managed secret refresh. The app
environment references it as:

```text
UPLOAD_API_KEY=secretref:upload-api-key
```

Upsert the `docker.io` registry entry with `DOCKER_HUB_USERNAME` and
`secretref:docker-hub-pat`. The PAT value must never appear in command arguments,
temporary files, output, or shell traces. Existing unrelated registry entries remain
untouched.

Generate a lowercase UTC timestamp-plus-process-ID revision suffix such as
`ui-20260811t170000-12345`. Including the process ID prevents collision between two
deployments launched during the same second. The unique suffix forces a new revision
for each `latest` deployment.

Run `az containerapp update` with the discovered `--container-name`, image
`docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest`, and only
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
   HTTP 200 with the exact marker read from `.deployment-version`.

Azure Container Apps single-revision mode keeps the old revision active until the new
revision is ready. The script preserves that mode and never changes traffic weights.
If the resource is in multiple-revision mode, preflight fails before cloud mutation.

If Azure reports a successful revision but exact HTTP verification fails, the script
exits nonzero and reports the app URL, previous revision, new revision, provisioning
state, and running state. It does not automatically alter traffic or reactivate a
revision.

## Failure Boundaries

- Subscription errors stop before any Azure resource access.
- Missing build marker or prerequisites stop before cloud mutation.
- Build, Docker Hub login, or push errors leave deployment as a separate unstarted
  step and preserve the last successful marker.
- Docker Hub secret or registry-configuration failure stops before new revision
  creation.
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

### Docker Hub build

- runtime selection preserves Apple Container, Podman, Docker priority and override;
- only the two approved Docker Hub credential keys can be imported from the shared
  backend `.env`;
- clean context excludes local environment and generated files;
- image is built for `linux/amd64` with exact argument boundaries;
- only `docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest` is pushed;
- PAT is passed through stdin and absent from stdout/stderr; and
- `.deployment-version` is replaced only after successful push.

### Container Apps deployment

- missing UI app, backend app, either secret, system identity, local build marker,
  external UI/backend ingress, public UI/backend FQDN, target
  port 3000, exactly one application container, or single-revision mode fails before
  cloud mutation;
- deploy script never invokes a container runtime, build, login, or push;
- both secrets use Key Vault references with `identityref:system`;
- Docker Hub registry configuration uses `secretref:docker-hub-pat` without exposing
  the PAT;
- discovered backend URL must match the URL used by the completed build;
- `.env.docker` assistant ID overrides earlier values for both build and runtime;
- update names the sole discovered container and uses a collision-resistant revision
  suffix, exact image, and required environment variables;
- no create, identity assignment, role assignment, ingress, scale, traffic, revision
  mode, network, or volume mutation command runs;
- secret, registry, update, provisioning, and HTTP failures propagate; and
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
- explicit `build.sh` then `deploy-azure-container-app.sh` flow;
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
- [Azure Container Apps registry CLI](https://learn.microsoft.com/en-us/cli/azure/containerapp/registry?view=azure-cli-latest)
- [Containers in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/containers)
