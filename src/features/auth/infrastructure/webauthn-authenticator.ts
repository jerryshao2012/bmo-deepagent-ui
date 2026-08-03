import {
  browserSupportsWebAuthn,
  startAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import type { PasskeyAuthenticator } from "../application/passkey-authentication";

export type StartAuthenticationImplementation = (options: {
  optionsJSON: PublicKeyCredentialRequestOptionsJSON;
}) => Promise<AuthenticationResponseJSON>;

export class WebAuthnPasskeyAuthenticator implements PasskeyAuthenticator {
  constructor(
    private readonly start: StartAuthenticationImplementation =
      startAuthentication
  ) {}

  isSupported(): boolean {
    try {
      return browserSupportsWebAuthn();
    } catch {
      return false;
    }
  }

  authenticate(options: unknown): Promise<AuthenticationResponseJSON> {
    return this.start({
      optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
    });
  }
}
