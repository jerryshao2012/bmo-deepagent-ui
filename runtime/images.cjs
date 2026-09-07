const { randomBytes } = require("node:crypto");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageError(message, status) {
  return Object.assign(new Error(message), { status });
}

function createMermaidImageStore({
  maxImageBytes = MAX_IMAGE_BYTES,
  maxTotalBytes = 64 * 1024 * 1024,
  capacity = 100,
  maxBytes = MAX_IMAGE_REQUEST_BYTES,
  maxEntries = capacity,
  ttlMs = 60 * 60 * 1000,
  now = Date.now,
} = {}) {
  const images = new Map();
  let totalBytes = 0;
  function remove(id) {
    const entry = images.get(id);
    if (entry) totalBytes -= entry.buffer.length;
    images.delete(id);
  }
  function expire() {
    const time = now();
    for (const [id, entry] of images) {
      if (entry.expiresAt <= time) remove(id);
    }
  }
  return {
    capacity: maxEntries,
    maxBytes,
    get size() {
      expire();
      return images.size;
    },
    put(image) {
      if (typeof image !== "string") {
        throw imageError("Image payload must be a string", 400);
      }
      if (Buffer.byteLength(image, "utf8") > maxBytes) {
        throw imageError(
          `Image payload exceeds limit of ${maxBytes} bytes`,
          413
        );
      }
      if (
        typeof image !== "string" ||
        !image.startsWith("data:image/png;base64,")
      ) {
        throw imageError("Expected a base64 PNG image", 400);
      }
      const encoded = image.slice("data:image/png;base64,".length);
      const limit = Math.min(maxImageBytes, maxTotalBytes);
      if (encoded.length > Math.ceil(limit / 3) * 4) {
        throw imageError("Image too large", 413);
      }
      const buffer = Buffer.from(encoded, "base64");
      // Canonical comparison rejects malformed padding/characters without a
      // repeated-group regex that can exhaust the stack on large uploads.
      if (!encoded || buffer.toString("base64") !== encoded) {
        throw imageError("Invalid PNG encoding", 400);
      }
      if (buffer.length > limit) throw imageError("Image too large", 413);
      if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw imageError("Expected PNG image bytes", 400);
      }
      expire();
      while (
        images.size >= maxEntries ||
        totalBytes + buffer.length > maxTotalBytes
      ) {
        const oldest = images.keys().next().value;
        if (oldest === undefined)
          throw imageError("Image store unavailable", 503);
        remove(oldest);
      }
      const id = `img_${randomBytes(16).toString("hex")}`;
      images.set(id, { buffer, expiresAt: now() + ttlMs });
      totalBytes += buffer.length;
      return id;
    },
    png(id) {
      expire();
      const entry = images.get(id);
      if (!entry) return null;
      images.delete(id);
      images.set(id, entry);
      return entry.buffer;
    },
  };
}

function handleMermaidImageRequest(req, res, store) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/store-mermaid-image" && req.method === "POST") {
    let chunks = [];
    let bytes = 0;
    let finished = false;
    const respond = (status, body) => {
      if (finished) return;
      finished = true;
      chunks = [];
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    req.on("data", (chunk) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > MAX_IMAGE_REQUEST_BYTES) {
        respond(413, { success: false, error: "Image upload too large" });
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (finished) return;
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const id = store.put(data?.image);
        respond(200, { success: true, id });
      } catch (error) {
        respond(error.status || 400, {
          success: false,
          error: "Invalid image upload",
        });
      }
    });
    req.on("error", () =>
      respond(400, { success: false, error: "Image upload interrupted" })
    );
    req.on("aborted", () => {
      finished = true;
      chunks = [];
    });
    return true;
  }
  if (pathname.startsWith("/api/mermaid-image/") && req.method === "GET") {
    const match = pathname.match(
      /^\/api\/mermaid-image\/([a-zA-Z0-9_]+)\.png$/
    );
    const buffer = match ? store.png(match[1]) : null;
    if (!buffer) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } else {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": buffer.length,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(buffer);
    }
    return true;
  }
  return false;
}

module.exports = {
  createMermaidImageStore,
  handleMermaidImageRequest,
  MAX_IMAGE_REQUEST_BYTES,
  MAX_MERMAID_IMAGE_STORE_CAPACITY: 100,
  MAX_MERMAID_IMAGE_BYTES: MAX_IMAGE_BYTES,
};
