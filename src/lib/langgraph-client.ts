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
