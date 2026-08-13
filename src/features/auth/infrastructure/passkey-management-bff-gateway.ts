import type { LoginProvider } from "@/lib/remembered-login";

import {
  ManagementRequestError,
  type ManagedPasskey,
  type PasskeyManagementGateway,
  type RegistrationCeremony,
} from "../application/passkey-management";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProvider(value: unknown): value is LoginProvider {
  return value === "google" || value === "github";
}

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

function parsePasskey(value: unknown): ManagedPasskey | null {
  if (!isRecord(value)) return null;
  const rawLabel = typeof value.label === "string" ? value.label : "";
  const label = rawLabel.trim();
  if (
    typeof value.credential_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,2048}$/.test(value.credential_id) ||
    !isWellFormedUnicode(rawLabel) ||
    !label ||
    Array.from(label).length > 100 ||
    !Array.isArray(value.transports) ||
    !value.transports.every((item) => typeof item === "string") ||
    typeof value.device_type !== "string" ||
    typeof value.backed_up !== "boolean" ||
    typeof value.created_at !== "number" ||
    (value.last_used_at !== null && typeof value.last_used_at !== "number")
  ) {
    return null;
  }
  return {
    credential_id: value.credential_id,
    label,
    transports: value.transports,
    device_type: value.device_type,
    backed_up: value.backed_up,
    created_at: value.created_at,
    last_used_at: value.last_used_at,
  };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class PasskeyManagementBffGateway implements PasskeyManagementGateway {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch) {
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  private async request(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      ...init,
    });
    const result = await responseJson(response);
    if (!response.ok) {
      const code =
        isRecord(result) && typeof result.code === "string"
          ? result.code
          : null;
      const provider =
        isRecord(result) && isProvider(result.provider)
          ? result.provider
          : null;
      throw new ManagementRequestError(response.status, code, provider);
    }
    return result;
  }

  async listPasskeys(): Promise<ManagedPasskey[]> {
    const payload = await this.request("/api/auth/passkeys");
    if (!isRecord(payload) || !Array.isArray(payload.passkeys)) {
      throw new Error("Invalid passkey list");
    }
    const parsed = payload.passkeys.map(parsePasskey);
    if (parsed.some((item) => item === null)) {
      throw new Error("Invalid passkey list");
    }
    return parsed as ManagedPasskey[];
  }

  async beginRegistration(): Promise<RegistrationCeremony> {
    const ceremony = await this.request(
      "/api/auth/passkeys/registration/options",
      { method: "POST" }
    );
    if (
      !isRecord(ceremony) ||
      typeof ceremony.ceremony_id !== "string" ||
      !ceremony.ceremony_id ||
      !isRecord(ceremony.options)
    ) {
      throw new Error("Invalid registration options");
    }
    return { ceremonyId: ceremony.ceremony_id, options: ceremony.options };
  }

  async verifyRegistration(
    ceremonyId: string,
    response: unknown,
    label: string
  ): Promise<ManagedPasskey> {
    const payload = await this.request(
      "/api/auth/passkeys/registration/verify",
      {
        method: "POST",
        body: JSON.stringify({
          ceremony_id: ceremonyId,
          response,
          ...(label ? { label } : {}),
        }),
      }
    );
    const enrolled = isRecord(payload) ? parsePasskey(payload.passkey) : null;
    if (!enrolled) throw new Error("Invalid registration response");
    return enrolled;
  }

  async renamePasskey(
    credentialId: string,
    label: string
  ): Promise<ManagedPasskey> {
    const payload = await this.request(
      `/api/auth/passkeys/${encodeURIComponent(credentialId)}`,
      { method: "PATCH", body: JSON.stringify({ label }) }
    );
    const renamed = isRecord(payload) ? parsePasskey(payload.passkey) : null;
    if (!renamed || renamed.credential_id !== credentialId) {
      throw new Error("Invalid rename response");
    }
    return renamed;
  }

  async revokePasskey(credentialId: string): Promise<void> {
    const payload = await this.request(
      `/api/auth/passkeys/${encodeURIComponent(credentialId)}`,
      { method: "DELETE" }
    );
    if (!isRecord(payload) || payload.ok !== true) {
      throw new Error("Invalid revoke response");
    }
  }
}
