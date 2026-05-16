"use client";

import { createContext, useContext, useMemo, ReactNode } from "react";
import { Client } from "@langchain/langgraph-sdk";

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
  const client = useMemo(() => {
    let apiUrl: string;
    const defaultHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (typeof window !== "undefined") {
      // Browser-side: use absolute URL to /api/proxy
      apiUrl = `${window.location.origin}/api/proxy`;
      // Pass deployment URL as header for dynamic local dev support
      defaultHeaders["X-Deployment-URL"] = deploymentUrl;
      // API key is added by server-side proxy, but keep for local dev fallback
      if (apiKey) {
        defaultHeaders["X-Api-Key"] = apiKey;
      }
    } else {
      // Server-side: use direct deployment URL or env var
      apiUrl = process.env.LANGGRAPH_URL || process.env.NEXT_PUBLIC_LANGGRAPH_URL || deploymentUrl;
      if (apiKey) {
        defaultHeaders["X-Api-Key"] = apiKey;
      }
    }
    
    return new Client({
      apiUrl,
      defaultHeaders,
    });
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
