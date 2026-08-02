import { isLoginProvider } from "@/lib/remembered-login";

export function buildOAuthLoginUrl(backendUrl: string, provider: unknown) {
  if (!isLoginProvider(provider)) {
    throw new Error("Unsupported login provider.");
  }

  return `${backendUrl.replace(/\/+$/, "")}/auth/login/${provider}`;
}
