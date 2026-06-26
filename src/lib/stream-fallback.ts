import { fetchEventSource } from '@microsoft/fetch-event-source';

export interface AgentConnectionOptions {
  threadId: string;
  inputMessage: string;
  onUpdate: (data: any) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'fallback') => void;
  onError?: (error: any) => void;
}

/**
 * Connects to the Deep Research agent, trying WebSockets first, and automatically
 * falling back to HTTP Streaming (Server-Sent Events) via Vercel Edge API route if WS fails.
 */
export function connectToAgent({
  threadId,
  inputMessage,
  onUpdate,
  onStatusChange,
  onError,
}: AgentConnectionOptions) {
  // Construct WebSocket connection
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/api/ws?threadId=${threadId}`;

  console.log('[Connection Manager] Attempting WebSocket connection:', wsUrl);
  onStatusChange?.('connecting');

  let socket: WebSocket | null = new WebSocket(wsUrl);
  let wsFailed = false;

  socket.onopen = () => {
    console.log('[Connection Manager] WebSocket connected.');
    onStatusChange?.('connected');
    socket?.send(JSON.stringify({ type: 'init', content: inputMessage }));
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onUpdate(data);
    } catch (err) {
      console.error('[Connection Manager] WebSocket message parse error:', err);
    }
  };

  socket.onerror = (error) => {
    console.error('[Connection Manager] WebSocket error, initiating HTTP Streaming (SSE) fallback:', error);
    wsFailed = true;
    socket?.close();
    onStatusChange?.('fallback');
    initiateHttpStreaming(threadId, inputMessage, onUpdate, onError);
  };

  socket.onclose = () => {
    if (!wsFailed) {
      console.log('[Connection Manager] WebSocket closed cleanly.');
      onStatusChange?.('disconnected');
    }
  };

  // Return a cleanup/disconnect function
  return () => {
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      socket = null;
    }
  };
}

/**
 * Fallback function that initiates Server-Sent Events (SSE) streaming
 * via our Next.js /api/stream proxy.
 */
async function initiateHttpStreaming(
  threadId: string,
  inputMessage: string,
  onUpdate: (data: any) => void,
  onError?: (error: any) => void
) {
  const ctrl = new AbortController();

  try {
    console.log('[Connection Manager] Starting HTTP stream fallback...');
    await fetchEventSource('/api/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId,
        input: {
          messages: [{ role: 'user', content: inputMessage }]
        }
      }),
      signal: ctrl.signal,
      async onopen(response) {
        if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
          console.log('[Connection Manager] HTTP streaming connection opened.');
          return;
        } else {
          throw new Error(`Failed to initialize stream: server returned ${response.status}`);
        }
      },
      onmessage(msg) {
        if (msg.event === 'values' || !msg.event) {
          try {
            const data = JSON.parse(msg.data);
            onUpdate(data);
          } catch (e) {
            console.error('[Connection Manager] Failed to parse SSE message data:', e);
          }
        }
      },
      onclose() {
        console.log('[Connection Manager] HTTP stream connection closed.');
      },
      onerror(err) {
        console.error('[Connection Manager] HTTP streaming error:', err);
        onError?.(err);
        // Throw to let fetchEventSource retry or handle it
        throw err;
      }
    });
  } catch (error) {
    console.error('[Connection Manager] HTTP Streaming Exception:', error);
    onError?.(error);
  }

  // Return cancel function
  return () => {
    ctrl.abort();
  };
}
