import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import images from "../runtime/images.cjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64"
);
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

test("stores and retrieves PNG bytes", () => {
  const store = images.createMermaidImageStore();
  assert.deepEqual(store.png(store.put(dataUrl)), png);
  assert.equal(store.png("missing"), null);
});

for (const value of [
  null,
  42,
  {},
  "",
  "data:image/svg+xml;base64,PHN2Zy8+",
  "data:image/png;base64,dGV4dA==",
  "data:image/png;base64,@@@@",
]) {
  test(`rejects malformed PNG ${JSON.stringify(value)}`, () => {
    const store = images.createMermaidImageStore();
    assert.throws(
      () => store.put(value),
      (error) => error.status === 400
    );
  });
}

test("rejects decoded image larger than per-image limit", () => {
  const store = images.createMermaidImageStore({
    maxImageBytes: png.length - 1,
  });
  assert.throws(
    () => store.put(dataUrl),
    (error) => error.status === 413
  );
});

test("evicts oldest entries when entry capacity reached", () => {
  const store = images.createMermaidImageStore({ maxEntries: 2 });
  const first = store.put(dataUrl);
  const second = store.put(dataUrl);
  const third = store.put(dataUrl);
  assert.equal(store.png(first), null);
  assert.deepEqual(store.png(second), png);
  assert.deepEqual(store.png(third), png);
});

test("bounds total retained bytes independently of entry count", () => {
  const store = images.createMermaidImageStore({
    maxTotalBytes: png.length * 2,
    maxEntries: 100,
  });
  const first = store.put(dataUrl);
  store.put(dataUrl);
  const last = store.put(dataUrl);
  assert.equal(store.png(first), null);
  assert.deepEqual(store.png(last), png);
});

test("expires images on retrieval without requiring another upload", () => {
  let now = 0;
  const store = images.createMermaidImageStore({ ttlMs: 100, now: () => now });
  const id = store.put(dataUrl);
  now = 100;
  assert.equal(store.png(id), null);
});

function exchange(store, method, url, chunks = []) {
  const req = Object.assign(new EventEmitter(), { method, url });
  const result = { status: 0, headers: {}, body: undefined, ends: 0 };
  const res = {
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers;
    },
    end(body) {
      result.body = body;
      result.ends += 1;
    },
  };
  assert.equal(images.handleMermaidImageRequest(req, res, store), true);
  for (const chunk of chunks) req.emit("data", Buffer.from(chunk));
  req.emit("end");
  return result;
}

test("HTTP handler rejects malformed uploads and serves valid PNG", () => {
  const store = images.createMermaidImageStore();
  assert.equal(
    exchange(store, "POST", "/api/store-mermaid-image", ['{"image":{}}'])
      .status,
    400
  );
  const uploaded = exchange(store, "POST", "/api/store-mermaid-image", [
    JSON.stringify({ image: dataUrl }),
  ]);
  assert.equal(uploaded.status, 200);
  const id = JSON.parse(uploaded.body).id;
  const downloaded = exchange(store, "GET", `/api/mermaid-image/${id}.png`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.body, png);
  assert.equal(downloaded.headers["Content-Type"], "image/png");
  assert.equal(
    exchange(store, "GET", "/api/mermaid-image/missing.png").status,
    404
  );
});

test("HTTP handler caps chunked bodies without trusting Content-Length", () => {
  const store = images.createMermaidImageStore();
  const response = exchange(store, "POST", "/api/store-mermaid-image", [
    "x".repeat(images.MAX_IMAGE_REQUEST_BYTES),
    "x",
    "more",
  ]);
  assert.equal(response.status, 413);
  assert.equal(response.ends, 1);
});

test("accepts a large valid PNG encoding without regex stack overflow", () => {
  const large = Buffer.alloc(5 * 1024 * 1024);
  png.copy(large);
  const store = images.createMermaidImageStore();
  assert.deepEqual(
    store.png(store.put(`data:image/png;base64,${large.toString("base64")}`)),
    large
  );
});
