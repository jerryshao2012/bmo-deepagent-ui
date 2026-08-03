import { forwardPasskeyRequest } from "@/lib/server/passkey-bff";

export async function GET(request: Request) {
  return forwardPasskeyRequest(request, "/auth/passkeys", {
    requiresSession: true,
  });
}
