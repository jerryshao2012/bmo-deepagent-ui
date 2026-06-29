import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'edge'; // Use edge runtime for better streaming support

/**
 * GET handler for Server-Sent Events (SSE) fallback when WebSocket is unavailable.
 * Streams the agent response back to the client via SSE.
 *
 * Expected query parameters:
 * - threadId: The ID of the thread to stream from
 * - input (optional): The input to send to the agent
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('threadId');

  if (!threadId) {
    return new Response('Missing threadId', { status: 400 });
  }

  try {
    // Get backend configuration
    const backendHost = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_LANGGRAPH_URL || 'http://localhost:2024';
    const cleanBackendHost = backendHost.replace(/\/+$/, "");
    const backendUrl = `${cleanBackendHost}/threads/${threadId}/runs/stream`;

    console.log(`[WS Fallback] Proxying SSE stream for thread ${threadId} to backend: ${backendUrl}`);

    // Make request to backend streaming endpoint
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.UPLOAD_API_KEY || process.env.LANGGRAPH_API_KEY || '',
      },
      // Send empty run config if no input provided
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[WS Fallback] Backend error (status ${response.status}): ${errorText}`);
      return new Response(
        `event: error\ndata: ${JSON.stringify({ error: `Backend error: ${response.status} - ${errorText}` })}\n\n`,
        {
          status: 200, // Keep status 200 so SSE connection opens but sends error event
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
          }
        }
      );
    }

    // Stream the response directly
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[WS Fallback] Internal server error:', error);
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`,
      {
        status: 200, // Keep status 200 so client doesn't retry immediately
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        }
      }
    );
  }
}
