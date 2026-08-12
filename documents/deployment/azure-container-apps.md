# Deploy to Azure Container Apps

Build UI image and update existing Azure Container App using separate scripts. This
workflow is update-only managed passkey cutover; it does not provision Azure
infrastructure. For Linux App Service ZIP deployment, use
[App Service guide](azure-app-service.md).

> Operator owns resource provisioning, access control, storage, availability, cost,
> rollback, and cleanup.

## Existing prerequisites

- resource group and Container Apps environment named by `env.sh`;
- existing backend and UI Container Apps in same environment, external ingress, and
  expected ports (`2024` backend, `3000` UI);
- UI `Single` revision mode, exactly one application container, and either an
  existing system-assigned identity or exactly one existing user-assigned identity;
- Key Vault with `UPLOAD-API-KEY`, `DOCKER-HUB-PAT`, and
  `PASSKEY-PROXY-SECRET`;
- effective selected UI managed-identity secret read through current authorization model
  (RBAC role dataActions or access policy);
- existing Docker Hub registry entry using `docker.io`, expected username,
  `passwordSecretRef: docker-hub-pat`, and same selected managed identity on its
  Key Vault secret reference;
- operator read access for preflight, permission to update existing UI app, Docker
  Hub publish credential for build, and local Node.js plus supported container runtime.

Deployment does not grant roles or access policies, create/assign identities, or
create infrastructure. Run read-only preflight; if effective identity access or any
prerequisite is missing, stop and contact Azure administrator. Do not suggest or run
automatic permission mutation.

## Resolve endpoints and OAuth values

Review `env.sh`, then resolve URLs before builds:

```bash
source ./env.sh
./scripts/resolve-azure-endpoints.sh
```

Resolver makes one `az containerapp env show` query for resource ID,
`properties.defaultDomain`, and `Succeeded` state. It derives
`https://<app>.<defaultDomain>` from validated app names; it never creates placeholder
apps or queries app FQDNs. Machine stdout contains strict single-quoted assignments,
which scripts parse without `eval`; parenthesized resource-group names remain safe.

Stderr prints exact provider settings:

```text
Google authorized redirect URI: https://<backend-app>.<default-domain>/auth/callback/google
GitHub authorization callback URL: https://<backend-app>.<default-domain>/auth/callback/github
GitHub homepage / frontend origin: https://<ui-app>.<default-domain>
```

Update Google/GitHub before traffic, then pass process-local
`OAUTH_REDIRECTS_CONFIRMED=true` when endpoints are new/changed. Environment
recreation may change `defaultDomain`; repeat provider update. Never persist
confirmation. After verified deploy, metadata is atomically recorded in ignored
`.resolved-azure-endpoints.json`; neither script rewrites endpoints in `env.sh`.

## Sanitize private build configuration

Optional ignored `.env.docker` may contain non-secret assistant/default settings only.
Production origins and proxy settings are deployment-owned. Build/deploy reject
`FRONTEND_URLS`, passkey origin/RP settings, proxy ID/secret, or enabled flag there.

For approved cleanup of older private file:

```bash
node scripts/sanitize-passkey-dotenv.mjs --input .env.docker --check
node scripts/sanitize-passkey-dotenv.mjs --input .env.docker --sanitize
```

Sanitizer strictly parses dotenv, preserves unrelated bytes/mode, uses atomic safe
replacement, and prints no values. If automatic restore cannot complete, it reports
exact recovery backup path; inspect/preserve newer pathname and restore prior original
manually before retrying. Secret remains runtime-only Key Vault reference and never
belongs in dotenv or image.

## Build once, then deploy once

Backend must be built, deployed, and verified first. For UI:

```bash
./build.sh
OAUTH_REDIRECTS_CONFIRMED=true ./deploy-azure-container-app.sh
```

Run each exactly once for cutover. `build.sh` is sole image-production owner: resolve
backend URL, stage clean context, build `linux/amd64`, log in/push
`docker.io/jerryshao2013/deepagent-ui:latest`, then atomically write ignored
`.deployment-build.json` with image, backend URL, assistant ID, and marker.

Deployment never invokes runtime, build, login, push, or `rsync`. It requires manifest
to match current resolved endpoints/config, validates existing Key Vault/identity and
Docker Hub registry prerequisites before app mutation, uses pinned manifest image,
validates existing versionless Key Vault references without reading secret values,
copies template state from exact latest ready revision, updates deployment-owned
runtime values while preserving unrelated configuration, waits through asynchronous
revision creation, and requires exact marker over HTTP before recording endpoint
metadata.

Run one UI deployment at a time. Script rechecks latest ready revision immediately
before ARM PATCH, but Container Apps ETag is currently null and service documents no
compare-and-swap precondition for this update. A second writer can therefore win after
final revision check and before PATCH; last writer wins in that bounded window. If
another deployment may be active, wait for it to finish and rerun from fresh preflight.

Runtime passkey values are `PASSKEY_ENABLED=true`, exact Azure `PASSKEY_ORIGIN`,
`PASSKEY_PROXY_ID=web-bff`, and `PASSKEY_PROXY_SECRET` secret reference. Backend uses
`FRONTEND_URLS` as sole multi-origin source with
`PASSKEY_DERIVE_FROM_FRONTEND_URLS=true` and includes reserved Vercel origin mapping.

## Verify Azure only

- backend health/revision succeeded before UI build;
- UI root and `/login` return 200 and marker matches manifest;
- UI Key Vault references resolve via selected existing managed identity with zero
  restarts;
- `/api/auth/passkeys` reaches backend and returns backend auth rejection, not
  `passkeys_unavailable`;
- OAuth login returns to exact Azure UI;
- **Manage passkeys** opens, lists keys, and start/cancel registration works;
- OAuth recovery remains available; do not delete credentials during cutover.

Current rollout does not configure, build, deploy, or verify Vercel. Future activation
requires then-current server-only secret, canonical stable origin/proxy ID, deployment,
and verification before traffic; never use ephemeral `VERCEL_URL`, and preserve RP
continuity for enrolled credentials.

## Rollback, security, and cleanup

Record prior active revision/image and `.deployment-build.json` before update. Script
does not auto-rollback. Rollback must use known-good pinned artifact and repeat marker
and functional checks; do not rebuild accidentally during deploy.

Never print Key Vault values, Docker Hub PAT, `.env.docker`, or secret-bearing exports.
Retain single-revision/storage constraints, review logs/networking/cost, and have
administrator remove resources only through approved cleanup workflow.

Return to [deployment documentation](../README.md#deployment).
