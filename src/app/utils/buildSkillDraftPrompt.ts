import type { SkillItem } from "@/lib/skills";
import type { TodoItem } from "@/app/types/types";

interface Message {
  type: string;
  content: any;
}

interface DraftContext {
  messages: Message[];
  todos: TodoItem[];
  files: Record<string, unknown>;
  documents: Array<{ name: string; size: number }>;
}

export function buildSkillDraftPrompt(skill: SkillItem, ctx: DraftContext): string {
  const parts: string[] = [];

  parts.push(`Use the "${skill.name}" skill. ${skill.description}`);

  const hasMessages = ctx.messages && ctx.messages.length > 0;
  const hasTodos = ctx.todos && ctx.todos.length > 0;
  const hasFiles = ctx.files && Object.keys(ctx.files).length > 0;
  const hasDocs = ctx.documents && ctx.documents.length > 0;

  if (hasMessages || hasTodos || hasFiles || hasDocs) {
    parts.push("\nThread context:");

    if (hasMessages) {
      const humanMsgs = ctx.messages.filter((m) => m.type === "human");
      if (humanMsgs.length > 0) {
        parts.push("- Recent messages:");
        humanMsgs.slice(-3).forEach((m) => {
          let text = "";
          if (typeof m.content === "string") {
            text = m.content;
          } else if (Array.isArray(m.content)) {
            text = m.content.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" ");
          } else if (m.content) {
            text = JSON.stringify(m.content);
          }
          const cleanText = text.replace(/\s+/g, " ").trim();
          const truncated = cleanText.length > 80 ? cleanText.substring(0, 80) + "..." : cleanText;
          parts.push(`  * "${truncated}"`);
        });
      }
    }

    if (hasTodos) {
      const completed = ctx.todos.filter((t) => t.status === "completed").length;
      const total = ctx.todos.length;
      parts.push(`- Tasks: ${completed}/${total} completed`);
    }

    if (hasFiles) {
      const fileNames = Object.keys(ctx.files).join(", ");
      parts.push(`- State files: ${fileNames}`);
    }

    if (hasDocs) {
      const docNames = ctx.documents.map((d) => d.name).join(", ");
      parts.push(`- Uploaded documents: ${docNames}`);
    }
  }

  parts.push("\nUse the existing thread State files and uploaded documents rather than asking me to re-upload materials.");

  return parts.join("\n");
}
