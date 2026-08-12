# Passkey Key Vault Runtime Design

## Goal

Enable passkey management on the Azure Container Apps UI without embedding the shared proxy secret in either container image or exposing it through a public environment variable.

## Chosen approach

Use one newly generated `PASSKEY-PROXY-SECRET` in existing Azure Key Vault. Both Container Apps reference that Key Vault secret through their existing user-assigned identity. Each container maps its app-level secret to runtime-only `PASSKEY_PROXY_SECRET`.

UI runtime also receives:

- `PASSKEY_ENABLED=true`
- exact Container Apps browser origin in `PASSKEY_ORIGIN`
- `PASSKEY_PROXY_ID=web-bff`

Backend runtime retains its current RP-ID/origin allowlist and receives the matching proxy ID and secret. Local `.env.docker` files must not contain the rotated secret.

## Alternatives rejected

- Bake matching secrets into both images: simple but leaks credentials into image layers and requires rebuilds for rotation.
- Put the secret directly in Container App configuration: works but duplicates plaintext outside Key Vault.

## Deployment behavior

Deployment scripts configure the Key Vault reference before updating container environment variables. Missing Key Vault access or secret configuration fails before a new application revision is accepted. Secret values must never appear in command output.

Backend updates first so it accepts the rotated BFF credential before UI starts sending it. UI updates second. OAuth remains enabled for enrollment and recovery.

## Verification

- Deployment tests assert both scripts use the Key Vault reference and runtime `secretRef`.
- Local `.env.docker` files contain no `PASSKEY_PROXY_SECRET` value.
- Both Azure revisions become ready with zero crash loops.
- UI `/api/auth/passkeys` no longer returns `passkeys_unavailable`; unauthenticated requests should reach backend authentication handling.
- OAuth-authenticated chat menu receives `passkeysEnabled=true` and shows **Manage passkeys**.
