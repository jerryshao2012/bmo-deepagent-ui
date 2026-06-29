import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // nodejs runtime to maintain in-memory state

// In-memory thread content store
// NOTE: This resets on Vercel deploys. For persistence, use a database.
const threadStore = new Map<string, string>();

// ── Subscriber management for persistent SSE streams ─────────────────────

type SSEController = ReadableStreamDefaultController<Uint8Array>;

const subscribers = new Map<string, Set<{ controller: SSEController }>>();

function addSubscriber(threadId: string, controller: SSEController): void {
  if (!subscribers.has(threadId)) {
    subscribers.set(threadId, new Set());
  }
  subscribers.get(threadId)!.add({ controller });
  console.log(
    `[WS Fallback] Subscriber added to thread ${threadId}. Total: ${subscribers.get(threadId)!.size}`
  );
}

function removeSubscriber(threadId: string, controller: SSEController): void {
  const subs = subscribers.get(threadId);
  if (!subs) return;

  for (const sub of subs) {
    if (sub.controller === controller) {
      subs.delete(sub);
      break;
    }
  }

  if (subs.size === 0) {
    subscribers.delete(threadId);
  }

  console.log(
    `[WS Fallback] Subscriber removed from thread ${threadId}. Remaining: ${subs.size}`
  );
}

function notifySubscribers(threadId: string, content: string): void {
  const subs = subscribers.get(threadId);
  if (!subs || subs.size === 0) return;

  const message = `event: sync\ndata: ${JSON.stringify({ type: "sync", content })}\n\n`;
  const encoded = new TextEncoder().encode(message);

  for (const sub of subs) {
    try {
      sub.controller.enqueue(encoded);
    } catch {
      // Controller is already closed (client disconnected). Remove it.
      removeSubscriber(threadId, sub.controller);
    }
  }
}

// ── Route handlers ───────────────────────────────────────────────────────

/**
 * GET handler for intro page SSE sync.
 * Returns a persistent SSE stream that stays open and pushes content updates
 * as they arrive via POST from other clients.
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

  const encoder = new TextEncoder();
  let cleanedUp = false;

  const cleanup = (controller: SSEController) => {
    if (cleanedUp) return;
    cleanedUp = true;
    removeSubscriber(threadId, controller);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      addSubscriber(threadId, controller);

      // Set reconnect interval to 5 seconds for EventSource auto-reconnect
      controller.enqueue(encoder.encode("retry: 5000\n\n"));

      // Send current content immediately
      const content = threadStore.get(threadId) || "";
      const syncMessage = `event: sync\ndata: ${JSON.stringify({ type: "sync", content })}\n\n`;
      controller.enqueue(encoder.encode(syncMessage));

      console.log(
        `[WS Fallback] GET thread ${threadId}, initial content size: ${content.length}`
      );

      // Heartbeat every 15 seconds to prevent proxy / Vercel idle timeout
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeatInterval);
          cleanup(controller);
        }
      }, 15000);

      // Detect client disconnect via request abort signal
      if (req.signal) {
        req.signal.addEventListener(
          "abort",
          () => {
            clearInterval(heartbeatInterval);
            cleanup(controller);
          },
          { once: true }
        );
      }
    },

    cancel(controller) {
      cleanup(controller);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * POST handler for storing thread content updates.
 * Used by intro page to persist thread state and push updates to connected SSE clients.
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

      // Push update to all connected SSE subscribers
      notifySubscribers(threadId, content || "");

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
