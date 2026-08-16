"use client";

import { useEffect, useMemo, ReactNode } from "react";
import { Client } from "@langchain/langgraph-sdk";
import {
  configureLangGraphClientStreamPolicy,
  createLangGraphClientConfig,
  startProactiveSessionRefresh,
} from "@/lib/langgraph-client";
import { ClientContext } from "@/providers/ClientContext";

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
  // Proactively refresh the session every 20 minutes to keep it alive
  // while the user is active (the backend session TTL is 24 h).
  useEffect(() => {
    if (!deploymentUrl) return;
    return startProactiveSessionRefresh(deploymentUrl, 20);
  }, [deploymentUrl]);

  const client = useMemo(() => {
    return configureLangGraphClientStreamPolicy(
      new Client(createLangGraphClientConfig({ deploymentUrl, apiKey })),
      deploymentUrl
    );
  }, [deploymentUrl, apiKey]);

  const value = useMemo(() => ({ client }), [client]);

  return (
    <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
  );
}
