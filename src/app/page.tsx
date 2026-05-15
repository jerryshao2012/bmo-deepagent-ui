import { auth, signIn } from "@/auth";
import ChatPage from "./chat-page";
import SignInAnimation from "./components/SignInAnimation";
import QRCodeSignIn from "./components/QRCodeSignIn";
import { HealthIndicator } from "./components/HealthIndicator";

export default async function Page() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#f8fafc]">
        {/* Top Header */}
        <header className="absolute top-0 left-0 right-0 z-20 flex h-16 items-center justify-between border-b border-slate-200/60 bg-white/70 px-6 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <img src="/bmo-logo.svg" alt="BMO" className="h-6 w-auto" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Deep Agent</h1>
          </div>
          <HealthIndicator />
        </header>

        {/* Canvas animation background */}
        <SignInAnimation />

        {/* Subtle grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-[1] opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Radial vignette - softer for light mode */}
        <div
          className="pointer-events-none absolute inset-0 z-[2]"
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
                  <circle cx="24" cy="24" r="4" fill="url(#logo-grad)" opacity="0.6" />
                  <defs>
                    <linearGradient
                      id="logo-grad"
                      x1="8"
                      y1="4"
                      x2="40"
                      y2="44"
                    >
                      <stop stopColor="#1155cc" />
                      <stop offset="0.5" stopColor="#51a3d5" />
                      <stop offset="1" stopColor="#2dd4bf" />
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

            {/* Divider */}
            <div className="mb-6 h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

            {/* Sign-in buttons */}
            <div className="flex flex-col gap-3">
              <form
                action={async () => {
                  "use server";
                  await signIn("github");
                }}
              >
                <button
                  type="submit"
                  className="signin-btn group relative flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-medium text-slate-700 transition-all duration-300 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 hover:shadow-lg hover:shadow-slate-200/50"
                >
                  {/* GitHub icon */}
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  <span>Sign in with GitHub</span>
                  <div className="signin-btn-shimmer absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-slate-100/50 to-transparent" />
                </button>
              </form>
              <form
                action={async () => {
                  "use server";
                  await signIn("google");
                }}
              >
                <button
                  type="submit"
                  className="signin-btn group relative flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-medium text-slate-700 transition-all duration-300 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 hover:shadow-lg hover:shadow-slate-200/50"
                >
                  {/* Google icon */}
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span>Sign in with Google</span>
                  <div className="signin-btn-shimmer absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-slate-100/50 to-transparent" />
                </button>
              </form>
            </div>

            {/* QR Code Section */}
            <QRCodeSignIn azureUrl="https://deepagent-ui.calmsmoke-0bc2dc70.canadacentral.azurecontainerapps.io/" />

            {/* Footer text */}
            <p className="mt-8 text-center text-[0.7rem] leading-relaxed text-slate-400">
              By signing in, you agree to our Terms of Service
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <ChatPage user={session.user} />;
}
