import { forwardPasskeyRequest } from "@/lib/server/passkey-bff";

export async function POST(request: Request) {
  return forwardPasskeyRequest(request, "/auth/passkeys/registration/verify", {
    requiresSession: true,
    requiresOrigin: true,
    jsonBody: "registration",
  });
}
