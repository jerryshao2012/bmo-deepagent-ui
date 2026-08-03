const fs = require("fs");
const path = require("path");

function createMarkdownPersistence(storageDir) {
  fs.mkdirSync(storageDir, { recursive: true });
  const filePath = (markdownId) =>
    path.join(storageDir, `${markdownId.replace(/[^a-zA-Z0-9_-]/g, "")}.md`);
  return {
    load(markdownId) {
      const target = filePath(markdownId);
      return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    },
    save(markdownId, content) {
      const target = filePath(markdownId);
      if (content && content.trim()) fs.writeFileSync(target, content, "utf8");
      else if (fs.existsSync(target)) fs.unlinkSync(target);
    },
  };
}

module.exports = { createMarkdownPersistence };
