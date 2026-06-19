import SignInAnimation from "../components/SignInAnimation";
import QRCodeSignIn from "../components/QRCodeSignIn";
import { HealthIndicator } from "../components/HealthIndicator";
import LoginProviders from "../components/LoginProviders";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("session_token")?.value;
  const resolvedSearchParams = await searchParams;

  // Check for error parameter
  const error =
    typeof resolvedSearchParams.error === "string"
      ? resolvedSearchParams.error
      : null;

  // If there's an error, clear the session token to break the redirect loop
  if (error && token) {
    // We can't delete cookies directly in server components,
    // but we can pass this info to the client component
    console.warn(
      `Login page accessed with error: ${error}. Session token will need to be cleared.`
    );
  }

  if (token && !error) {
    // Redirect to chat or callback URL if provided
    const callbackUrl =
      typeof resolvedSearchParams.callbackUrl === "string"
        ? resolvedSearchParams.callbackUrl
        : "/chat";
    redirect(callbackUrl);
  }

  return (
    <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden bg-transparent">
      {/* Solid background underneath canvas */}
      <div className="pointer-events-none absolute inset-0 z-0 bg-[#faf8f5]" />

      {/* Top Header */}
      <header className="absolute left-0 right-0 top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200/60 bg-white/70 px-6 backdrop-blur-md">
        <a
          href="/"
          className="flex items-center gap-4 transition duration-200 hover:opacity-80 active:scale-95"
        >
          <img
            src="/bmo-logo.svg"
            alt="BMO"
            className="h-6 w-auto"
          />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Deep Agent
          </h1>
        </a>
        <HealthIndicator />
      </header>

      {/* Canvas animation background */}
      <SignInAnimation />

      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-[2] opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Radial vignette - softer for light mode */}
      <div
        className="pointer-events-none absolute inset-0 z-[3]"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(241,245,249,0.4) 100%)",
        }}
      />

      {/* Sign-in card */}
      <div className="signin-card relative z-10 mx-4 w-full max-w-[420px]">
        <div className="signin-card-inner rounded-3xl border border-white bg-white/80 p-8 shadow-2xl shadow-slate-200/60 sm:p-10">
          {/* Logo / Brand mark */}
          <div className="mb-8 flex flex-col items-center">
            <div className="signin-logo-ring relative mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-slate-100 bg-slate-50/50 shadow-inner">
              <div className="signin-logo-glow absolute inset-0 rounded-full opacity-20" />
              <svg
                viewBox="0 0 48 48"
                className="relative z-10 h-10 w-10"
                fill="none"
              >
                <path
                  d="M24 4L8 14v20l16 10 16-10V14L24 4z"
                  stroke="url(#logo-grad)"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path
                  d="M24 4v40M8 14l16 10 16-10M8 34l16-10 16 10"
                  stroke="url(#logo-grad)"
                  strokeWidth="1"
                  opacity="0.3"
                />
                <circle
                  cx="24"
                  cy="24"
                  r="4"
                  fill="url(#logo-grad)"
                  opacity="0.6"
                />
                <defs>
                  <linearGradient
                    id="logo-grad"
                    x1="8"
                    y1="4"
                    x2="40"
                    y2="44"
                  >
                    <stop stopColor="#1155cc" />
                    <stop
                      offset="0.5"
                      stopColor="#51a3d5"
                    />
                    <stop
                      offset="1"
                      stopColor="#2dd4bf"
                    />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <h1 className="signin-title mb-2 text-center text-[1.65rem] font-semibold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="text-center text-sm leading-relaxed text-slate-500">
              Sign in to your account to continue
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">
                {error === "session_invalid"
                  ? "Your session has expired or is invalid. Please sign in again."
                  : "An error occurred during authentication."}
              </p>
              <p className="mt-2 text-xs text-red-600">
                If you continue to experience issues, try{" "}
                <a
                  href="/intro"
                  className="underline hover:text-red-700"
                >
                  visiting the intro page
                </a>{" "}
                and clearing your session cookies.
              </p>
            </div>
          )}

          {/* Sign-in buttons */}
          <LoginProviders
            onSignIn={async (provider: string) => {
              "use server";
              const backendUrl =
                process.env.NEXT_PUBLIC_LANGGRAPH_URL ||
                "http://localhost:2024";
              const cleanBackendUrl = backendUrl.replace(/\/+$/, "");
              redirect(`${cleanBackendUrl}/auth/login/${provider}`);
            }}
          />

          {/* QR Code Section */}
          <QRCodeSignIn />

          {/* Footer text */}
          <p className="mt-8 text-center text-[0.7rem] leading-relaxed text-slate-400">
            By signing in, you agree to our Terms of Service
          </p>
        </div>
      </div>
    </div>
  );
}
