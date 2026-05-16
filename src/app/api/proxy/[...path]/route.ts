import { NextRequest, NextResponse } from "next/server";

/**
 * API Proxy for LangGraph Server
 * 
 * This proxy adds X-API-Key authentication header to all requests
 * except health check endpoints (/health, /ok).
 * 
 * The API key is sourced from LANGCHAIN_API_KEY environment variable.
 * 
 * Reference: https://docs.langchain.com/langsmith/auth
 */

// Health check endpoints that don't require authentication
const HEALTH_CHECK_PATHS = ["/health", "/ok"];

function isHealthCheck(pathname: string): boolean {
  return HEALTH_CHECK_PATHS.some((path) => pathname === path || pathname.startsWith(path + "?"));
}

export async function GET(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function POST(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function PUT(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function DELETE(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function PATCH(request: NextRequest) {
  return handleProxyRequest(request);
}

async function handleProxyRequest(request: NextRequest) {
  try {
    // Priority order for deployment URL:
    // 1. X-Deployment-URL header (from client, for dynamic local dev)
    // 2. LANGGRAPH_URL env var (server-side, for production)
    // 3. NEXT_PUBLIC_LANGGRAPH_URL env var (fallback)
    let deploymentUrl: string | null = request.headers.get("X-Deployment-URL");
    
    if (!deploymentUrl) {
      deploymentUrl = process.env.LANGGRAPH_URL || process.env.NEXT_PUBLIC_LANGGRAPH_URL || null;
    }
    
    if (!deploymentUrl) {
      return NextResponse.json(
        { error: "LangGraph deployment URL not configured" },
        { status: 500 }
      );
    }

    // Get the target path from the request URL
    const url = new URL(request.url);
    const targetPath = url.pathname.replace(/^\/api\/proxy/, "");
    const targetUrl = `${deploymentUrl}${targetPath}${url.search}`;

    // Check if this is a health check endpoint
    const isHealth = isHealthCheck(targetPath);

    // Clone headers and remove host-related headers
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");

    // Add API key for non-health-check requests
    if (!isHealth) {
      const apiKey = process.env.LANGCHAIN_API_KEY;
      
      if (!apiKey) {
        return NextResponse.json(
          { error: "LANGCHAIN_API_KEY not configured" },
          { status: 500 }
        );
      }

      headers.set("X-API-Key", apiKey);
    }

    // Forward the request to LangGraph server
    const fetchOptions: RequestInit & { duplex?: string } = {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      duplex: "half", // Required for streaming requests
    };

    const response = await fetch(targetUrl, fetchOptions);

    // Create response with same status and headers
    const responseHeaders = new Headers(response.headers);
    
    // Remove CORS-related headers to avoid conflicts
    responseHeaders.delete("access-control-allow-origin");
    responseHeaders.delete("access-control-allow-methods");
    responseHeaders.delete("access-control-allow-headers");

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      { error: "Internal proxy error" },
      { status: 500 }
    );
  }
}
