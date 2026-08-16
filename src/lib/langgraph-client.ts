import { browserSessionProvider } from "@/features/auth/infrastructure/browser-session-provider";
import { authenticatedFetch } from "@/platform/http/authenticated-fetch";
import type { Client } from "@langchain/langgraph-sdk";

const localStreamPolicyClients = new WeakSet<Client>();

function isLocalDeploymentUrl(deploymentUrl: string): boolean {
  try {
    const hostname = new URL(deploymentUrl).hostname.replace(/^\[|\]$/g, "");
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

/**
 * Disable the SDK's idle stream watchdog for clients pointed at local servers.
 * Local Ollama runs can pause long enough that no heartbeat reaches the SDK.
 */
export function configureLangGraphClientStreamPolicy(
  client: Client,
  deploymentUrl: string
): Client {
  if (
    !isLocalDeploymentUrl(deploymentUrl) ||
    localStreamPolicyClients.has(client)
  ) {
    return client;
  }

  const runs = client.runs;
  const originalStream = runs.stream;
  const originalJoinStream = runs.joinStream;

  runs.stream = ((...args: unknown[]) => {
    const payload = args[2];
    const payloadRecord =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)
        : {};
    return Reflect.apply(originalStream, runs, [
      ...args.slice(0, 2),
      { ...payloadRecord, streamIdleReconnect: 0 },
      ...args.slice(3),
    ]);
  }) as typeof runs.stream;

  runs.joinStream = ((...args: unknown[]) => {
    const options = args[2];
    const nextOptions = isAbortSignal(options)
      ? { signal: options, streamIdleReconnect: 0 }
      : options === undefined
      ? { streamIdleReconnect: 0 }
      : typeof options === "object" && options !== null
      ? {
          ...(options as Record<string, unknown>),
          streamIdleReconnect: 0,
        }
      : options;
    return Reflect.apply(originalJoinStream, runs, [
      ...args.slice(0, 2),
      nextOptions,
      ...args.slice(3),
    ]);
  }) as typeof runs.joinStream;

  localStreamPolicyClients.add(client);
  return client;
}

export const getBrowserSessionToken = () => browserSessionProvider.getToken();

/**
 * Clear the stale session_token cookie and redirect to the login page.
 */
export function handleAuthRedirect(): void {
  browserSessionProvider.handleInvalidSession();
}

/**
 * Try to refresh the current session by calling the backend
 * POST /auth/session/refresh endpoint.  On success the server-side
 * session expiry is extended by 24 h and the response is OK.
 *
 * Returns `true` when the session was successfully refreshed.
 */
export async function refreshSession(deploymentUrl: string): Promise<boolean> {
  return browserSessionProvider.refresh(deploymentUrl);
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
    callerOptions: { fetch: authenticatedFetch },
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
    const response = await authenticatedFetch(`${cleanDeploymentUrl}/auth/logout`, {
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
