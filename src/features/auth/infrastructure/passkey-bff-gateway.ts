import type {
  PasskeyAuthenticatedUser,
  PasskeyCeremony,
  PasskeyGateway,
} from "../application/passkey-authentication";

const PASSKEY_FAILURE = "Passkey sign-in failed. Please use Google or GitHub.";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(PASSKEY_FAILURE);
  }
}

export class PasskeyBffGateway implements PasskeyGateway {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch) {
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  async beginAuthentication(): Promise<PasskeyCeremony> {
    const response = await this.fetchImpl(
      "/api/auth/passkeys/authentication/options",
      {
        method: "POST",
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      }
    );
    if (!response.ok) throw new Error(PASSKEY_FAILURE);

    const ceremony = (await readJson(response)) as {
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
      throw new Error(PASSKEY_FAILURE);
    }

    return {
      ceremonyId: ceremony.ceremony_id,
      options: ceremony.options,
    };
  }

  async verifyAuthentication(
    ceremonyId: string,
    credential: unknown
  ): Promise<PasskeyAuthenticatedUser> {
    const response = await this.fetchImpl(
      "/api/auth/passkeys/authentication/verify",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ceremony_id: ceremonyId,
          response: credential,
        }),
        credentials: "same-origin",
        cache: "no-store",
      }
    );
    if (!response.ok) throw new Error(PASSKEY_FAILURE);

    const result = (await readJson(response)) as {
      ok?: unknown;
      user?: unknown;
    };
    if (
      result.ok !== true ||
      !result.user ||
      typeof result.user !== "object" ||
      Array.isArray(result.user)
    ) {
      throw new Error(PASSKEY_FAILURE);
    }

    return result.user as PasskeyAuthenticatedUser;
  }
}
