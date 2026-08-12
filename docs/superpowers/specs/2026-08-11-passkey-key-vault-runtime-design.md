# Passkey Key Vault Runtime Design

## Goal

Enable passkey management on the Azure Container Apps UI without embedding the shared proxy secret in either container image or exposing it through a public environment variable.

Make frontend origins single-source so adding or changing a supported frontend never requires editing duplicate OAuth, WebAuthn origin, and relying-party lists.

## Canonical frontend configuration

Backend `FRONTEND_URLS` is the only multi-origin source. It continues to include both supported production frontends:

- Azure Container Apps UI
- `https://bmo-deepagent-ui.vercel.app`

`PASSKEY_DERIVE_FROM_FRONTEND_URLS=true` selects canonical mode. It defaults to `false` for backward compatibility with existing non-UI deployments. In canonical mode, backend derives validated `PASSKEY_ORIGINS` from normalized `FRONTEND_URLS` and derives unique `PASSKEY_RP_IDS` from their hostnames. Explicit `PASSKEY_ORIGINS`, `PASSKEY_RP_IDS`, or `PASSKEY_RP_ID` is rejected instead of silently overriding derived values. Explicit mode retains the existing origin/RP settings and validation only when the derivation flag is false.

Canonical mode accepts only comma-separated exact origins: HTTPS except loopback development, no credentials, path other than `/`, query, fragment, wildcard, or trailing slash after normalization. Duplicate normalized origins are rejected. Every derived hostname is validated by the existing RP-ID rules. Each exact request origin binds to its own hostname RP ID; no independent origin/RP Cartesian product is created.

Each frontend derives its singular `PASSKEY_ORIGIN` from its own deployment platform rather than copying the backend list:

- Azure deployment uses the Container App's HTTPS FQDN.
- Vercel requires explicit server-only `PASSKEY_ORIGIN=https://bmo-deepagent-ui.vercel.app`. It never uses ephemeral `VERCEL_URL` deployment hosts. Any other Vercel/custom alias must redirect to the canonical origin before login or WebAuthn begins; a request whose browser origin differs fails closed.
- Local development uses `http://localhost:3000`.

`PASSKEY_PROXY_ID` defaults to `web-bff` in both applications. `PASSKEY_ENABLED` stays explicit so valid URLs and credentials cannot accidentally enable passkeys.

## Chosen approach

Use one newly generated `PASSKEY-PROXY-SECRET` in existing Azure Key Vault. Both Container Apps reference the unversioned Key Vault secret URI through their existing user-assigned identity. Each container maps its app-level secret to runtime-only `PASSKEY_PROXY_SECRET`.

Vercel cannot consume an Azure Container App secret reference. During controlled deployment, an operator reads the Key Vault value without logging it and writes the same value to Vercel encrypted, server-only `PASSKEY_PROXY_SECRET`. It is never committed, placed in an image, or exposed through `NEXT_PUBLIC_*`. Local development uses a separate local-only secret and is not trusted by production backend origins.

UI runtime also receives:

- `PASSKEY_ENABLED=true`
- exact Container Apps browser origin in `PASSKEY_ORIGIN`
- `PASSKEY_PROXY_ID=web-bff`

Backend runtime derives its RP-ID/origin allowlist from `FRONTEND_URLS` and receives the matching proxy ID and secret. Local `.env.docker` files must not contain either the rotated or compromised secret.

Backend `.env.docker` retains `FRONTEND_URLS` and removes duplicated `PASSKEY_ORIGINS` and `PASSKEY_RP_ID(S)`. Frontend `.env.docker` does not carry production `PASSKEY_ORIGIN`, proxy ID, or proxy secret; deployment supplies derived/runtime settings.

## Alternatives rejected

- Bake matching secrets into both images: simple but leaks credentials into image layers and requires rebuilds for rotation.
- Put the secret directly in Container App configuration: works but duplicates plaintext outside Key Vault.
- Copy dotenv values between repositories: couples independent checkouts and still permits drift.
- Use a shared parent-directory dotenv file: breaks independent CI and deployment environments.
- Keep three backend URL lists and validate equality: detects drift only after preserving the duplication that causes it.

## Deployment behavior

Deployment scripts configure the Key Vault reference before updating container environment variables. Missing Key Vault access or secret configuration fails before a new application revision is accepted. Secret values must never appear in command output.

Current Azure UI has no deployed proxy credential and returns `passkeys_unavailable`, so there is no functioning old Azure passkey path to preserve during rotation. To protect Vercel, configure its canonical origin, proxy ID, and new encrypted proxy secret first while backend still accepts the old credential. Deploy backend with the new secret and canonical derivation second, then deploy Azure UI with matching Key Vault reference third. This creates only a bounded passkey-only cutover window; OAuth remains enabled for enrollment and recovery.

Backend must be rebuilt after removing the compromised secret from its Docker build context. UI does not embed `.env.docker`, but may reuse its verified image because all four passkey settings are server-runtime values. Both app updates force named revisions so Key Vault values are fetched at startup. In single-revision mode Azure moves traffic only after a revision is ready. The deployment records prior revisions for diagnostics but never rolls traffic back to an image or revision containing the compromised secret; failure leaves passkeys disabled until a new safe revision is deployed.

After both safe revisions are ready, the old credential is considered revoked because neither app nor Key Vault contains it. Old backend revisions receive zero traffic and are deactivated or removed as rollback targets.

Rollback never restores the compromised secret. Before backend cutover, Vercel may roll back application code while retaining new encrypted settings. After backend cutover, only revisions/images configured for the new secret are eligible. Azure remains single-revision. Vercel production aliases switch only after the new deployment is ready; failure returns the alias to a safe deployment that uses the new secret.

## Verification

- Deployment tests assert both scripts use the Key Vault reference and runtime `secretRef`.
- Local `.env.docker` files and new image filesystems contain no `PASSKEY_PROXY_SECRET` value or compromised secret.
- Both Azure revisions become ready with zero crash loops.
- Live configuration shows both apps use the expected Key Vault reference, user-assigned identity, and runtime `secretRef`, with no plaintext value or log disclosure.
- UI `/api/auth/passkeys` returns the backend's exact unauthenticated rejection (`403 {"code":"passkey_request_rejected"}`), not `503`, `404`, or `500`.
- A request signed with the compromised or a wrong proxy credential is rejected by the backend.
- Backend RP-ID and origin allowlists exactly contain the UI Container Apps host/origin.
- Derived backend origin and RP-ID sets exactly match normalized `FRONTEND_URLS`, including both Azure and Vercel; malformed, duplicate, or conflicting explicit settings fail startup.
- Azure and Vercel frontend runtime origins each equal their actual canonical browser origin without reading the backend's full allowlist.
- Vercel production and custom aliases redirect to `https://bmo-deepagent-ui.vercel.app` before authentication; ephemeral preview hosts cannot start production passkey ceremonies.
- An authenticated OAuth session can list passkeys and start a registration ceremony; destructive credential deletion is not used as a deployment smoke test.
- OAuth-authenticated chat menu receives `passkeysEnabled=true` and shows **Manage passkeys**.
- Exact unauthenticated rejection, authenticated list/registration, and old/wrong proxy rejection checks run from both Azure and canonical Vercel origins. Existing Vercel credentials retain the same RP ID `bmo-deepagent-ui.vercel.app`; changing that canonical hostname requires an explicit credential migration rather than silent derivation.
