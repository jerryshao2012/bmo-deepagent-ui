import { cookies } from "next/headers";
import ChatPage from "../chat-page";
import TokenSignIn from "./TokenSignIn";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] | undefined }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("session_token")?.value;
  const resolvedSearchParams = await searchParams;
  const passedToken =
    typeof resolvedSearchParams.token === "string"
      ? resolvedSearchParams.token
      : undefined;

  if (!token && passedToken) {
    return (
      <TokenSignIn
        token={passedToken}
        redirectTo="/chat"
      />
    );
  }

  if (!token) {
    redirect("/login?error=no_token");
  }

  // Fetch user data from the backend validation endpoint
  const backendUrl =
    process.env.LANGGRAPH_URL ||
    process.env.NEXT_PUBLIC_LANGGRAPH_URL ||
    "http://localhost:2024";
  const cleanBackendUrl = backendUrl.replace(/\/+$/, "");

  let user = null;
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
        };
      }
    }
  } catch (error) {
    console.error("Failed to validate session with backend:", error);
  }

  if (!user) {
    redirect("/login");
  }

  return <ChatPage user={user} />;
}
