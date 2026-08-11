# Deploy to Azure Container Apps

Build and deploy UI image to an existing Azure Container App with
[`deploy-azure-container-app.sh`](../../deploy-azure-container-app.sh). This workflow
does not provision Azure infrastructure. For Linux Azure App Service ZIP deployment,
use [`deploy.sh`](../../deploy.sh) and the
[App Service guide](azure-app-service.md).

> Operator owns resource provisioning, access control, persistent storage,
> availability, cost management, rollback, and cleanup.

## Existing environment

Deployment requires:

- resource group, Azure Container Registry, Key Vault, and Container Apps
  environment;
- UI Container App named by `CONTAINER_APP_NAME`, default
  `bmo-deepagent-ui-$SEED`;
- backend Container App named `deep-research-agent-$SEED`;
- external ingress and public FQDN on both apps;
- UI ingress target port `3000`, `Single` revision mode, system-assigned identity,
  and exactly one application container;
- UI registry configuration for selected ACR login server using identity `system`;
- Key Vault secret `UPLOAD-API-KEY`;
- system identity permissions to pull from ACR and resolve Key Vault secret; and
- operator permissions to read resources and secret ID, acquire ACR push token, push
  image, set Container App secret, and update app.

Script verifies resource shape and registry identity configuration, but does not
enumerate RBAC. Grant UI identity `AcrPull` on registry and `Key Vault Secrets User`
or equivalent secret-read access. Effective permissions are proven only when new
revision pulls image and resolves secret.

## Local prerequisites

- Azure CLI authenticated to intended tenant.
- `az`, `curl`, `rsync`, and Node.js on `PATH`.
- One supported container runtime: Apple Container, Podman, or Docker.
- Repository `Dockerfile`, `.dockerignore`, local `.env`, and readable sibling
  `../deep-research/env.sh`.
- Optional ignored `.env.docker` for intended runtime settings such as
  `NEXT_PUBLIC_ASSISTANT_ID`.

Runtime auto-selection order is Apple Container, daemonless Podman, then Docker.
Set `CONTAINER_CLI=container`, `CONTAINER_CLI=podman`, or `CONTAINER_CLI=docker` in
calling environment to choose explicitly. Podman must already be usable without a
managed machine/daemon; Docker daemon must be running. Script may start Apple
Container system and configures its builder to at least 8 GiB when needed.

## Configure

[`env.sh`](../../env.sh) supplies Azure defaults, including:

- `AZURE_SUBSCRIPTION_ID`
- `SEED`
- `RESOURCE_GROUP`
- `ACR_NAME`
- `KV_NAME`
- `CONTAINER_APP_NAME`

Review values before every deployment. Put private local overrides in ignored
`.env`, which `env.sh` sources last. Deployment selects and confirms exact
`AZURE_SUBSCRIPTION_ID` before querying resources.

Deployment reads optional `.env.docker` without rewriting it. Protected deployment
and shell controls, including subscription/resource names, `CONTAINER_CLI`, polling
controls, and `PATH`, cannot be set there. `NEXT_PUBLIC_ASSISTANT_ID` may come from
`.env` or `.env.docker` and defaults to `research`. Backend URL from local files is
not authoritative: script discovers backend public FQDN and uses
`https://<backend-fqdn>` for build and Container App environment.

Private `secrets.sh` is ignored and untracked. Never inspect, copy, or force-add an
operator's local copy. [`secrets.sh.example`](../../secrets.sh.example) is tracked
source; operators review it, update placeholders, and regenerate their private local
copy when secret rotation is explicitly authorized.

## Deploy

Run from any directory:

```bash
/path/to/bmo-deepagent-ui/deploy-azure-container-app.sh
```

From repository root:

```bash
./deploy-azure-container-app.sh
```

Script performs this sequence:

1. Loads configuration without changing `.env.docker`, validates local commands and
   runtime, then selects configured Azure subscription.
2. Validates existing resource group, ACR, UI/backend apps, UI registry/identity,
   Key Vault, and `UPLOAD-API-KEY` secret ID.
3. Discovers canonical UI and backend URLs. Discovered backend overrides loaded
   `NEXT_PUBLIC_LANGGRAPH_URL`.
4. Creates temporary build context honoring `.dockerignore`, adds exact deployment
   marker, and builds Linux AMD64 image with backend URL and assistant ID.
5. Gets short-lived ACR token, authenticates runtime over stdin, and pushes only
   `<acr-login-server>/deepagent-ui:latest`.
6. Sets unversioned Key Vault reference
   `<vault-uri>/secrets/UPLOAD-API-KEY` as `upload-api-key` using system identity.
7. Updates existing application container image and deployment-owned environment
   variables with unique lowercase revision suffix.
8. Waits for new revision to report `Provisioned|Running`, then requires HTTP 200
   and complete `/deployment-version.txt` body to equal exact new marker.

Revision polling defaults to 60 attempts at 5 seconds. HTTP polling defaults to 36
attempts at 5 seconds, with 10-second connect and 30-second request timeouts.

## Mutation boundaries

Deployment changes only:

- mutable image tag `deepagent-ui:latest` in ACR;
- Container App secret `upload-api-key` Key Vault reference;
- selected application container image, revision suffix, and these environment
  variables: backend URLs, assistant ID, Auth.js URLs, telemetry, trust-host,
  production mode, and secret reference.

It does not create resources or pass options that change ingress, target port,
revision mode, identity, registry configuration, scaling, traffic, networking,
volumes, or resource limits. Existing unrelated app settings remain operator-owned.
Single-revision mode activates new revision according to existing Container Apps
behavior; script does not edit traffic.

## Verify

Successful exit proves new revision serves exact marker. Also verify:

- UI loads and Settings show discovered backend and intended assistant;
- chat starts, streams, uploads, and file routes authenticate;
- OAuth callback returns to UI FQDN;
- Container App secret resolves through system identity; and
- persistent data survives revision replacement.

Script does not add storage. Container filesystem is ephemeral across revisions.
For synchronized Markdown persistence, retain an existing durable volume mount and
set `MARKDOWN_STORAGE_DIR` to mounted path.

## Troubleshooting

| Failure                       | Check                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Subscription selection fails  | `AZURE_SUBSCRIPTION_ID`, `az login`, tenant access, and subscription visibility.                                                 |
| Resource preflight fails      | Resource names, selected subscription/group, external ingress, UI port `3000`, `Single` mode, identity, and one-container shape. |
| ACR configuration fails       | ACR login server, registry entry identity `system`, operator push rights, and UI identity `AcrPull`.                             |
| Key Vault check/set fails     | Vault name/networking, secret ID visibility, operator app-update rights, and UI identity secret-read role.                       |
| Runtime readiness/build fails | Selected runtime, Docker daemon/Podman usability, Apple builder memory, disk, Dockerfile, and build logs.                        |
| Token/login/push fails        | Azure CLI identity, ACR permissions, token output, registry reachability, and runtime credential store.                          |
| Revision fails or times out   | Container App revision/system logs, image pull, Key Vault resolution, startup, port `3000`, and resource limits.                 |
| Marker times out              | UI FQDN/DNS/TLS, ingress reachability, revision logs, HTTP status, and stale proxy/cache response.                               |

Script stops on failure and does not automatically roll back.

## Update and rollback

Every run overwrites only `latest`; no immutable release tag is retained. Unique
revision suffix identifies deployment attempt but cannot restore overwritten image.

Before deploy, record Git revision and current ready Container App revision. To roll
back, check out known-good Git source, restore compatible local configuration, and
rerun `./deploy-azure-container-app.sh` to rebuild and push old source as `latest`.
Verify exact marker and functional checklist. Do not assume changing revision traffic
can recover old bytes after mutable tag has been replaced.

## Security, cost, and cleanup

- Never print/store ACR token, Key Vault value, `.env` content, or private secret
  script in logs/version control.
- Use least privilege for operator and managed identity; review Key Vault/ACR network
  restrictions and audit logs.
- Review Container Apps, Log Analytics, ACR storage/egress, Key Vault, and persistent
  storage pricing before use. Script does not set budgets or scaling policy.
- Remove app/environment, registry images, vault/secret, role assignments, logs, and
  persistent data manually when environment is retired. Script performs no cleanup.

See [Azure Container Apps revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions),
[Container Apps secrets](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets),
and [managed identity image pulls from ACR](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull).

Return to [deployment documentation](../README.md#deployment).
