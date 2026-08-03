import type { SessionProvider } from "@/features/auth/application/session-provider";

type FetchImplementation = typeof fetch;

function nativeFetch(): FetchImplementation {
  return globalThis.fetch.bind(globalThis);
}

export class BrowserSessionProvider implements SessionProvider {
  constructor(private readonly fetchImplementation = nativeFetch) {}

  getToken(): string {
    if (typeof document === "undefined") return "";
    const cookie = document.cookie
      .split("; ")
      .find((row) => row.startsWith("session_token="));
    return cookie ? decodeURIComponent(cookie.split("=")[1] ?? "") : "";
  }

  async refresh(deploymentUrl: string): Promise<boolean> {
    const token = this.getToken();
    if (!token) return false;

    try {
      const response = await this.fetchImplementation()(
        `${deploymentUrl.replace(/\/+$/, "")}/auth/session/refresh`,
        {
          method: "POST",
          headers: {
            "X-API-Key": token,
            "Content-Type": "application/json",
          },
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  handleInvalidSession(): void {
    if (typeof window === "undefined") return;
    document.cookie = "session_token=; path=/; max-age=0";
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login?error=session_invalid";
    }
  }
}

export const browserSessionProvider = new BrowserSessionProvider();
