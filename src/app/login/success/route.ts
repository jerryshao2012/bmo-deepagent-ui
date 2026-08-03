import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { resolveLoginSuccessRequest } from "@/lib/oauth-login";

export async function GET(request: NextRequest) {
  const { token, destination } = resolveLoginSuccessRequest(request.nextUrl);

  if (token) {
    const cookieStore = await cookies();
    cookieStore.set("session_token", token, {
      path: "/",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24, // 24 hours
      sameSite: "lax",
    });

    redirect(destination);
  } else {
    redirect("/login?error=no_token");
  }
}
