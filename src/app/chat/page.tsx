import { cookies } from "next/headers";
import ChatPage from "../chat-page";
import { redirect } from "next/navigation";
import type { AuthenticatedUser } from "@/lib/remembered-login";
import { isPasskeyBffConfigured } from "@/lib/server/passkey-bff";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session_token")?.value;

  if (!token) {
    redirect("/login");
  }

  // Fetch user data from the backend validation endpoint
  const backendUrl =
    process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:2024";
  const cleanBackendUrl = backendUrl.replace(/\/+$/, "");

  let user: AuthenticatedUser | null = null;
  let validationFailed = false;

  try {
    const res = await fetch(`${cleanBackendUrl}/auth/session/validate`, {
      headers: {
        "X-API-Key": token,
      },
      next: { revalidate: 0 }, // Do not cache
    });

    if (res.ok) {
      const data = await res.json();
      if (data.valid) {
        user = {
          name: data.user.name,
          email: data.user.email,
          image: data.user.avatar_url,
          identity: data.user.identity,
          provider: data.user.provider,
          auth_method: data.user.auth_method,
        };
      } else {
        validationFailed = true;
        console.warn("Session validation returned invalid:", data);
      }
    } else {
      validationFailed = true;
      console.warn(`Session validation failed with status: ${res.status}`);
    }
  } catch (error) {
    console.error("Failed to validate session with backend:", error);
    validationFailed = true;
  }

  // If validation failed, redirect to login with an error parameter
  if (validationFailed || !user) {
    redirect("/login?error=session_invalid");
  }

  return (
    <ChatPage
      user={user}
      passkeysEnabled={isPasskeyBffConfigured()}
      oauthBackendUrl={cleanBackendUrl}
    />
  );
}
