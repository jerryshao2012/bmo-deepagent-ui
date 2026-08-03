import {
  browserSupportsWebAuthn,
  startAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export interface PasskeyAuthenticatedUser {
  provider: "google" | "github";
  auth_method?: "passkey";
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  [key: string]: unknown;
}

interface AuthenticateWithPasskeyOptions {
  fetchImpl?: typeof fetch;
  startAuthenticationImpl?: typeof startAuthentication;
  navigate?: (url: string) => void;
}

export function supportsPasskeyAuthentication() {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    throw new Error("Passkey sign-in failed. Please use Google or GitHub.");
  }
}

export async function authenticateWithPasskey({
  fetchImpl = fetch,
  startAuthenticationImpl = startAuthentication,
  navigate = (url) => window.location.assign(url),
}: AuthenticateWithPasskeyOptions = {}) {
  const optionsResponse = await fetchImpl(
    "/api/auth/passkeys/authentication/options",
    {
      method: "POST",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    }
  );
  if (!optionsResponse.ok) {
    throw new Error("Passkey sign-in failed. Please use Google or GitHub.");
  }

  const ceremony = (await readJson(optionsResponse)) as {
    ceremony_id?: unknown;
    options?: unknown;
  };
  if (
    typeof ceremony.ceremony_id !== "string" ||
    !ceremony.ceremony_id ||
    !ceremony.options ||
    typeof ceremony.options !== "object" ||
    Array.isArray(ceremony.options)
  ) {
    throw new Error("Passkey sign-in failed. Please use Google or GitHub.");
  }
  const optionsJSON = ceremony.options as PublicKeyCredentialRequestOptionsJSON;
  const credential: AuthenticationResponseJSON = await startAuthenticationImpl({
    optionsJSON,
  });

  const verifyResponse = await fetchImpl(
    "/api/auth/passkeys/authentication/verify",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ceremony_id: ceremony.ceremony_id,
        response: credential,
      }),
      credentials: "same-origin",
      cache: "no-store",
    }
  );
  if (!verifyResponse.ok) {
    throw new Error("Passkey sign-in failed. Please use Google or GitHub.");
  }

  const result = (await readJson(verifyResponse)) as {
    ok?: unknown;
    user?: unknown;
  };
  if (
    result.ok !== true ||
    !result.user ||
    typeof result.user !== "object" ||
    Array.isArray(result.user)
  ) {
    throw new Error("Passkey sign-in failed. Please use Google or GitHub.");
  }

  navigate("/chat");
  return result.user as PasskeyAuthenticatedUser;
}

export function isPasskeyCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    cause?: unknown;
  };
  if (candidate.name === "AbortError" || candidate.name === "NotAllowedError") {
    return true;
  }
  if (candidate.code === "ERROR_CEREMONY_ABORTED") return true;
  return (
    candidate.cause !== undefined && isPasskeyCancellation(candidate.cause)
  );
}
