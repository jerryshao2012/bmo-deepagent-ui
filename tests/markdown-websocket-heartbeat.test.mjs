import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

import heartbeatRuntime from "../runtime/websocket-heartbeat.cjs";

const { WEBSOCKET_HEARTBEAT_MS, installWebSocketHeartbeat } = heartbeatRuntime;

class FakeWebSocket extends EventEmitter {
  pingCount = 0;
  terminateCount = 0;

  ping() {
    this.pingCount += 1;
  }

  terminate() {
    this.terminateCount += 1;
  }
}

class FakeWebSocketServer extends EventEmitter {
  clients = new Set();

  connect(client) {
    this.clients.add(client);
    this.emit("connection", client, {});
  }
}

function installForTest(wss) {
  let tick;
  const intervalHandle = Symbol("heartbeat interval");
  const clearedHandles = [];
  const stop = installWebSocketHeartbeat(wss, {
    intervalMs: WEBSOCKET_HEARTBEAT_MS,
    setIntervalFn(callback, intervalMs) {
      assert.equal(intervalMs, 25000);
      tick = callback;
      return intervalHandle;
    },
    clearIntervalFn(handle) {
      clearedHandles.push(handle);
    },
  });

  return {
    clearedHandles,
    intervalHandle,
    stop,
    tick: () => tick(),
  };
}

test("heartbeat interval is exactly 25 seconds", () => {
  assert.equal(WEBSOCKET_HEARTBEAT_MS, 25000);
});

test("new clients start alive and pong restores liveness", () => {
  const wss = new FakeWebSocketServer();
  const heartbeat = installForTest(wss);
  const client = new FakeWebSocket();

  wss.connect(client);
  assert.equal(client.isAlive, true);

  client.isAlive = false;
  client.emit("pong");
  assert.equal(client.isAlive, true);

  heartbeat.stop();
});

test("first tick marks an alive client dead and pings it", () => {
  const wss = new FakeWebSocketServer();
  const heartbeat = installForTest(wss);
  const client = new FakeWebSocket();
  wss.connect(client);

  heartbeat.tick();

  assert.equal(client.isAlive, false);
  assert.equal(client.pingCount, 1);
  assert.equal(client.terminateCount, 0);
  heartbeat.stop();
});

test("next tick terminates an unresponsive client without pinging again", () => {
  const wss = new FakeWebSocketServer();
  const heartbeat = installForTest(wss);
  const client = new FakeWebSocket();
  wss.connect(client);

  heartbeat.tick();
  heartbeat.tick();

  assert.equal(client.pingCount, 1);
  assert.equal(client.terminateCount, 1);
  heartbeat.stop();
});

test("responsive clients survive repeated heartbeat ticks", () => {
  const wss = new FakeWebSocketServer();
  const heartbeat = installForTest(wss);
  const client = new FakeWebSocket();
  wss.connect(client);

  heartbeat.tick();
  client.emit("pong");
  heartbeat.tick();
  client.emit("pong");
  heartbeat.tick();

  assert.equal(client.pingCount, 3);
  assert.equal(client.terminateCount, 0);
  heartbeat.stop();
});

test("cleanup clears once and detaches connection and pong listeners", () => {
  const wss = new FakeWebSocketServer();
  const heartbeat = installForTest(wss);
  const client = new FakeWebSocket();
  wss.connect(client);

  assert.equal(wss.listenerCount("connection"), 1);
  assert.equal(client.listenerCount("pong"), 1);

  heartbeat.stop();
  heartbeat.stop();

  assert.deepEqual(heartbeat.clearedHandles, [heartbeat.intervalHandle]);
  assert.equal(wss.listenerCount("connection"), 0);
  assert.equal(client.listenerCount("pong"), 0);
});

test("server installs heartbeat beside WSS creation and stops it during shutdown", async () => {
  const source = await readFile("server.cjs", "utf8");

  assert.match(
    source,
    /const wss = new WebSocketServer\(\{ noServer: true \}\);\s*const stopWebSocketHeartbeat = installWebSocketHeartbeat\(wss\);/
  );
  assert.match(
    source,
    /function shutdown\(\)[\s\S]*?stopWebSocketHeartbeat\(\);[\s\S]*?client\.close\(1001, "Server shutting down"\);[\s\S]*?wss\.close\(\);/
  );
});
