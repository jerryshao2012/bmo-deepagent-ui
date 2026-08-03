import {
  forwardPasskeyRequest,
  isPasskeyCredentialId,
} from "@/lib/server/passkey-bff";

interface RouteContext {
  params: Promise<{ credentialId: string }>;
}

async function credentialPath(context: RouteContext) {
  const { credentialId } = await context.params;
  if (!isPasskeyCredentialId(credentialId)) return null;
  return `/auth/passkeys/${encodeURIComponent(credentialId)}`;
}

function invalidCredentialId() {
  return Response.json(
    { code: "invalid_credential_id" },
    { status: 400, headers: { "cache-control": "no-store" } }
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const path = await credentialPath(context);
  if (!path) return invalidCredentialId();
  return forwardPasskeyRequest(request, path, {
    requiresSession: true,
    requiresOrigin: true,
    jsonBody: "label",
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const path = await credentialPath(context);
  if (!path) return invalidCredentialId();
  return forwardPasskeyRequest(request, path, {
    requiresSession: true,
    requiresOrigin: true,
  });
}
