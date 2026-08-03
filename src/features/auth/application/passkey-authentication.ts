export interface PasskeyAuthenticatedUser {
  provider: "google" | "github";
  auth_method?: "passkey";
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  [key: string]: unknown;
}

export interface PasskeyCeremony {
  ceremonyId: string;
  options: unknown;
}

export interface PasskeyGateway {
  beginAuthentication(): Promise<PasskeyCeremony>;
  verifyAuthentication(
    ceremonyId: string,
    credential: unknown
  ): Promise<PasskeyAuthenticatedUser>;
}

export interface PasskeyAuthenticator {
  isSupported(): boolean;
  authenticate(options: unknown): Promise<unknown>;
}

interface AuthenticateWithPasskeyDependencies {
  gateway: PasskeyGateway;
  authenticator: PasskeyAuthenticator;
  onAuthenticated: (user: PasskeyAuthenticatedUser) => void;
}

export async function runPasskeyAuthentication({
  gateway,
  authenticator,
  onAuthenticated,
}: AuthenticateWithPasskeyDependencies): Promise<PasskeyAuthenticatedUser> {
  const ceremony = await gateway.beginAuthentication();
  const credential = await authenticator.authenticate(ceremony.options);
  const user = await gateway.verifyAuthentication(
    ceremony.ceremonyId,
    credential
  );

  onAuthenticated(user);
  return user;
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
