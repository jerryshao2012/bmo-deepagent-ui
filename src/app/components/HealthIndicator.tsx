"use client";

import React, { useState, useEffect, useRef } from "react";
import { getConfig } from "@/lib/config";

interface HealthStatus {
  isHealthy: boolean;
  version?: string;
}

export function HealthIndicator() {
  const [health, setHealth] = useState<HealthStatus>({ isHealthy: false });
  const [loading, setLoading] = useState(true);
  const isFirstCheckRef = useRef(true);

  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      const config = getConfig();
      if (!config?.deploymentUrl) {
        if (!cancelled) {
          setHealth({ isHealthy: false });
          setLoading(false);
        }
        return;
      }

      // Always use /health endpoint on first check to get version number
      // Then randomly alternate between endpoints for subsequent checks
      const useOkEndpoint = !isFirstCheckRef.current && Math.random() < 0.5;
      
      // Health check endpoints bypass the proxy and access deployment URL directly
      // as they don't require API key authentication
      const healthUrl = useOkEndpoint
        ? `${config.deploymentUrl}/ok?check_db=0`
        : `${config.deploymentUrl}/health`;

      try {
        const response = await fetch(healthUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!cancelled) {
          if (response.ok) {
            const data = await response.json();
            
            if (useOkEndpoint) {
              // /ok endpoint returns { "ok": true }
              setHealth({ isHealthy: data.ok === true });
            } else {
              // /health endpoint returns detailed status
              setHealth({
                isHealthy: data.status === "healthy",
                version: data.version,
              });
            }
          } else {
            setHealth({ isHealthy: false });
          }
        }
      } catch (error) {
        console.error("Health check failed:", error);
        if (!cancelled) {
          setHealth({ isHealthy: false });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          isFirstCheckRef.current = false;
        }
      }
    };

    checkHealth();

    // Refresh health check every 30 seconds
    const interval = setInterval(checkHealth, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {/* Status indicator */}
      <div
        className={`h-2.5 w-2.5 rounded-full ${
          health.isHealthy ? "bg-green-500" : "bg-red-500"
        }`}
        title={health.isHealthy ? "Backend is healthy" : "Backend is unavailable"}
      />
      
      {/* Version number (only shown if available from /health endpoint) */}
      {health.version && (
        <span className="text-xs text-muted-foreground font-medium">
          v{health.version}
        </span>
      )}
    </div>
  );
}
