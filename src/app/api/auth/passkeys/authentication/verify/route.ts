import { forwardPasskeyRequest } from "@/lib/server/passkey-bff";

export async function POST(request: Request) {
  return forwardPasskeyRequest(
    request,
    "/auth/passkeys/authentication/verify",
    { jsonBody: "authentication", issueSession: true }
  );
}
