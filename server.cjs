const { createServer } = require("http");
const next = require("next");
const { WebSocketServer } = require("ws");
const {
  installWebSocketHeartbeat,
} = require("./runtime/websocket-heartbeat.cjs");
const { runtimeConfig } = require("./runtime/bootstrap.cjs");
const { broadcastJson, sendJson } = require("./runtime/transport.cjs");
const {
  isValidMarkdownId,
  resolveInitialMarkdown,
  resolveServerMarkdown,
} = require("./runtime/state.cjs");
const { createMarkdownPersistence } = require("./runtime/persistence.cjs");
const { createMermaidImageStore } = require("./runtime/images.cjs");

const { dev, port } = runtimeConfig();
const hostname = process.env.HOST || "0.0.0.0";
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Temporary in-memory store for exported Mermaid PNG images
  const mermaidImages = new Map();

  const server = createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // Route to store base64 Mermaid image
    if (pathname === "/api/store-mermaid-image" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (!data || !data.image) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "Missing image payload" }));
            return;
          }
          const imageId = `img_${Math.random().toString(36).substring(2, 11)}`;
          mermaidImages.set(imageId, data.image);
          console.log(`[Image Store] Cached exported diagram as: ${imageId}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, id: imageId }));
        } catch (e) {
          console.error("[Image Store] Error storing diagram image:", e);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

    // Route to serve binary PNG to Word/Outlook
    if (
      pathname &&
      pathname.startsWith("/api/mermaid-image/") &&
      req.method === "GET"
    ) {
      const match = pathname.match(
        /^\/api\/mermaid-image\/([a-zA-Z0-9_]+)\.png$/
      );
      if (match) {
        const imageId = match[1];
        const imageData = mermaidImages.get(imageId);
        if (imageData) {
          console.log(`[Image Serve] Serving binary PNG for: ${imageId}`);
          const base64Content = imageData.split(";base64,").pop();
          if (base64Content) {
            const buffer = Buffer.from(base64Content, "base64");
            res.writeHead(200, {
              "Content-Type": "image/png",
              "Content-Length": buffer.length,
              "Cache-Control": "public, max-age=3600",
            });
            res.end(buffer);
            return;
          }
        }
      }
      console.warn(
        `[Image Serve] Diagram image not found or invalid: ${pathname}`
      );
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    handle(req, res);
  });

  const fs = require("fs");
  const path = require("path");

  // App Service run-from-package is read-only; use its persistent /home storage.
  const STORAGE_DIR =
    process.env.MARKDOWN_STORAGE_DIR ||
    path.join(__dirname, "data", "markdown_threads");
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  function getFilePath(threadId) {
    const safeThreadId = threadId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(STORAGE_DIR, `${safeThreadId}.md`);
  }

  // Batch save mechanism - store pending updates and flush periodically
  const pendingSaves = new Map(); // Map<threadId, { content: string, lastUpdated: number }>
  const BATCH_SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

  // Debounce timers for immediate flush (1-2 second delay)
  const debounceTimers = new Map(); // Map<threadId, NodeJS.Timeout>
  const DEBOUNCE_DELAY = 1500; // 1.5 seconds

  function scheduleBatchSave(threadId, content) {
    // Update or create pending save entry
    pendingSaves.set(threadId, {
      content,
      lastUpdated: Date.now(),
    });

    // Clear existing debounce timer if any
    if (debounceTimers.has(threadId)) {
      clearTimeout(debounceTimers.get(threadId));
    }

    // Set up debounced immediate flush
    const timer = setTimeout(() => {
      console.log(`[WS Debounce] Flushing thread ${threadId} after ${DEBOUNCE_DELAY}ms`);
      const pendingData = pendingSaves.get(threadId);
      if (pendingData) {
        try {
          const filePath = getFilePath(threadId);
          const fileContent = pendingData.content;

          // Empty files are persisted deletion tombstones. This prevents a
          // stale browser cache from recreating content after server restart.
          fs.writeFileSync(filePath, fileContent, "utf8");
          console.log(
            `[WS Debounce] Content saved. Wrote file for thread: ${threadId}`
          );

          // Remove from pending saves since we just flushed it
          pendingSaves.delete(threadId);
        } catch (err) {
          console.error(
            `[WS Debounce] Error writing file for thread ${threadId}:`,
            err
          );
        }
      }
      debounceTimers.delete(threadId);
    }, DEBOUNCE_DELAY);

    debounceTimers.set(threadId, timer);
  }

  function flushPendingSaves() {
    if (pendingSaves.size === 0) {
      return;
    }

    console.log(`[WS Batch] Flushing ${pendingSaves.size} pending save(s)...`);

    const savesToFlush = new Map(pendingSaves);

    for (const [threadId, data] of savesToFlush.entries()) {
      try {
        const filePath = getFilePath(threadId);
        const content = data.content;

        fs.writeFileSync(filePath, content, "utf8");
        console.log(
          `[WS Batch] Content saved. Wrote file for thread: ${threadId}`
        );

        // Remove from pending if it hasn't been updated since we started flushing
        const current = pendingSaves.get(threadId);
        if (current && current.lastUpdated === data.lastUpdated) {
          pendingSaves.delete(threadId);
        }
      } catch (err) {
        console.error(
          `[WS Batch] Error writing file for thread ${threadId}:`,
          err
        );
      }
    }
  }

  // Set up periodic batch save interval (for remaining unsaved items)
  const batchSaveInterval = setInterval(flushPendingSaves, BATCH_SAVE_INTERVAL);

  function loadThreadContent(threadId) {
    const filePath = getFilePath(threadId);
    if (fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch (err) {
        console.error(`[WS] Error reading file for thread ${threadId}:`, err);
      }
    }
    return null;
  }

  // Simple fixed-sized LRU cache to reduce disk data access
  class LRUCache {
    constructor(capacity = 200) {
      this.capacity = capacity;
      this.cache = new Map();
    }

    get(key) {
      if (!this.cache.has(key)) return undefined;
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }

    has(key) {
      return this.cache.has(key);
    }

    set(key, value) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
      } else if (this.cache.size >= this.capacity) {
        // Evict oldest (least recently used) item
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
        console.log(`[WS Cache] Evicted thread from cache: ${oldestKey}`);
      }
      this.cache.set(key, value);
    }

    delete(key) {
      return this.cache.delete(key);
    }
  }

  // ── Shared state bridge for SSE fallback ──────────────────────────────
  // These globals allow the ws-fallback API route to share state with the
  // WebSocket server so that clients on different transports stay in sync.
  if (!globalThis.__sseThreadStore) {
    globalThis.__sseThreadStore = new Map();
  }
  if (!globalThis.__sseSubscribers) {
    globalThis.__sseSubscribers = new Map();
  }

  // Create WebSocket Server
  const wss = new WebSocketServer({ noServer: true });
  const stopWebSocketHeartbeat = installWebSocketHeartbeat(wss);

  // Group clients by thread ID
  const rooms = new Map(); // Map<threadId, Set<WebSocket>>
  const roomContent = new LRUCache(200); // Thread Cache (max 200 active threads)

  // One authoritative read path for WebSocket initialization and HTTP
  // fallback. Pending writes, including empty deletion tombstones, must win
  // over disk until the debounce flush completes.
  globalThis.__sseLoad = (threadId) => {
    if (!isValidMarkdownId(threadId)) {
      return { content: "", exists: false, readable: true };
    }

    const cachedContent = roomContent.has(threadId)
      ? roomContent.get(threadId)
      : undefined;
    const pendingContent = pendingSaves.has(threadId)
      ? pendingSaves.get(threadId).content
      : undefined;
    const shouldReadDisk =
      cachedContent === undefined && pendingContent === undefined;
    const diskExists = shouldReadDisk && fs.existsSync(getFilePath(threadId));
    const diskContent = diskExists ? loadThreadContent(threadId) : undefined;
    const state = resolveServerMarkdown(
      cachedContent,
      pendingContent,
      diskContent,
      diskExists
    );

    if (!state.readable) return state;

    if (!state.exists) {
      globalThis.__sseThreadStore.delete(threadId);
      roomContent.delete(threadId);
    } else {
      globalThis.__sseThreadStore.set(threadId, state.content);
      roomContent.set(threadId, state.content);
    }

    return state;
  };

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[WS] Graceful shutdown - flushing pending saves...");

    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();
    flushPendingSaves();
    clearInterval(batchSaveInterval);
    stopWebSocketHeartbeat();

    for (const clients of rooms.values()) {
      for (const client of clients) {
        client.close(1001, "Server shutting down");
      }
    }
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  // Bidirectional bridge: notifies both SSE subscribers AND WebSocket
  // clients in the same thread.  Called from the SSE POST handler as well
  // as from the WebSocket message handler so both transports stay in sync.
  globalThis.__sseNotify = (threadId, content, immediate = false) => {
    const normalizedContent = typeof content === "string" ? content : "";
    globalThis.__sseThreadStore.set(threadId, normalizedContent);
    roomContent.set(threadId, normalizedContent);

    if (immediate) {
      try {
        fs.writeFileSync(getFilePath(threadId), normalizedContent, "utf8");
        pendingSaves.delete(threadId);
        if (debounceTimers.has(threadId)) {
          clearTimeout(debounceTimers.get(threadId));
          debounceTimers.delete(threadId);
        }
      } catch (err) {
        console.error(
          `[WS Immediate] Error writing file for thread ${threadId}:`,
          err
        );
      }
    } else {
      scheduleBatchSave(threadId, normalizedContent);
    }

    const payload = JSON.stringify({ type: "sync", content: normalizedContent });

    // Push to SSE subscribers
    const subs = globalThis.__sseSubscribers.get(threadId);
    if (subs && subs.size > 0) {
      const message = `event: sync\ndata: ${payload}\n\n`;
      const encoded = Buffer.from(message);
      for (const sub of subs) {
        try {
          sub.controller.enqueue(encoded);
        } catch {
          subs.delete(sub);
        }
      }
      if (subs.size === 0) globalThis.__sseSubscribers.delete(threadId);
    }

    // Broadcast to WebSocket clients
    const clients = rooms.get(threadId);
    if (clients && clients.size > 0) {
      for (const client of clients) {
        if (client.readyState === 1) {
          // 1 = WebSocket.OPEN
          try {
            client.send(payload);
          } catch {
            // Client is unreachable — will be cleaned up on close event
          }
        }
      }
    }

    console.log(
      `[WS↔SSE Bridge] Synced thread ${threadId} (content ${normalizedContent.length} bytes)`
    );
  };

  const nextUpgradeHandler = app.getUpgradeHandler();

  server.on("upgrade", (request, socket, head) => {
    const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (pathname === "/api/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else if (pathname && pathname.startsWith("/_next")) {
      nextUpgradeHandler(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, request) => {
    const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
    const threadId = parsedUrl.searchParams.get("threadId");

    if (!isValidMarkdownId(threadId)) {
      ws.close(1008, "Invalid threadId");
      return;
    }

    if (!rooms.has(threadId)) {
      rooms.set(threadId, new Set());
    }
    rooms.get(threadId).add(ws);

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === "init") {
          const serverState = globalThis.__sseLoad(threadId);
          if (!serverState.readable) {
            ws.close(1011, "Unable to load thread");
            return;
          }

          // Persisted server state is authoritative. Browser cache only seeds
          // a thread that has never existed in memory or on disk.
          const resolved = resolveInitialMarkdown(
            serverState.content,
            data.content,
            serverState.exists
          );
          const currentContent = resolved.content;

          if (resolved.seededFromClient) {
            roomContent.set(threadId, currentContent);
            globalThis.__sseThreadStore.set(threadId, currentContent);
            scheduleBatchSave(threadId, currentContent);

            // Bring already-connected clients into the newly seeded state.
            const clients = rooms.get(threadId);
            if (clients) {
              for (const client of clients) {
                if (client !== ws && client.readyState === 1) {
                  client.send(
                    JSON.stringify({ type: "sync", content: currentContent })
                  );
                }
              }
            }
          }

          // Acknowledge by sending the resolved sync state to this connecting client
          ws.send(
            JSON.stringify({
              type: "sync",
              content: currentContent,
              initial: true,
            })
          );
        }

        if (data.type === "update" && typeof data.content === "string") {
          // Update shared storage and push to both WebSocket and SSE clients.
          if (typeof globalThis.__sseNotify === "function") {
            globalThis.__sseNotify(
              threadId,
              data.content || "",
              data.immediate === true
            );
          }
        }
      } catch (err) {
        console.error("WS Message handling error:", err);
      }
    });

    ws.on("close", () => {
      const clients = rooms.get(threadId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          rooms.delete(threadId);
        }
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
