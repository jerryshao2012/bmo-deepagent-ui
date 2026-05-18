const { createServer } = require("http");
const next = require("next");
const { WebSocketServer } = require("ws");
const { parse } = require("url");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = process.env.PORT || 3000;
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Create WebSocket Server
  const wss = new WebSocketServer({ noServer: true });

  // Group clients by thread ID
  const rooms = new Map(); // Map<threadId, Set<WebSocket>>
  const roomContent = new Map(); // Map<threadId, string>

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

    // Initial sync
    if (roomContent.has(threadId)) {
      ws.send(
        JSON.stringify({ type: "sync", content: roomContent.get(threadId) })
      );
    } else {
      ws.send(JSON.stringify({ type: "sync", content: "" }));
    }

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === "update") {
          roomContent.set(threadId, data.content);

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
