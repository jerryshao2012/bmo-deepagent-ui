export interface ApiTransport {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  response(path: string, init?: RequestInit): Promise<Response>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export function createApiTransport({
  baseUrl,
  sessionProvider,
  fetchImplementation,
}: {
  baseUrl: string;
  sessionProvider: SessionProvider;
  fetchImplementation: typeof fetch;
}): ApiTransport {
  const fetchScoped = createAuthenticatedFetch({
    sessionProvider,
    fetchImplementation,
  });
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  const response = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const token = sessionProvider.getToken();
    if (token && !headers.has("X-API-Key")) headers.set("X-API-Key", token);

    const result = await fetchScoped(`${normalizedBaseUrl}/${path.replace(/^\/+/, "")}`, {
      ...init,
      headers,
    });
    if (!result.ok) throw new ApiError(result.status, await result.text());
    return result;
  };

  return {
    response,
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      const result = await response(path, init);
      if (result.status === 204) return undefined as T;
      return (await result.json()) as T;
    },
  };
}
import type { SessionProvider } from "@/features/auth/application/session-provider";
import { createAuthenticatedFetch } from "@/platform/http/authenticated-fetch";
