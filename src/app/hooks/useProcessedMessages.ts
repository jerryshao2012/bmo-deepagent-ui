import { useMemo } from "react";
import type { Message } from "@langchain/langgraph-sdk";
import { processMessages } from "@/app/utils/processMessages";

export function useProcessedMessages(
  messages: Message[],
  interrupt: unknown
) {
  return useMemo(
    () => processMessages(messages, Boolean(interrupt)),
    [messages, interrupt]
  );
}
