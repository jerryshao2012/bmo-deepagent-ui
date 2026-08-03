# Passkey Authentication Documentation Design

## Goal

Document implemented passkey architecture with readable Mermaid sequence diagrams
that connect browser behavior, Next.js BFF routes, FastAPI verification, durable
auth storage, OAuth recovery, and WebAuthn authenticators.

## Documentation structure

Create `docs/passkey-authentication.md` in UI repository as cross-stack source of
truth. Link it from UI README passkey setup and backend README passkey deployment
section. Keep existing OAuth diagrams unchanged.

Guide contains three focused `sequenceDiagram` blocks:

1. Enrollment and recovery: a recent authenticated session, initial OAuth
   enrollment, later enrollment after a fresh OAuth or passkey session,
   registration options, resident credential creation, atomic challenge claim,
   exact origin/RP verification, public credential persistence, and generated
   label when label is omitted.
2. Identifier-free sign-in: anonymous options without `allowCredentials`,
   authenticator discovery, credential-ID lookup, user-handle/signature/counter
   validation, durable hashed session creation, BFF token stripping, and existing
   `session_token` cookie issuance.
3. Management and recovery: list, rename, revoke, `reauth_required`, allowlisted
   OAuth return path, dialog reopen, and manual operation retry.

Supporting text documents feature detection and OAuth fallback, five-minute
single-use challenges, ten-minute recent-auth policy, 24-hour sessions, default
rate limits, multi-domain RP mapping, per-RP enrollment, ten-passkey account
limit, and SQLite/Azure single-replica persistence constraints.

## Accuracy and security boundaries

- Browser talks only to same-origin `/api/auth/passkeys/*` routes. Registration,
  rename, and revoke BFF routes also require exact incoming request Origin;
  authentication and list routes do not universally apply that browser-header
  check.
- Every Next.js BFF request adds proxy credentials and configured origin;
  protected operations also forward current bearer session.
- Backend returns raw authentication session token only to trusted BFF. Browser
  response contains `{ok, user}` and BFF sets current JavaScript-readable cookie.
- Backend stores credential public material and metadata, never private keys or
  biometric data. Session tokens are persisted only as SHA-256 hashes.
- Authentication uses returned credential ID to resolve account and requires
  returned `userHandle` to match account's immutable opaque WebAuthn handle.
- Each ceremony is bound to exact origin, selected RP ID, proxy ID, kind, and
  expiry; verification claims challenge once before session or cryptographic
  validation. Registration requires a discoverable credential, user
  verification, and verified `attestation: none`; authentication also requires
  user verification.
- Unrelated frontend domains use separate RP IDs and require separate passkey
  enrollment even when backed by same account.
- Missing management cookies are rejected by BFF with 401; backend requests
  without bearer session also return 401. A present expired or unknown token
  currently receives generic `400 invalid_passkey_response`. Valid but
  older-than-policy sessions return `403 reauth_required` with stored provider.
  OAuth return only reopens management; sensitive operation is never replayed.
- Google and GitHub accounts are never auto-linked by email. Raw OAuth tokens,
  authenticator private keys, and biometric data are not persisted. Session
  refresh does not advance `authenticated_at`.
- Default limits are 20 authenticated operations per minute per account and 300
  anonymous ceremony calls per minute per proxy. Final-passkey deletion remains
  allowed because OAuth recovery is mandatory.
- SQLite container deployments require durable Azure storage and one replica;
  PostgreSQL or Cosmos DB is required for multi-replica production.

## Validation

Check every Mermaid fence is balanced, participant aliases are consistent,
document links resolve from each README, and documented endpoint/config names
match current source. Review final diff only; no application code changes.
