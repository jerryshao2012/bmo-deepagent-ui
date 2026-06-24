export function getBrowserSessionToken(): string {
  if (typeof document === "undefined") {
    return "";
  }

  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith("session_token="));

  return cookie ? decodeURIComponent(cookie.split("=")[1] ?? "") : "";
}

/**
 * Clear the stale session_token cookie and redirect to the login page.
 */
export function handleAuthRedirect(): void {
  if (typeof window === "undefined") return;

  document.cookie = "session_token=; path=/; max-age=0";

  if (window.location.pathname.startsWith("/login")) return;

  console.warn("Session expired (401). Redirecting to login page…");
  window.location.href = "/login?error=session_invalid";
}

/**
 * Try to refresh the current session by calling the backend
 * POST /auth/session/refresh endpoint.  On success the server-side
 * session expiry is extended by 24 h and the response is OK.
 *
 * Returns `true` when the session was successfully refreshed.
 */
export async function refreshSession(deploymentUrl: string): Promise<boolean> {
  const token = getBrowserSessionToken();
  if (!token) return false;

  try {
    const cleanUrl = deploymentUrl.replace(/\/+$/, "");
    // Use the original (un-wrapped) fetch to avoid recursion.
    const response = await _originalFetch(`${cleanUrl}/auth/session/refresh`, {
      method: "POST",
      headers: {
        "X-API-Key": token,
        "Content-Type": "application/json",
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start a periodic timer that refreshes the session every `intervalMinutes`
 * (default 20 min) to keep it alive while the user is active.
 *
 * Call this once during app bootstrap.  Returns a cleanup function.
 */
export function startProactiveSessionRefresh(
  deploymentUrl: string,
  intervalMinutes = 20,
): () => void {
  const refresh = async () => {
    const ok = await refreshSession(deploymentUrl);
    if (!ok) {
      console.info("Proactive session refresh failed — will retry on next interval.");
    }
  };

  const id = setInterval(refresh, intervalMinutes * 60_000);
  return () => clearInterval(id);
}

// ── Global fetch interceptor ──────────────────────────────────────────────

// Keep a reference to the native fetch so refreshSession() can bypass the
// interceptor and avoid infinite recursion.  Assigned inside
// installGlobalAuthInterceptor (client-side only).
let _originalFetch: typeof fetch;

let _authInterceptorInstalled = false;
let _refreshInFlight: Promise<boolean> | null = null;

/**
 * Install a global `fetch` interceptor that handles 401 responses by:
 *  1. Attempting to refresh the session via /auth/session/refresh.
 *  2. If the refresh succeeds → transparently retry the original request.
 *  3. If the refresh fails → redirect to the login page.
 *
 * Call this **once** during app bootstrap (e.g. in ClientProvider).
 * It is safe to call multiple times – subsequent calls are no-ops.
 */
export function installGlobalAuthInterceptor(): void {
  if (typeof window === "undefined" || _authInterceptorInstalled) return;
  _authInterceptorInstalled = true;

  // _originalFetch was already captured at module level, but make sure
  // it points to the real (un-wrapped) fetch.
  _originalFetch = window.fetch.bind(window);

  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await _originalFetch(...args);

    if (response.status !== 401) {
      return response;
    }

    // ── 401 handling ────────────────────────────────────────────────
    // Skip auth endpoints (login/logout/callback) — they should propagate 401.
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
    if (url?.includes("/auth/login") || url?.includes("/auth/callback") || url?.includes("/auth/logout")) {
      return response;
    }

    // De-duplicate: only one refresh attempt at a time.
    if (!_refreshInFlight) {
      // Derive deployment URL from the failing request's origin.
      const requestUrl = new URL(url, window.location.origin);
      const deploymentUrl = `${requestUrl.protocol}//${requestUrl.host}`;

      _refreshInFlight = refreshSession(deploymentUrl).finally(() => {
        _refreshInFlight = null;
      });
    }

    const refreshed = await _refreshInFlight;

    if (refreshed) {
      // Session was refreshed — retry the original request with the
      // same token (the server extended it, the cookie value is unchanged).
      console.info("Session refreshed — retrying request…");
      return _originalFetch(...args);
    }

    // Refresh failed — session is truly dead.
    setTimeout(() => handleAuthRedirect(), 50);
    return response;
  };
}

export function createLangGraphClientConfig({
  deploymentUrl,
  apiKey,
}: {
  deploymentUrl: string;
  apiKey?: string;
}) {
  const token = getBrowserSessionToken() || apiKey || "";
  const defaultHeaders: Record<string, string> = {};

  if (token) {
    defaultHeaders.Authorization = `Bearer ${token}`;
  }

  return {
    apiUrl: deploymentUrl,
    defaultHeaders,
  };
}

/**
 * Logout from LangGraph server by calling /auth/logout endpoint
 * This cleans up the server-side session
 */
export async function logoutFromLangGraph(deploymentUrl: string): Promise<void> {
  const token = getBrowserSessionToken();
  
  if (!token) {
    // No token to logout with, skip server call
    return;
  }

  try {
    const cleanDeploymentUrl = deploymentUrl.replace(/\/+$/, "");
    const response = await fetch(`${cleanDeploymentUrl}/auth/logout`, {
      method: "POST",
      headers: {
        "X-API-Key": token,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`LangGraph logout failed with status: ${response.status}`);
    }
  } catch (error) {
    console.error("Failed to logout from LangGraph server:", error);
  }
}
