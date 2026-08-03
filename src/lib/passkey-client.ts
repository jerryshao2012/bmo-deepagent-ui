import {
  isPasskeyCancellation,
  runPasskeyAuthentication,
  type PasskeyAuthenticatedUser,
} from "../features/auth/application/passkey-authentication";
import { PasskeyBffGateway } from "../features/auth/infrastructure/passkey-bff-gateway";
import {
  WebAuthnPasskeyAuthenticator,
  type StartAuthenticationImplementation,
} from "../features/auth/infrastructure/webauthn-authenticator";

interface AuthenticateWithPasskeyOptions {
  fetchImpl?: typeof fetch;
  startAuthenticationImpl?: StartAuthenticationImplementation;
  navigate?: (url: string) => void;
}

export type { PasskeyAuthenticatedUser };
export { isPasskeyCancellation };

export function supportsPasskeyAuthentication(): boolean {
  return new WebAuthnPasskeyAuthenticator().isSupported();
}

export async function authenticateWithPasskey({
  fetchImpl = globalThis.fetch,
  startAuthenticationImpl,
  navigate = (url) => window.location.assign(url),
}: AuthenticateWithPasskeyOptions = {}): Promise<PasskeyAuthenticatedUser> {
  return runPasskeyAuthentication({
    gateway: new PasskeyBffGateway(fetchImpl),
    authenticator: new WebAuthnPasskeyAuthenticator(startAuthenticationImpl),
    onAuthenticated: () => navigate("/chat"),
  });
}
