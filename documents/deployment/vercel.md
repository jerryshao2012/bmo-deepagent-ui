# Deploy to Vercel

Deploy Next.js UI from Git repository and connect it to public backend deployment.
The Vercel Hobby plan is intended for personal, non-commercial projects and has usage
limits. Review [current plan details](https://vercel.com/docs/plans/hobby) before
choosing it for this application.

## Prerequisites

- Repository hosted by Git provider supported by Vercel.
- Vercel account with plan suitable for project use.
- Public HTTPS URL for Deep Agents or LangGraph backend.
- Backend API key and Auth.js secret stored outside repository.

## 1. Import repository

1. Push intended deployment branch to Git provider.
2. Open [Vercel dashboard](https://vercel.com/dashboard).
3. Select **Add New**, then **Project**.
4. Import `bmo-deepagent-ui` repository.

## 2. Configure project

Vercel should detect Next.js automatically. Keep repository root as project root and
use package-manager settings from repository.

Add variables in project settings. Apply secrets only to environments that need
them and redeploy after changing build-time `NEXT_PUBLIC_*` values. See
[Vercel environment-variable guide](https://vercel.com/docs/environment-variables).

| Variable                    | Example                     | Purpose                                   |
| --------------------------- | --------------------------- | ----------------------------------------- |
| `NEXT_PUBLIC_LANGGRAPH_URL` | `https://agent.example.com` | Browser-visible backend URL.              |
| `NEXT_PUBLIC_ASSISTANT_ID`  | `research`                  | Default assistant ID.                     |
| `BACKEND_API_URL`           | `https://agent.example.com` | Server-side backend URL.                  |
| `UPLOAD_API_KEY`            | Managed secret              | Backend authentication key.               |
| `AUTH_SECRET`               | Managed random secret       | Auth.js signing/encryption secret.        |
| `AUTH_TRUST_HOST`           | `true`                      | Trust Vercel-provided host for Auth.js.   |
| `AUTH_URL`                  | `https://ui.example.com`    | Canonical production UI URL.              |
| `NEXTAUTH_URL`              | `https://ui.example.com`    | Compatibility alias for canonical UI URL. |

Never put server-side secrets in `NEXT_PUBLIC_*` variables.

### Optional passkey variables

Add these only when backend is configured with matching passkey proxy credentials:

```env
PASSKEY_ENABLED=true
PASSKEY_ORIGIN=https://ui.example.com
PASSKEY_PROXY_ID=web-bff
PASSKEY_PROXY_SECRET=<managed-secret>
```

Use exact production origin without trailing slash. Preview deployments use different
origins and need explicit backend relying-party/origin configuration before passkeys
will work there.

## 3. Deploy

Select **Deploy** and wait for build to finish. Verify production URL loads and UI
can reach backend. Subsequent pushes to connected branch create new deployments;
production promotion behavior depends on project settings.

## 4. Update authentication redirects

After production domain is known:

1. Set UI `AUTH_URL` and `NEXTAUTH_URL` to final HTTPS URL.
2. Set backend `FRONTEND_URL` to same UI origin.
3. Update Google and GitHub OAuth allowlists/callback settings as described in
   [backend OAuth guide](https://github.com/jerryshao2012/deep-research/blob/main/README.md#-oauth-authentication).
4. If passkeys are enabled, add final UI origin/RP ID to backend passkey config and
   ensure `PASSKEY_ORIGIN` matches it exactly.
5. Redeploy affected services and test sign-in, callback, sign-out, and recovery.

## 5. Verify deployment

- Production page loads over HTTPS.
- Settings show intended backend URL and assistant ID.
- Chat can start and stream run.
- Protected upload and file-view routes authenticate successfully.
- OAuth returns to production UI.
- Passkey enrollment and sign-in work only on configured origins.
- Vercel usage remains within selected plan limits.

## Operational notes

- Git integration provides automatic builds and preview deployments.
- Vercel manages HTTPS for assigned domains.
- Hobby projects pause or restrict features after included usage is exhausted; plan
  limits and eligibility can change, so consult current official documentation.
- This deployment does not host backend agent; backend remains separately operated.
