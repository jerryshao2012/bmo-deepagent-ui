import { forwardPasskeyRequest } from "@/lib/server/passkey-bff";

export async function POST(request: Request) {
  return forwardPasskeyRequest(request, "/auth/passkeys/registration/options", {
    requiresSession: true,
    requiresOrigin: true,
  });
}
