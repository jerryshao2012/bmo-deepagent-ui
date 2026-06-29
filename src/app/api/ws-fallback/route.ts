import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // nodejs runtime to maintain in-memory state

// In-memory thread content store
// NOTE: This resets on Vercel deploys. For persistence, use a database.
const threadStore = new Map<string, string>();

/**
 * GET handler for intro page SSE sync.
 * Returns current thread content via SSE sync event.
 *
 * Expected query parameters:
 * - threadId: The ID of the thread
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");

  if (!threadId) {
    return new Response("Missing threadId", { status: 400 });
  }

  try {
    const content = threadStore.get(threadId) || "";

    console.log(
      `[WS Fallback] GET thread ${threadId}, content size: ${content.length}`
    );

    // Send current content as SSE sync event
    const syncMessage = `event: sync\ndata: ${JSON.stringify({
      type: "sync",
      content,
    })}\n\n`;

    return new Response(syncMessage, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("[WS Fallback] GET error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

/**
 * POST handler for storing thread content updates.
 * Used by intro page to persist thread state.
 *
 * Expected body:
 * - threadId: The ID of the thread
 * - content: The content to store (or empty to delete)
 * - type: 'update' for storage operations
 * - immediate: boolean flag
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { threadId, content, type, immediate } = body;

    if (!threadId) {
      return new Response(JSON.stringify({ error: "Missing threadId" }), {
        status: 400,
      });
    }

    if (type === "update") {
      if (!content || content.trim() === "") {
        // Delete empty content
        threadStore.delete(threadId);
        console.log(`[WS Fallback] Deleted thread: ${threadId}`);
      } else {
        // Store content
        threadStore.set(threadId, content);
        console.log(
          `[WS Fallback] Stored thread ${threadId}, size: ${content.length} bytes (immediate: ${immediate})`
        );
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown operation type" }), {
      status: 400,
    });
  } catch (error: any) {
    console.error("[WS Fallback] POST error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
      }),
      { status: 500 }
    );
  }
}
