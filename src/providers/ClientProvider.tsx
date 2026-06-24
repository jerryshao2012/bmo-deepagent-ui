"use client";

import { createContext, useContext, useEffect, useMemo, ReactNode } from "react";
import { Client } from "@langchain/langgraph-sdk";
import { createLangGraphClientConfig, installGlobalAuthInterceptor, startProactiveSessionRefresh } from "@/lib/langgraph-client";

interface ClientContextValue {
  client: Client;
}

const ClientContext = createContext<ClientContextValue | null>(null);

interface ClientProviderProps {
  children: ReactNode;
  deploymentUrl: string;
  apiKey: string;
}

export function ClientProvider({
  children,
  deploymentUrl,
  apiKey,
}: ClientProviderProps) {
  // Install the global 401 fetch interceptor once on mount.
  // On 401 it first tries to refresh the session; only redirects to
  // /login if the refresh also fails.
  useEffect(() => {
    installGlobalAuthInterceptor();
  }, []);

  // Proactively refresh the session every 20 minutes to keep it alive
  // while the user is active (the backend session TTL is 24 h).
  useEffect(() => {
    if (!deploymentUrl) return;
    return startProactiveSessionRefresh(deploymentUrl, 20);
  }, [deploymentUrl]);

  const client = useMemo(() => {
    return new Client(createLangGraphClientConfig({ deploymentUrl, apiKey }));
  }, [deploymentUrl, apiKey]);

  const value = useMemo(() => ({ client }), [client]);

  return (
    <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
  );
}

export function useClient(): Client {
  const context = useContext(ClientContext);

  if (!context) {
    throw new Error("useClient must be used within a ClientProvider");
  }
  return context.client;
}
