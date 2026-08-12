# Passkey Key Vault Runtime Design

## Goal

Enable passkey management on the Azure Container Apps UI without embedding the shared proxy secret in either container image or exposing it through a public environment variable.

Make frontend origins single-source so adding or changing a supported frontend never requires editing duplicate OAuth, WebAuthn origin, and relying-party lists.

## Canonical frontend configuration

Backend `FRONTEND_URLS` is the only multi-origin source. It includes one active Azure frontend and one reserved future frontend:

- Azure Container Apps UI (active in this rollout)
- `https://bmo-deepagent-ui.vercel.app` (reserved; no Vercel deployment in this rollout)

`PASSKEY_DERIVE_FROM_FRONTEND_URLS=true` selects canonical mode. It defaults to `false` for backward compatibility with existing non-UI deployments. In canonical mode, backend derives validated `PASSKEY_ORIGINS` from normalized `FRONTEND_URLS` and derives unique `PASSKEY_RP_IDS` from their hostnames. Explicit `PASSKEY_ORIGINS`, `PASSKEY_RP_IDS`, or `PASSKEY_RP_ID` is rejected instead of silently overriding derived values. Explicit mode retains the existing origin/RP settings and validation only when the derivation flag is false.

Canonical mode accepts only comma-separated exact origins: HTTPS except loopback development, no credentials, path other than `/`, query, fragment, wildcard, or trailing slash after normalization. Duplicate normalized origins are rejected. Every derived hostname is validated by the existing RP-ID rules. Each exact request origin binds to its own hostname RP ID; no independent origin/RP Cartesian product is created.

Each active frontend derives its singular `PASSKEY_ORIGIN` from its own deployment platform rather than copying the backend list:

- Azure deployment uses the Container App's HTTPS FQDN.
- Future Vercel activation requires explicit server-only `PASSKEY_ORIGIN=https://bmo-deepagent-ui.vercel.app`. It must never use ephemeral `VERCEL_URL` deployment hosts. Any other Vercel/custom alias must redirect to the canonical origin before login or WebAuthn begins; a request whose browser origin differs fails closed.
- Local development uses `http://localhost:3000`.

`PASSKEY_PROXY_ID` defaults to `web-bff` in both applications. `PASSKEY_ENABLED` stays explicit so valid URLs and credentials cannot accidentally enable passkeys.

## Pre-resolved Azure endpoints

Azure Container Apps environment is infrastructure and must exist before either application build. A shared endpoint contract queries its `properties.defaultDomain` and combines that stable environment domain with configured application names:

```text
BACKEND_URL=https://${BACKEND_APP_NAME}.${AZURE_CONTAINER_APPS_DEFAULT_DOMAIN}
AZURE_UI_URL=https://${UI_APP_NAME}.${AZURE_CONTAINER_APPS_DEFAULT_DOMAIN}
FRONTEND_URLS=${AZURE_UI_URL},https://bmo-deepagent-ui.vercel.app
```

Both repositories implement and test the same small resolver contract locally because they deploy independently; Azure remains value source of truth. Resolver validates nonempty HTTPS-compatible DNS names and a `Succeeded` environment before returning values. It never writes generated endpoints into tracked or private dotenv files.

Resolver always prints an OAuth provider notice containing exact derived, non-secret values:

```text
Google authorized redirect URI: ${BACKEND_URL}/auth/callback/google
GitHub authorization callback URL: ${BACKEND_URL}/auth/callback/github
GitHub homepage / frontend origin: ${AZURE_UI_URL}
```

It atomically stores only environment resource ID, default domain, application names, and derived endpoints in ignored `.resolved-azure-endpoints.json`. First resolution or any metadata change prints `ACTION REQUIRED`; both deployment scripts repeat the provider notice before application mutation and require process-local `OAUTH_REDIRECTS_CONFIRMED=true`. Unchanged endpoint metadata prints a non-blocking informational reminder. Confirmation is never persisted.

UI build receives resolved `BACKEND_URL`; UI Azure runtime receives resolved `AZURE_UI_URL` for `PASSKEY_ORIGIN`, `AUTH_URL`, and `NEXTAUTH_URL`. Backend deployment injects resolved `FRONTEND_URLS` directly as runtime configuration without persisting it in `.env.docker`, then backend derives passkey origins and RP IDs. OAuth callback URLs are configured from resolved backend URL before application deployment.

No placeholder Container App or application deployment is allowed solely to discover a URL. Bootstrap sequence is resource group, Container Apps environment, endpoint resolution. Each application then needs one production build and one deployment. If environment does not exist, resolver fails with an explicit instruction to run infrastructure bootstrap; it does not create infrastructure during a build.

Deleting and recreating the Container Apps environment may change `defaultDomain` and therefore requires resolving endpoints again, updating and verifying external Google/GitHub OAuth redirect URIs and any origin allowlists, rebuilding images with embedded endpoint values, and deploying before enabling traffic. Application revisions within the same environment do not change these canonical URLs.

## Chosen approach

Use one newly generated `PASSKEY-PROXY-SECRET` in existing Azure Key Vault. Backend references the unversioned Key Vault secret URI through its existing user-assigned identity. UI references it through its existing system-assigned identity (`identityref:system`). Each container maps its app-level secret to runtime-only `PASSKEY_PROXY_SECRET`; deployment validates that selected identity already has secret-read access before mutation.

The Vercel URL is reserved in the canonical backend allowlist but is not deployed in this rollout. No Vercel environment or deployment is mutated. Before any future Vercel activation, an operator must copy the current Key Vault value without logging it into Vercel encrypted, server-only `PASSKEY_PROXY_SECRET`, configure canonical origin/proxy ID, deploy, and verify before directing users there. It is never committed, placed in an image, or exposed through `NEXT_PUBLIC_*`. Local development uses a separate local-only secret and is not trusted by production backend origins.

UI runtime also receives:

- `PASSKEY_ENABLED=true`
- exact Container Apps browser origin in `PASSKEY_ORIGIN`
- `PASSKEY_PROXY_ID=web-bff`

Backend runtime derives its RP-ID/origin allowlist from `FRONTEND_URLS` and receives the matching proxy ID and secret. Local `.env.docker` files must not contain either the rotated or compromised secret.

Backend `.env.docker` removes `FRONTEND_URLS`, duplicated `PASSKEY_ORIGINS`, `PASSKEY_RP_ID(S)`, and the proxy secret; deployment supplies resolved/runtime settings. Frontend `.env.docker` does not carry production `PASSKEY_ORIGIN`, proxy ID, or proxy secret; deployment supplies derived/runtime settings.

## Alternatives rejected

- Bake matching secrets into both images: simple but leaks credentials into image layers and requires rebuilds for rotation.
- Put the secret directly in Container App configuration: works but duplicates plaintext outside Key Vault.
- Copy dotenv values between repositories: couples independent checkouts and still permits drift.
- Use a shared parent-directory dotenv file: breaks independent CI and deployment environments.
- Keep three backend URL lists and validate equality: detects drift only after preserving the duplication that causes it.

## Deployment behavior

Deployment scripts configure the Key Vault reference before updating container environment variables. Missing Key Vault access or secret configuration fails before a new application revision is accepted. Secret values must never appear in command output.

Current Azure UI has no deployed proxy credential and returns `passkeys_unavailable`, so there is no functioning old Azure passkey path to preserve during rotation. Resolve Azure endpoints before builds. Build and deploy backend with the new secret and canonical derivation first, then build and deploy Azure UI with matching Key Vault reference. Each real application is built and deployed once. Vercel remains a reserved derived origin/RP ID and receives no mutation in this rollout. OAuth remains enabled for enrollment and recovery.

Backend must be rebuilt after removing the compromised secret from its Docker build context. UI does not embed `.env.docker`; it may reuse a verified image only when its embedded `BACKEND_URL` exactly matches the resolver output for the unchanged environment. Environment recreation always forces an Azure UI rebuild. Both Azure app updates force named revisions so Key Vault values are fetched at startup. In single-revision mode Azure moves traffic only after a revision is ready. The deployment records prior revisions for diagnostics but never rolls traffic back to an image or revision containing the compromised secret; failure leaves passkeys disabled until a new safe revision is deployed.

After both safe revisions are ready, the old credential is considered revoked because neither app nor Key Vault contains it. Old backend revisions receive zero traffic and are deactivated or removed as rollback targets.

Rollback never restores the compromised secret. After backend cutover, only revisions/images configured for the new secret are eligible. Azure remains single-revision. Because Vercel is not deployed or mutated, it has no rollout or rollback step; future activation must use the then-current safe secret and must never revive a deployment containing the compromised credential.

## Verification

- Deployment tests assert both scripts use the Key Vault reference and runtime `secretRef`.
- Local `.env.docker` files and new image filesystems contain no `PASSKEY_PROXY_SECRET` value or compromised secret.
- Both Azure revisions become ready with zero crash loops.
- Live configuration shows both apps use expected Key Vault reference, backend UAI, UI system identity, and runtime `secretRef`, with no plaintext value or log disclosure.
- UI `/api/auth/passkeys` returns the backend's exact unauthenticated rejection (`403 {"code":"passkey_request_rejected"}`), not `503`, `404`, or `500`.
- A request signed with the compromised or a wrong proxy credential is rejected by the backend.
- Backend RP-ID and origin allowlists exactly contain the UI Container Apps host/origin.
- Derived backend origin and RP-ID sets exactly match normalized `FRONTEND_URLS`, including both Azure and Vercel; malformed, duplicate, or conflicting explicit settings fail startup.
- Resolver computes both Azure application URLs from application names and environment `defaultDomain` before any image build or application deployment; tests forbid placeholder-app URL discovery and hardcoded generated Azure domains.
- Resolver and both deployment scripts print exact Google/GitHub provider URLs; first-time or changed endpoints block application mutation until process-local OAuth confirmation is supplied.
- Azure frontend runtime origin equals its actual canonical browser origin without reading the backend's full allowlist.
- Reserved Vercel origin/RP mapping remains derived and tested without requiring a live Vercel deployment. Future production/custom aliases must redirect to `https://bmo-deepagent-ui.vercel.app`; previews cannot use production passkeys.
- An authenticated OAuth session can list passkeys and start a registration ceremony; destructive credential deletion is not used as a deployment smoke test.
- OAuth-authenticated chat menu receives `passkeysEnabled=true` and shows **Manage passkeys**.
- Exact unauthenticated rejection, authenticated list/registration, and old/wrong proxy rejection checks run against Azure. Unit/integration tests cover reserved Vercel origin-to-RP mapping. Existing future Vercel credentials use RP ID `bmo-deepagent-ui.vercel.app`; changing that canonical hostname requires explicit credential migration.
