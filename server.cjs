const { createServer } = require("http");
const next = require("next");
const { WebSocketServer } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || 3000;
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
          
          if (!fileContent || fileContent.trim() === "") {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(
                `[WS Debounce] Content removed. Deleted file for thread: ${threadId}`
              );
            }
          } else {
            fs.writeFileSync(filePath, fileContent, "utf8");
            console.log(
              `[WS Debounce] Content saved. Wrote file for thread: ${threadId}`
            );
          }
          
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

        if (!content || content.trim() === "") {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(
              `[WS Batch] Content removed. Deleted file for thread: ${threadId}`
            );
          }
        } else {
          fs.writeFileSync(filePath, content, "utf8");
          console.log(
            `[WS Batch] Content saved. Wrote file for thread: ${threadId}`
          );
        }

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

  // Group clients by thread ID
  const rooms = new Map(); // Map<threadId, Set<WebSocket>>
  const roomContent = new LRUCache(200); // Thread Cache (max 200 active threads)

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
  globalThis.__sseNotify = (threadId, content) => {
    const payload = JSON.stringify({ type: "sync", content });

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
      `[WS↔SSE Bridge] Synced thread ${threadId} (content ${content.length} bytes)`
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

    if (!threadId) {
      ws.close();
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
          // Resolve thread content from memory or disk
          let currentContent = "";
          if (roomContent.has(threadId)) {
            currentContent = roomContent.get(threadId);
          } else {
            const diskContent = loadThreadContent(threadId);
            if (diskContent !== null) {
              currentContent = diskContent;
              roomContent.set(threadId, diskContent);
            }
          }

          // If client has offline changes (non-empty) that differ from what we have, let client win
          if (
            data.content &&
            data.content.trim() !== "" &&
            data.content !== currentContent
          ) {
            currentContent = data.content;
            roomContent.set(threadId, currentContent);
            // Schedule for batch save instead of immediate save
            scheduleBatchSave(threadId, currentContent);

            // Broadcast the update to any other connected clients in the same thread
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
          ws.send(JSON.stringify({ type: "sync", content: currentContent }));
        }

        if (data.type === "update") {
          if (!data.content || data.content.trim() === "") {
            roomContent.delete(threadId);
          } else {
            roomContent.set(threadId, data.content);
          }
          
          // Check if immediate save is requested
          if (data.immediate === true && data.content && data.content.trim() !== "") {
            // Save immediately without debounce delay
            console.log(`[WS Immediate] Saving thread ${threadId} immediately`);
            try {
              const filePath = getFilePath(threadId);
              fs.writeFileSync(filePath, data.content, "utf8");
              console.log(
                `[WS Immediate] Content saved. Wrote file for thread: ${threadId}`
              );
              // Remove from pending saves since we just flushed it
              pendingSaves.delete(threadId);
              // Clear any existing debounce timer
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
            // Schedule for batch save with debounce
            scheduleBatchSave(threadId, data.content);
          }

          // Broadcast to all other clients with the same thread ID
          const clients = rooms.get(threadId);
          if (clients) {
            for (const client of clients) {
              if (client !== ws && client.readyState === 1) {
                // 1 = OPEN
                client.send(
                  JSON.stringify({ type: "sync", content: data.content })
                );
              }
            }
          }

          // Push to SSE fallback subscribers so both transports stay in sync
          if (typeof globalThis.__sseNotify === "function") {
            globalThis.__sseNotify(threadId, data.content || "");
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
