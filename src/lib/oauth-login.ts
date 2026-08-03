import { isLoginProvider } from "@/lib/remembered-login";

export const PASSKEY_MANAGEMENT_RETURN_PATH = "/chat?manage=passkeys";

export function sanitizeOAuthReturnPath(value: unknown): string | null {
  return value === PASSKEY_MANAGEMENT_RETURN_PATH ? value : null;
}

export function buildLoginSuccessRedirect(returnPath: unknown): string {
  return sanitizeOAuthReturnPath(returnPath) || "/chat";
}

export function resolveLoginSuccessRequest(url: URL) {
  return {
    token: url.searchParams.get("token"),
    destination: buildLoginSuccessRedirect(url.searchParams.get("return_path")),
  };
}

export function shouldOpenPasskeyManagement(
  manageQuery: unknown,
  enabled: boolean,
  provider: unknown
): boolean {
  return enabled && isLoginProvider(provider) && manageQuery === "passkeys";
}

export function buildOAuthLoginUrl(
  backendUrl: string,
  provider: unknown,
  returnPath?: unknown
) {
  if (!isLoginProvider(provider)) {
    throw new Error("Unsupported login provider.");
  }

  const loginUrl = `${backendUrl.replace(/\/+$/, "")}/auth/login/${provider}`;
  const safeReturnPath = sanitizeOAuthReturnPath(returnPath);
  if (!safeReturnPath) return loginUrl;

  return `${loginUrl}?return_path=${encodeURIComponent(safeReturnPath)}`;
}
