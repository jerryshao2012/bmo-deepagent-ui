import type { SessionProvider } from "@/features/auth/application/session-provider";
import { browserSessionProvider } from "@/features/auth/infrastructure/browser-session-provider";

type FetchImplementation = typeof fetch;
const refreshes = new Map<string, Promise<boolean>>();
const AUTH_PATHS_WITHOUT_REFRESH = [
  "/auth/login",
  "/auth/callback",
  "/auth/logout",
  "/auth/session/refresh",
];

function requestUrl(input: RequestInfo | URL): URL {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const base =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  return new URL(raw, base);
}

export function createAuthenticatedFetch({
  sessionProvider,
  fetchImplementation,
}: {
  sessionProvider: SessionProvider;
  fetchImplementation: FetchImplementation;
}): FetchImplementation {
  return async (input, init) => {
    const response = await fetchImplementation(input, init);
    if (response.status !== 401) return response;

    const url = requestUrl(input);
    if (AUTH_PATHS_WITHOUT_REFRESH.some((path) => url.pathname.includes(path))) {
      return response;
    }

    let refresh = refreshes.get(url.origin);
    if (!refresh) {
      refresh = sessionProvider.refresh(url.origin).finally(() => {
        refreshes.delete(url.origin);
      });
      refreshes.set(url.origin, refresh);
    }

    if (await refresh) return fetchImplementation(input, init);

    sessionProvider.handleInvalidSession();
    return response;
  };
}

export const authenticatedFetch: FetchImplementation = (input, init) =>
  createAuthenticatedFetch({
    sessionProvider: browserSessionProvider,
    fetchImplementation: globalThis.fetch.bind(globalThis),
  })(input, init);
