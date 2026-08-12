# Passkey Key Vault Runtime Design

## Goal

Enable passkey management on the Azure Container Apps UI without embedding the shared proxy secret in either container image or exposing it through a public environment variable.

## Chosen approach

Use one newly generated `PASSKEY-PROXY-SECRET` in existing Azure Key Vault. Both Container Apps reference the unversioned Key Vault secret URI through their existing user-assigned identity. Each container maps its app-level secret to runtime-only `PASSKEY_PROXY_SECRET`.

UI runtime also receives:

- `PASSKEY_ENABLED=true`
- exact Container Apps browser origin in `PASSKEY_ORIGIN`
- `PASSKEY_PROXY_ID=web-bff`

Backend runtime retains its current RP-ID/origin allowlist and receives the matching proxy ID and secret. Local `.env.docker` files must not contain either the rotated or compromised secret.

## Alternatives rejected

- Bake matching secrets into both images: simple but leaks credentials into image layers and requires rebuilds for rotation.
- Put the secret directly in Container App configuration: works but duplicates plaintext outside Key Vault.

## Deployment behavior

Deployment scripts configure the Key Vault reference before updating container environment variables. Missing Key Vault access or secret configuration fails before a new application revision is accepted. Secret values must never appear in command output.

Current UI has no deployed proxy credential and returns `passkeys_unavailable`, so there is no functioning old passkey path to preserve during rotation. Backend updates first so it accepts the rotated BFF credential before UI starts sending it. UI updates second. This is a planned passkey-only outage while OAuth remains enabled for enrollment and recovery.

Backend must be rebuilt after removing the compromised secret from its Docker build context. UI does not embed `.env.docker`, but may reuse its verified image because all four passkey settings are server-runtime values. Both app updates force named revisions so Key Vault values are fetched at startup. In single-revision mode Azure moves traffic only after a revision is ready. The deployment records prior revisions for diagnostics but never rolls traffic back to an image or revision containing the compromised secret; failure leaves passkeys disabled until a new safe revision is deployed.

After both safe revisions are ready, the old credential is considered revoked because neither app nor Key Vault contains it. Old backend revisions receive zero traffic and are deactivated or removed as rollback targets.

## Verification

- Deployment tests assert both scripts use the Key Vault reference and runtime `secretRef`.
- Local `.env.docker` files and new image filesystems contain no `PASSKEY_PROXY_SECRET` value or compromised secret.
- Both Azure revisions become ready with zero crash loops.
- Live configuration shows both apps use the expected Key Vault reference, user-assigned identity, and runtime `secretRef`, with no plaintext value or log disclosure.
- UI `/api/auth/passkeys` returns the backend's exact unauthenticated rejection (`403 {"code":"passkey_request_rejected"}`), not `503`, `404`, or `500`.
- A request signed with the compromised or a wrong proxy credential is rejected by the backend.
- Backend RP-ID and origin allowlists exactly contain the UI Container Apps host/origin.
- An authenticated OAuth session can list passkeys and start a registration ceremony; destructive credential deletion is not used as a deployment smoke test.
- OAuth-authenticated chat menu receives `passkeysEnabled=true` and shows **Manage passkeys**.
