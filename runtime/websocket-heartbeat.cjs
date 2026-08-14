const WEBSOCKET_HEARTBEAT_MS = 25000;

function installWebSocketHeartbeat(wss, options = {}) {
  const intervalMs = options.intervalMs ?? WEBSOCKET_HEARTBEAT_MS;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const clientListeners = new Map();
  let stopped = false;

  function detachClient(client) {
    const listeners = clientListeners.get(client);
    if (!listeners) return;

    client.off("pong", listeners.onPong);
    client.off("close", listeners.onClose);
    clientListeners.delete(client);
  }

  function onConnection(client) {
    client.isAlive = true;

    const onPong = () => {
      client.isAlive = true;
    };
    const onClose = () => {
      detachClient(client);
    };

    clientListeners.set(client, { onClose, onPong });
    client.on("pong", onPong);
    client.once("close", onClose);
  }

  wss.on("connection", onConnection);

  const interval = setIntervalFn(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }

      client.isAlive = false;
      client.ping();
    }
  }, intervalMs);

  return function stopWebSocketHeartbeat() {
    if (stopped) return;
    stopped = true;

    clearIntervalFn(interval);
    wss.off("connection", onConnection);
    for (const client of clientListeners.keys()) {
      detachClient(client);
    }
  };
}

module.exports = { WEBSOCKET_HEARTBEAT_MS, installWebSocketHeartbeat };
