import type { ProcessedMessage } from "@/app/utils/processMessages";

export function selectParallelResearchProgress(
  messages: ProcessedMessage[]
): { completed: number; total: number } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const researchCalls = messages[index].toolCalls.filter(
      (call) =>
        call.name === "task" && call.args.subagent_type === "research-agent"
    );

    if (researchCalls.length < 2) continue;
    if (!researchCalls.some((call) => call.status === "pending")) return null;

    return {
      completed: researchCalls.filter((call) => call.status === "completed")
        .length,
      total: researchCalls.length,
    };
  }

  return null;
}
