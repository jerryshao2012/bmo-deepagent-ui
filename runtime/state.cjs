class LruCache {
  constructor(capacity = 200) {
    this.capacity = capacity;
    this.values = new Map();
  }

  get(key) {
    if (!this.values.has(key)) return undefined;
    const value = this.values.get(key);
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.values.has(key)) this.values.delete(key);
    else if (this.values.size >= this.capacity) {
      this.values.delete(this.values.keys().next().value);
    }
    this.values.set(key, value);
  }
}

function isValidMarkdownId(markdownId) {
  return typeof markdownId === "string" && /^\d{6}$/.test(markdownId);
}

function resolveInitialMarkdown(serverContent, clientContent, serverExists) {
  const persisted = typeof serverContent === "string" ? serverContent : "";
  const cached = typeof clientContent === "string" ? clientContent : "";
  const hasServerState =
    typeof serverExists === "boolean"
      ? serverExists
      : typeof serverContent === "string" && persisted.trim() !== "";
  const seededFromClient = !hasServerState && cached.trim() !== "";

  return {
    content: seededFromClient ? cached : persisted,
    seededFromClient,
  };
}

function resolveServerMarkdown(
  cacheContent,
  pendingContent,
  diskContent,
  diskExists = false
) {
  if (typeof cacheContent === "string") {
    return { content: cacheContent, exists: true, readable: true };
  }
  if (typeof pendingContent === "string") {
    return { content: pendingContent, exists: true, readable: true };
  }
  if (diskExists) {
    if (typeof diskContent !== "string") {
      return { content: "", exists: true, readable: false };
    }
    return {
      content: diskContent,
      exists: true,
      readable: true,
    };
  }
  return { content: "", exists: false, readable: true };
}

module.exports = {
  LruCache,
  isValidMarkdownId,
  resolveInitialMarkdown,
  resolveServerMarkdown,
};
