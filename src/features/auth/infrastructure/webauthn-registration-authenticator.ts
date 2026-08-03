import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";

import type { PasskeyRegistrationAuthenticator } from "../application/passkey-management";

export type StartRegistrationImplementation = (options: {
  optionsJSON: PublicKeyCredentialCreationOptionsJSON;
}) => Promise<RegistrationResponseJSON>;

export class WebAuthnRegistrationAuthenticator
  implements PasskeyRegistrationAuthenticator
{
  constructor(
    private readonly start: StartRegistrationImplementation = startRegistration
  ) {}

  register(options: unknown): Promise<RegistrationResponseJSON> {
    return this.start({
      optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
    });
  }
}
