"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  readRememberedLogin,
  type LoginProvider,
  type RememberedLogin,
} from "@/lib/remembered-login";
import {
  authenticateWithPasskey,
  isPasskeyCancellation,
  supportsPasskeyAuthentication,
} from "@/lib/passkey-client";

interface LoginProvidersProps {
  onSignIn: (provider: LoginProvider) => Promise<void>;
  passkeysEnabled?: boolean;
  supportsPasskeys?: () => boolean;
  onPasskeySignIn?: () => Promise<unknown>;
}

const GoogleIcon = () => (
  <svg
    className="h-4.5 w-4.5 min-w-[18px]"
    viewBox="0 0 24 24"
  >
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
);

const GithubIcon = () => (
  <svg
    className="h-4.5 w-4.5 min-w-[18px] text-slate-800"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

const providers: Array<{
  id: LoginProvider;
  name: string;
  icon: React.ReactNode;
}> = [
  { id: "google", name: "Google", icon: <GoogleIcon /> },
  { id: "github", name: "Github", icon: <GithubIcon /> },
];

function providerName(provider: LoginProvider) {
  return provider === "google" ? "Google" : "GitHub";
}

function accountInitials(account: RememberedLogin) {
  const source =
    account.name || account.email || providerName(account.provider);
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length > 1) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function isRedirectError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const candidate = error as { message?: unknown; digest?: unknown };
  return (
    candidate.message === "NEXT_REDIRECT" ||
    (typeof candidate.digest === "string" &&
      candidate.digest.startsWith("NEXT_REDIRECT"))
  );
}

export default function LoginProviders({
  onSignIn,
  passkeysEnabled = false,
  supportsPasskeys = supportsPasskeyAuthentication,
  onPasskeySignIn = authenticateWithPasskey,
}: LoginProvidersProps) {
  const [remembered, setRemembered] = useState<RememberedLogin | null>(null);
  const [passkeysSupported, setPasskeysSupported] = useState(false);
  const [activeProvider, setActiveProvider] = useState<LoginProvider | null>(
    null
  );
  const [isPasskeySigningIn, setIsPasskeySigningIn] = useState(false);
  const signInStartedRef = useRef(false);

  const resetSignIn = useCallback(() => {
    signInStartedRef.current = false;
    setActiveProvider(null);
    setIsPasskeySigningIn(false);
  }, []);

  useEffect(() => {
    setRemembered(readRememberedLogin());
    setPasskeysSupported(passkeysEnabled && supportsPasskeys());

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resetSignIn();
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [passkeysEnabled, resetSignIn, supportsPasskeys]);

  const handleProviderClick = (provider: LoginProvider) => {
    if (signInStartedRef.current) return;

    signInStartedRef.current = true;
    setActiveProvider(provider);

    void onSignIn(provider)
      .then(resetSignIn)
      .catch((error: unknown) => {
        if (isRedirectError(error)) return;

        toast.error(
          `Failed to sign in with ${providerName(provider)}. Please try again.`
        );
        resetSignIn();
      });
  };

  const handlePasskeyClick = () => {
    if (signInStartedRef.current) return;

    signInStartedRef.current = true;
    setIsPasskeySigningIn(true);

    void onPasskeySignIn()
      .then(resetSignIn)
      .catch((error: unknown) => {
        if (!isPasskeyCancellation(error)) {
          toast.error(
            "Passkey sign-in failed. Please try again or use Google or GitHub."
          );
        }
        resetSignIn();
      });
  };

  const isSigningIn = activeProvider !== null || isPasskeySigningIn;
  const rememberedLabel = remembered?.name || remembered?.email || null;
  const rememberedProvider = remembered
    ? providers.find((provider) => provider.id === remembered.provider)
    : null;

  return (
    <div className="w-full">
      {remembered && rememberedLabel && rememberedProvider && (
        <button
          type="button"
          aria-label={`Continue as ${rememberedLabel} with ${providerName(
            remembered.provider
          )}`}
          aria-busy={activeProvider === remembered.provider}
          disabled={isSigningIn}
          onClick={() => handleProviderClick(remembered.provider)}
          className="group relative flex w-full items-center gap-3 rounded-2xl border border-[#1155cc]/30 bg-gradient-to-br from-white to-blue-50/60 px-4 py-3.5 text-left shadow-sm shadow-[#1155cc]/10 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1155cc]/60 hover:shadow-lg hover:shadow-blue-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1155cc] focus-visible:ring-offset-2 active:translate-y-0 disabled:cursor-wait disabled:opacity-70"
        >
          <Avatar className="h-12 w-12 border border-white bg-[#1155cc] shadow-sm">
            {remembered.avatarUrl && (
              <AvatarImage
                src={remembered.avatarUrl}
                alt={rememberedLabel}
                referrerPolicy="no-referrer"
              />
            )}
            <AvatarFallback className="bg-[#1155cc] text-sm font-bold text-white">
              {accountInitials(remembered)}
            </AvatarFallback>
          </Avatar>

          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#1155cc]">
              Continue as
            </span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">
              {rememberedLabel}
            </span>
            {remembered.email && remembered.email !== rememberedLabel && (
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {remembered.email}
              </span>
            )}
          </span>

          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
            {activeProvider === remembered.provider ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1155cc] border-t-transparent" />
            ) : (
              rememberedProvider.icon
            )}
          </span>
        </button>
      )}

      <div className="relative my-6 flex items-center justify-center">
        <div
          className="absolute inset-0 flex items-center"
          aria-hidden="true"
        >
          <div className="w-full border-t border-slate-200/80" />
        </div>
        <div className="relative rounded-full bg-[#f8fafc] px-4 text-xs font-semibold tracking-wider text-slate-500/90 sm:bg-white/80">
          {remembered ? "Or sign in with" : "Log in with"}
        </div>
      </div>

      {passkeysSupported && (
        <button
          type="button"
          onClick={handlePasskeyClick}
          disabled={isSigningIn}
          aria-busy={isPasskeySigningIn}
          className="mb-3.5 flex w-full items-center justify-center rounded-xl border border-[#1155cc]/30 bg-blue-50/50 px-3 py-3.5 text-sm font-semibold text-[#1155cc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1155cc] focus-visible:ring-offset-2"
        >
          {isPasskeySigningIn
            ? "Waiting for passkey…"
            : "Sign in with a passkey"}
        </button>
      )}

      <div className="grid grid-cols-2 gap-3.5">
        {providers.map((provider) => {
          const isLoading = activeProvider === provider.id;

          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => handleProviderClick(provider.id)}
              disabled={isSigningIn}
              aria-busy={isLoading}
              className="signin-btn group relative flex w-full cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-3.5 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 hover:shadow-lg hover:shadow-slate-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1155cc] focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
            >
              <span className="flex w-full items-center justify-center gap-2">
                {isLoading ? (
                  <span className="h-4.5 w-4.5 animate-spin rounded-full border-2 border-[#1155cc] border-t-transparent" />
                ) : (
                  <span className="flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
                    {provider.icon}
                  </span>
                )}
                <span className="whitespace-nowrap text-[13px] font-semibold tracking-tight text-slate-700 group-hover:text-slate-900">
                  {provider.name}
                </span>
              </span>
              <span className="signin-btn-shimmer pointer-events-none absolute inset-0 rounded-xl" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
