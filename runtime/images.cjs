function createMermaidImageStore() {
  const images = new Map();
  return {
    put(image) {
      const id = `img_${Math.random().toString(36).substring(2, 11)}`;
      images.set(id, image);
      return id;
    },
    png(id) {
      const image = images.get(id);
      const base64 = image?.split(";base64,").pop();
      return base64 ? Buffer.from(base64, "base64") : null;
    },
  };
}

module.exports = { createMermaidImageStore };
