# Deploy to Azure App Service

Deploy UI as prebuilt standalone Next.js ZIP to existing Linux Azure App Service by
running [`deploy.sh`](../../deploy.sh).

> This guide documents repository automation, not complete production hardening.
> Operator owns Azure resource provisioning, access control, backups, availability,
> cost management, rollback, and cleanup.

## Architecture

```text
local workstation
  └─ deploy.sh
       ├─ discovers existing App Service and backend Container App
       ├─ reads UPLOAD-API-KEY from existing Key Vault
       ├─ builds standalone Next.js package
       └─ ZIP-deploys package to Linux App Service

browser ──HTTPS──> App Service UI ──HTTPS──> backend Container App
                           └───────────────> /home/data/markdown_threads
```

Script does not create resource group, App Service, backend Container App, Key Vault,
managed identity, or identity role assignments.

## Prerequisites

### Existing Azure resources

- Linux App Service in target resource group.
- Backend Azure Container App named `deep-research-agent-<suffix>` in same resource
  group.
- Azure Key Vault containing `UPLOAD-API-KEY`.
- App Service managed identity authorized to read that secret.
- Required Azure resource providers registered for resources already provisioned.

Script checks whether current Azure CLI principal can read secret. That does not prove
App Service runtime identity can resolve Key Vault reference. Enable managed identity
and grant it `Key Vault Secrets User` or equivalent vault access before deployment. See
[App Service Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references)
and [managed identities](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity).

### Local tools and files

- Azure CLI authenticated to correct subscription.
- Node.js 22, Corepack, and repository Yarn release.
- `az`, `yarn`, `zip`, `curl`, and `grep` on `PATH`.
- Sibling backend repository at `../deep-research` with readable `env.sh` exporting
  `DEEP_RESEARCH_AGENT_URL`.
- Local `.env` file. Tracked [`env.sh`](../../env.sh) sources it unconditionally.
- Optional ignored `.env.docker`, typically copied from
  [`.env.docker.example`](../../.env.docker.example).

Check provider registration when troubleshooting missing resource types:

```bash
az provider show --namespace Microsoft.Web --query registrationState -o tsv
az provider show --namespace Microsoft.App --query registrationState -o tsv
az provider show --namespace Microsoft.KeyVault --query registrationState -o tsv
```

Register missing provider only with subscription-owner approval.

## Configure deployment

### 1. Review tracked environment loader

[`env.sh`](../../env.sh) contains repository-specific defaults and also:

1. sources `../deep-research/env.sh`;
2. derives backend URL;
3. updates `NEXT_PUBLIC_LANGGRAPH_URL` in `.env.docker` when file exists;
4. sources local `.env` last.

Use ignored `.env` to override placeholders without committing account-specific names:

```env
SEED="your-suffix"
RESOURCE_GROUP="your-resource-group"
KV_NAME="your-key-vault"
WEBAPP_NAME="your-app-service"
NEXT_PUBLIC_ASSISTANT_ID="research"
```

Do not copy repository sample suffix or resource names into another environment without
review.

### 2. Prepare optional runtime environment

```bash
cp .env.docker.example .env.docker
```

Replace placeholders. `env.sh` rewrites backend URL in this ignored file when it runs.
Never commit `.env`, `.env.docker`, copied secret scripts, or credentials.

Only settings listed in `deploy.sh` `desired_app_settings` are written to App Service.
Passkey variables loaded from `.env.docker` are not currently propagated by script;
configure them separately as protected App Service settings/Key Vault references when
passkeys are enabled, then verify exact origin and proxy values.

### 3. Populate Key Vault

Tracked [`secrets.sh.example`](../../secrets.sh.example) is template, not safe to run
unchanged. Copy to ignored `secrets.sh`, replace every placeholder, review target vault,
then run only with authority to create or rotate those secrets:

```bash
cp secrets.sh.example secrets.sh
chmod 700 secrets.sh
./secrets.sh
```

Current UI deployment references only `UPLOAD-API-KEY`. Other template values may be
used by related authentication/backend workflows; confirm ownership before rotation.

## Preflight

Run from repository root:

```bash
az account show --query '{subscription:name,tenant:tenantId}' -o table
test -r .env
test -r ../deep-research/env.sh
command -v az yarn zip curl grep
```

Source environment loader for resource checks. It may update
`NEXT_PUBLIC_LANGGRAPH_URL` in `.env.docker`, so review or back up that ignored file
first:

```bash
source ./env.sh
az webapp show --name "$WEBAPP_NAME" --resource-group "$RESOURCE_GROUP" --query defaultHostName -o tsv
az containerapp show --name "deep-research-agent-$SEED" --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv
az keyvault secret show --vault-name "$KV_NAME" --name UPLOAD-API-KEY --query id -o tsv
```

Do not continue if any command points to unexpected subscription or resource.

## Deploy

```bash
./deploy.sh
```

Script:

1. validates App Service state and stops on `QuotaExceeded`/`Exceeded`;
2. discovers backend Container App ingress hostname;
3. verifies current CLI identity can see Key Vault secret;
4. configures Node.js 22, `node server.cjs`, HTTPS-only, HTTP/2, TLS 1.2 minimum,
   WebSockets, and disabled FTPS;
5. applies backend, Auth.js, storage, and Key Vault-reference app settings;
6. removes local `node_modules`, runs immutable install and production build;
7. creates standalone ZIP without environment files;
8. runs `az webapp deploy --clean --restart`;
9. polls deployment marker for exact newly built version.

On rerun, unchanged runtime/app settings are skipped to avoid unnecessary restart. App
package is still rebuilt and deployed with clean replacement. Azure ZIP deployment
details: [Deploy files to App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip).

## Verify

Script success proves new marker is served. Also test application behavior:

- UI loads over HTTPS.
- Settings show intended backend and assistant.
- Chat starts and streams a run.
- Upload and file-view routes authenticate.
- OAuth callback returns to App Service URL.
- Passkey operations work only when both UI and backend are configured.
- App Service configuration shows Key Vault reference resolved, not an error value.
- Markdown data persists under `/home/data/markdown_threads` across restart.

## Update and rollback

No automatic rollback exists. `--clean` removes files absent from new package, and App
Service restarts during deployment.

Before change:

- record Git revision and current deployment marker;
- back up `/home/data/markdown_threads` when data matters;
- keep known-good source revision and dependencies reproducible;
- schedule maintenance window when plan quota or traffic requires it.

To roll back, check out known-good revision, restore compatible configuration, rebuild,
and rerun `./deploy.sh`. Verify marker and functional checklist again.

## Troubleshooting

| Symptom                                   | Check                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| App Service not found                     | `WEBAPP_NAME`, `RESOURCE_GROUP`, subscription, and existing resource.                   |
| Backend Container App missing             | `SEED`, resource group, sibling backend environment, and ingress status.                |
| Key Vault secret unavailable              | Vault name, current CLI access, secret name, and vault networking.                      |
| Key Vault reference unresolved at runtime | App Service identity, `Key Vault Secrets User`/access policy, and vault network access. |
| F1 quota exceeded                         | App Service quota/status. Wait for reset or move to approved paid plan.                 |
| Build fails                               | Node/Yarn versions, registry authentication, lockfile, and available disk/memory.       |
| Marker never appears                      | App Service deployment logs, startup command, package contents, and quota state.        |
| Markdown data missing                     | `MARKDOWN_STORAGE_DIR`, App Service persistent `/home` storage, and backups.            |

## Security, availability, cost, and cleanup

- Keep secrets in Key Vault and grant least privilege to App Service identity.
- Restrict who can run copied `secrets.sh`; it rotates values.
- F1 behavior and quotas are unsuitable for availability guarantees.
- One App Service deployment can be interrupted during restart/clean replacement.
- Review current Azure pricing and quota policy before provisioning or scaling.
- Operator removes App Service, Key Vault, backend resources, persistent data, and
  related role assignments when environment is retired; `deploy.sh` never cleans them.

Return to [deployment documentation](../README.md#deployment).
