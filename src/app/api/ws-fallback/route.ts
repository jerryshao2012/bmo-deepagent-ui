import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // nodejs runtime to maintain in-memory state

// ── Shared state (bridged with server.cjs WebSocket when available) ──────
// When running with server.cjs, the global state is pre-initialized so the
// WebSocket server and this SSE route share the same Maps.  On Vercel or
// other serverless platforms where server.cjs is absent we fall back to
// module-local state.

type SSEController = ReadableStreamDefaultController<Uint8Array>;
type ThreadState = { content: string; exists: boolean; readable: boolean };
const MARKDOWN_ID_RE = /^\d{6}$/;

function invalidThreadIdResponse(): Response {
  return new Response(JSON.stringify({ error: "Invalid threadId" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function invalidContentResponse(): Response {
  return new Response(JSON.stringify({ error: "Invalid content" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function invalidRequestResponse(): Response {
  return new Response(JSON.stringify({ error: "Invalid request" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function storageReadErrorResponse(): Response {
  return new Response(JSON.stringify({ error: "Unable to load thread" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

declare global {
  var __sseThreadStore: Map<string, string> | undefined;
  var __sseSubscribers:
    | Map<string, Set<{ controller: SSEController }>>
    | undefined;
  var __sseNotify:
    | ((threadId: string, content: string, immediate?: boolean) => void)
    | undefined;
  var __sseLoad: ((threadId: string) => ThreadState) | undefined;
}

const threadStore: Map<string, string> =
  globalThis.__sseThreadStore ?? new Map<string, string>();

const subscribers: Map<
  string,
  Set<{ controller: SSEController }>
> = globalThis.__sseSubscribers ??
new Map<string, Set<{ controller: SSEController }>>();

// Ensure the global references point to the same Maps so server.cjs can
// access subscribers added by this route.
if (!globalThis.__sseThreadStore) globalThis.__sseThreadStore = threadStore;
if (!globalThis.__sseSubscribers) globalThis.__sseSubscribers = subscribers;

function readThreadState(threadId: string): ThreadState {
  const serverState = globalThis.__sseLoad?.(threadId);
  if (serverState) return serverState;
  return {
    content: threadStore.get(threadId) ?? "",
    exists: threadStore.has(threadId),
    readable: true,
  };
}

// ── Subscriber helpers ───────────────────────────────────────────────────

function addSubscriber(threadId: string, controller: SSEController): void {
  if (!subscribers.has(threadId)) {
    subscribers.set(threadId, new Set());
  }
  subscribers.get(threadId)!.add({ controller });
  console.log(
    `[WS Fallback] Subscriber added to thread ${threadId}. Total: ${
      subscribers.get(threadId)!.size
    }`
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

function notifySubscribers(
  threadId: string,
  content: string,
  immediate = false
): void {
  // Use the global bridge when available (it is kept in sync by server.cjs),
  // otherwise fall back to the local implementation.
  if (typeof globalThis.__sseNotify === "function") {
    globalThis.__sseNotify(threadId, content, immediate);
    return;
  }

  const subs = subscribers.get(threadId);
  if (!subs || subs.size === 0) return;

  const message = `event: sync\ndata: ${JSON.stringify({
    type: "sync",
    content,
  })}\n\n`;
  const encoded = new TextEncoder().encode(message);

  for (const sub of subs) {
    try {
      sub.controller.enqueue(encoded);
    } catch {
      removeSubscriber(threadId, sub.controller);
    }
  }
}

// ── Route handlers ───────────────────────────────────────────────────────

/**
 * GET handler for intro page SSE sync.
 *
 * Two modes, selected by the presence of the `poll` query parameter:
 *
 * 1. Persistent SSE stream (no `poll` param):
 *    Returns a long-lived SSE stream that stays open and pushes content
 *    updates as they arrive via POST from other clients or the WebSocket
 *    bridge.  Best-effort on serverless — works in real time when both
 *    clients land on the same function instance.
 *
 * 2. Read-only polling (with `?poll=1`):
 *    Short request/response used when a proxy buffers or interrupts SSE.
 *    Mutations always use POST so a newly opened empty browser cannot erase
 *    content written by another client.
 *
 * Expected query parameters:
 * - threadId: The ID of the thread
 * - poll (optional): If "1", use polling mode
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");

  if (!threadId || !MARKDOWN_ID_RE.test(threadId)) {
    return invalidThreadIdResponse();
  }

  // ── Polling mode (cross-instance catch-up) ──────────────────────────
  if (searchParams.get("poll") === "1") {
    const state = readThreadState(threadId);
    if (!state.readable) return storageReadErrorResponse();

    return new Response(
      JSON.stringify({
        type: "sync",
        content: state.content,
        authoritative: state.exists,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  // ── Persistent SSE stream mode ──────────────────────────────────────
  const initialState = readThreadState(threadId);
  if (!initialState.readable) return storageReadErrorResponse();

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
      const syncMessage = `event: sync\ndata: ${JSON.stringify({
        type: "sync",
        content: initialState.content,
        initial: true,
        authoritative: initialState.exists,
      })}\n\n`;
      controller.enqueue(encoder.encode(syncMessage));

      console.log(
        `[WS Fallback] GET thread ${threadId}, initial content size: ${initialState.content.length}`
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
 * Used by intro page to persist thread state and push updates to all connected
 * clients (both SSE subscribers and, via the bridge, WebSocket clients).
 *
 * Expected body:
 * - threadId: The ID of the thread
 * - content: The content to store (or empty to delete)
 * - type: 'update' for storage operations
 * - immediate: boolean flag
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsedBody: unknown = await req.json();
    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    ) {
      return invalidRequestResponse();
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return invalidRequestResponse();
  }

  try {
    const { threadId, content, type, immediate } = body;

    if (typeof threadId !== "string" || !MARKDOWN_ID_RE.test(threadId)) {
      return invalidThreadIdResponse();
    }

    if (type === "update") {
      if (typeof content !== "string") return invalidContentResponse();

      if (!content || content.trim() === "") {
        // Keep an in-memory tombstone so stale browser cache cannot reseed it.
        threadStore.set(threadId, "");
        console.log(`[WS Fallback] Deleted thread: ${threadId}`);
      } else {
        // Store content
        threadStore.set(threadId, content);
        console.log(
          `[WS Fallback] Stored thread ${threadId}, size: ${content.length} bytes (immediate: ${immediate})`
        );
      }

      // Push update to all connected SSE subscribers
      // (When the global bridge is active, this also reaches WebSocket clients)
      notifySubscribers(threadId, content || "", immediate === true);

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
