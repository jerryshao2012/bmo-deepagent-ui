# Passkey Enrollment Visibility and Recovery Design

## Problem

The login page currently treats valid passkey runtime configuration as proof that a user has an enrolled passkey. It therefore shows **Sign in with a passkey** before enrollment. The management dialog also converts most backend failures into one generic message, so an expired recent-auth window cannot guide the user back through Google or GitHub.

Live checks on 2026-08-12 established that the deployed BFF, Key Vault reference, proxy credential, origin, RP ID, and backend authentication-options route are healthy. The remaining fault is management/session behavior and UI state, not Azure permission or secret wiring.

## Goals

- Hide passkey sign-in until this browser has observed a successful passkey enrollment or a non-empty authenticated passkey list.
- Let an authenticated user open management and see an empty list without requiring a recent OAuth ceremony.
- Keep enrollment, rename, and deletion protected by the backend recent-auth window.
- Turn stale or invalid management sessions into an explicit Google/GitHub reauthentication action.
- Preserve OAuth as recovery and avoid any Azure permission, identity, or Key Vault mutation.

## Non-goals

- Account discovery on the unauthenticated login page.
- A public endpoint exposing whether any account has passkeys.
- Vercel deployment or configuration changes.
- Automatic Azure role, access-policy, identity, or secret changes.

## Design

### Browser enrollment state

Add a small client-only storage adapter with a versioned, non-secret marker. The marker means only: “this browser previously observed at least one passkey for the signed-in account.” It contains no identity, credential ID, label, or authentication material.

The management dialog updates the marker as follows:

- successful non-empty list: set marker;
- successful enrollment: set marker;
- successful empty list, deletion, request failure, parsing failure, or network
  failure: leave marker unchanged.

The marker is intentionally positive and sticky because it is browser-scoped,
not account-scoped. An empty list for a second account on a shared browser must
not hide the first account's passkey login option. Clearing site data is the
explicit local reset. A stale marker can expose a harmless login option after
all credentials are revoked, but it cannot authenticate without a valid
credential and OAuth recovery remains visible.

`LoginProviders` shows passkey sign-in only when all three conditions hold: runtime passkeys are configured, WebAuthn is supported, and the marker exists. A new browser therefore uses Google/GitHub once before passkey sign-in becomes available. This is intentionally privacy-preserving and avoids an unauthenticated account-enumeration lookup.

### Backend management session policy

`PasskeyService.list_credentials` validates that the session is live but does not require authentication within the recent-auth window. Registration, rename, deletion, and registration verification retain the existing recent-auth check.

Missing or expired sessions raise the passkey-specific session exception and
map to exact `401 invalid_session` responses on list and protected mutation
routes. A live session outside the recent-auth window maps to exact
`403 reauth_required` with its provider. Invalid credential and WebAuthn input
remain generic `400 invalid_passkey_response` responses.

This lets management load an empty or existing list while ensuring every state-changing operation still requires recent OAuth authentication.

### Recoverable UI errors

The management dialog maps safe backend status/code pairs:

- `403 reauth_required`: show reauthentication using backend-provided provider, falling back to the already authenticated dialog provider;
- `401 invalid_session` or `401 authentication_required`: show reauthentication using the authenticated dialog provider;
- `429 rate_limited`: ask the user to wait one minute and retry;
- `502 authentication_service_unavailable` or `503 passkeys_unavailable`: report temporary passkey-service unavailability;
- other failures or malformed success payloads: retain a generic retry/OAuth recovery message.

Reauthentication continues through the existing backend OAuth URL with the exact allowlisted return path `/chat?manage=passkeys`. Errors never reveal proxy credentials, session tokens, credential IDs, or backend response internals.

## Data flow

1. User signs in with Google or GitHub and opens **Manage passkeys**.
2. UI lists passkeys through the same-origin BFF using the session cookie.
3. Empty list loads normally because backend listing requires a live, not recent, session.
4. Enrollment request enforces recent auth. If stale, UI offers provider reauthentication and returns to the manager.
5. Successful WebAuthn verification stores credential server-side and writes the local non-secret marker.
6. Future login pages on that browser show passkey sign-in.

## Testing

Backend tests prove listing accepts a live stale session while registration, rename, and deletion still require recent authentication.

UI component tests prove marker-gated login visibility, marker updates only
after authoritative positive responses, empty-list/deletion/account-switch
behavior cannot clear the marker, provider fallback for stale/invalid sessions,
specific rate-limit/service messages, and unchanged generic handling for
malformed or unexpected failures.

Backend route tests prove missing or expired sessions return
`401 invalid_session`, valid-but-stale mutations return
`403 reauth_required`, and invalid passkey inputs remain generic `400` errors.

Existing BFF validation, proxy-secret non-disclosure, WebAuthn ceremony, OAuth fallback, passkey management, and deployment tests remain green.

## Rollout and verification

1. Merge and rebuild backend, then deploy its existing update-only Container App workflow.
2. Rebuild UI with Docker and deploy its existing manifest-driven Container App workflow.
3. Verify unauthenticated login hides passkey sign-in before enrollment.
4. Sign in with OAuth, open management, and verify an empty list loads without a generic failure.
5. Enroll a passkey, sign out, and verify passkey sign-in appears and completes successfully.
6. Verify Google/GitHub remain available and no Azure permission or identity configuration changed.

Rollback uses prior backend and UI revisions together. The storage marker is safe to leave in place; a rolled-back UI ignores the new gating semantics.
