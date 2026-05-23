"use client";

import { useEffect } from "react";

interface TokenSignInProps {
  token: string;
  redirectTo?: string;
}

export default function TokenSignIn({
  token,
  redirectTo = "/chat",
}: TokenSignInProps) {
  useEffect(() => {
    if (!token) {
      return;
    }

    const encodedToken = encodeURIComponent(token);
    const secure = window.location.protocol === "https:";
    document.cookie = `session_token=${encodedToken}; path=/; SameSite=Lax; ${
      secure ? "Secure;" : ""
    }`;
    window.location.href = redirectTo;
  }, [token, redirectTo]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-lg">
        <h1 className="text-xl font-semibold text-slate-900">Signing in…</h1>
        <p className="mt-2 text-sm text-slate-500">
          Finishing login and redirecting to your workspace.
        </p>
      </div>
    </div>
  );
}
