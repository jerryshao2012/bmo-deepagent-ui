// src/app/api/stream/route.ts (Next.js App Router style)
import { NextRequest } from "next/server";

export const runtime = "edge"; // Edge runtime is ideal for streaming on Vercel

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractSessionToken(req: NextRequest): string | null {
  const cookieToken = req.cookies.get("session_token")?.value;
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  const apiKeyHeader = req.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader.trim();

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const sessionToken = extractSessionToken(req);
    if (!sessionToken) {
      return Response.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Response.json(
        { error: "Invalid request payload" },
        { status: 400 }
      );
    }

    const { threadId, ...body } = payload;
    if (typeof threadId !== "string" || !UUID_RE.test(threadId)) {
      return Response.json(
        { error: "Invalid thread ID format" },
        { status: 400 }
      );
    }

    const backendHost =
      process.env.BACKEND_API_URL ||
      process.env.NEXT_PUBLIC_LANGGRAPH_URL ||
      "http://localhost:2024";
    const cleanBackendHost = backendHost.replace(/\/+$/, "");

    // 1. Validate session
    let validateRes: Response;
    try {
      validateRes = await fetch(`${cleanBackendHost}/auth/session/validate`, {
        headers: { "X-API-Key": sessionToken },
        signal: req.signal,
        cache: "no-store",
      });
    } catch {
      return Response.json(
        { error: "Failed to connect to authentication service" },
        { status: 502 }
      );
    }

    if (!validateRes.ok) {
      await validateRes.body?.cancel();
      return Response.json(
        { error: "Invalid or expired session" },
        { status: 401 }
      );
    }

    const validateData = await validateRes.json().catch(() => null);
    if (!validateData?.valid) {
      return Response.json(
        { error: "Invalid or expired session" },
        { status: 401 }
      );
    }

    // 2. Validate thread access for authenticated user
    let threadRes: Response;
    try {
      threadRes = await fetch(`${cleanBackendHost}/threads/${threadId}`, {
        headers: { "X-API-Key": sessionToken },
        signal: req.signal,
        cache: "no-store",
      });
    } catch {
      return Response.json(
        { error: "Failed to verify thread access" },
        { status: 502 }
      );
    }

    // Thread metadata is only an access check; do not retain its response.
    await threadRes.body?.cancel();
    if (!threadRes.ok) {
      if (threadRes.status === 404) {
        return Response.json(
          { error: "Thread not found or access denied" },
          { status: 404 }
        );
      }
      if (threadRes.status === 401 || threadRes.status === 403) {
        return Response.json(
          { error: "Access denied to thread" },
          { status: threadRes.status }
        );
      }
      return Response.json(
        { error: `Thread verification failed with status ${threadRes.status}` },
        { status: threadRes.status }
      );
    }

    // 3. Proxy streaming request to backend
    const backendUrl = `${cleanBackendHost}/threads/${threadId}/runs/stream`;
    console.log(
      `[Stream Proxy] Proxying thread ${threadId} to backend: ${backendUrl}`
    );

    // Keep backend authorization scoped to the same caller through execution.
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": sessionToken,
      },
      body: JSON.stringify(body),
      signal: req.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      await response.body?.cancel();
      return Response.json(
        { error: "Agent request rejected" },
        { status: response.status }
      );
    }

    // Forward the ReadableStream directly to the frontend
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return Response.json(
      { error: "Agent backend unavailable" },
      { status: 502 }
    );
  }
}
