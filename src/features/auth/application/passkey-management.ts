export type AuthenticationProvider = "google" | "github";

export interface ManagedPasskey {
  credential_id: string;
  label: string;
  transports: string[];
  device_type: string;
  backed_up: boolean;
  created_at: number;
  last_used_at: number | null;
}

export interface RegistrationCeremony {
  ceremonyId: string;
  options: unknown;
}

export interface PasskeyManagementGateway {
  listPasskeys(): Promise<ManagedPasskey[]>;
  beginRegistration(): Promise<RegistrationCeremony>;
  verifyRegistration(
    ceremonyId: string,
    response: unknown,
    label: string
  ): Promise<ManagedPasskey>;
  renamePasskey(credentialId: string, label: string): Promise<ManagedPasskey>;
  revokePasskey(credentialId: string): Promise<void>;
}

export interface PasskeyRegistrationAuthenticator {
  register(options: unknown): Promise<unknown>;
}

export class ManagementRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    public readonly provider: AuthenticationProvider | null
  ) {
    super("Passkey management request failed");
  }
}

export const LABEL_TOO_LONG =
  "Passkey labels must be 100 characters or fewer.";
export const LABEL_REQUIRED = "Enter a passkey label.";
export const LABEL_INVALID = "Passkey labels contain invalid characters.";

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function validatePasskeyLabel(
  rawLabel: string,
  required: boolean
): string | null {
  const label = rawLabel.trim();
  if (!isWellFormedUnicode(rawLabel)) return LABEL_INVALID;
  if (required && !label) return LABEL_REQUIRED;
  if (Array.from(label).length > 100) return LABEL_TOO_LONG;
  return null;
}

export async function loadManagedPasskeys(
  gateway: PasskeyManagementGateway
): Promise<ManagedPasskey[]> {
  return gateway.listPasskeys();
}

export async function enrollManagedPasskey(
  gateway: PasskeyManagementGateway,
  authenticator: PasskeyRegistrationAuthenticator,
  label: string
): Promise<ManagedPasskey> {
  const ceremony = await gateway.beginRegistration();
  const response = await authenticator.register(ceremony.options);
  return gateway.verifyRegistration(ceremony.ceremonyId, response, label);
}

export function renameManagedPasskey(
  gateway: PasskeyManagementGateway,
  credentialId: string,
  label: string
): Promise<ManagedPasskey> {
  return gateway.renamePasskey(credentialId, label);
}

export function revokeManagedPasskey(
  gateway: PasskeyManagementGateway,
  credentialId: string
): Promise<void> {
  return gateway.revokePasskey(credentialId);
}
