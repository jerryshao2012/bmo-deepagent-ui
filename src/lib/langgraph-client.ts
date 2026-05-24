export function getBrowserSessionToken(): string {
  if (typeof document === "undefined") {
    return "";
  }

  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith("session_token="));

  return cookie ? decodeURIComponent(cookie.split("=")[1] ?? "") : "";
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
