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

module.exports = { LruCache };
