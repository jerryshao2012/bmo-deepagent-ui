// src/app/api/stream/route.ts (Next.js App Router style)
import { NextRequest } from 'next/server';

export const runtime = 'edge'; // Edge runtime is ideal for streaming on Vercel

export async function POST(req: NextRequest) {
  try {
    const { threadId, ...body } = await req.json();
    
    // Fall back to NEXT_PUBLIC_LANGGRAPH_URL or localhost if BACKEND_API_URL is not set
    const backendHost = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_LANGGRAPH_URL || 'http://localhost:2024';
    const cleanBackendHost = backendHost.replace(/\/+$/, "");
    const backendUrl = `${cleanBackendHost}/threads/${threadId}/runs/stream`;

    console.log(`[Stream Proxy] Proxying thread ${threadId} to backend: ${backendUrl}`);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.UPLOAD_API_KEY || process.env.LANGGRAPH_API_KEY || '',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[Stream Proxy] Backend error response (status ${response.status}): ${errorText}`);
      return new Response(`Failed to connect to agent backend: ${errorText}`, { status: response.status });
    }

    // Forward the ReadableStream directly to the frontend
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[Stream Proxy] Internal server error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
