import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// Storage directory within the workspace
const STORAGE_DIR = path.join(process.cwd(), 'data', 'markdown_threads');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function getFilePath(threadId: string) {
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(STORAGE_DIR, `${safeThreadId}.md`);
}

// In-memory list of active SSE clients grouped by threadId
const clientsMap = new Map<string, Set<ReadableStreamDefaultController>>();

// GET handler for Server-Sent Events (SSE)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('threadId');

  if (!threadId) {
    return new Response('Missing threadId', { status: 400 });
  }

  let controllerRef: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      if (!clientsMap.has(threadId)) {
        clientsMap.set(threadId, new Set());
      }
      clientsMap.get(threadId)!.add(controller);

      // Read current content from disk and send initial sync state
      const filePath = getFilePath(threadId);
      let content = '';
      if (fs.existsSync(filePath)) {
        try {
          content = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
          console.error(`[WS Fallback API] Error reading file for thread ${threadId}:`, err);
        }
      }

      // Send initial content
      const initMessage = `event: sync\ndata: ${JSON.stringify({ type: 'sync', content })}\n\n`;
      controller.enqueue(new TextEncoder().encode(initMessage));
    },
    cancel() {
      if (controllerRef && clientsMap.has(threadId)) {
        const set = clientsMap.get(threadId)!;
        set.delete(controllerRef);
        if (set.size === 0) {
          clientsMap.delete(threadId);
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}

// POST handler to update the thread content and broadcast to active listeners
export async function POST(req: NextRequest) {
  try {
    const { threadId, content, type, immediate } = await req.json();

    if (!threadId) {
      return new Response(JSON.stringify({ error: 'Missing threadId' }), { status: 400 });
    }

    if (type === 'update') {
      const filePath = getFilePath(threadId);
      
      if (!content || content.trim() === '') {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[WS Fallback API] Deleted file for thread: ${threadId}`);
        }
      } else {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`[WS Fallback API] Saved file for thread: ${threadId} (immediate: ${immediate})`);
      }

      // Broadcast update to all other SSE clients connected to this threadId
      const targetClients = clientsMap.get(threadId);
      if (targetClients && targetClients.size > 0) {
        const updateMessage = `event: sync\ndata: ${JSON.stringify({ type: 'sync', content })}\n\n`;
        const encoded = new TextEncoder().encode(updateMessage);
        
        for (const client of targetClients) {
          try {
            client.enqueue(encoded);
          } catch (e) {
            // Client might be closed
            targetClients.delete(client);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[WS Fallback API] POST Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
