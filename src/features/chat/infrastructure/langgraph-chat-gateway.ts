import type { Client } from "@langchain/langgraph-sdk";

import type {
  ChatGateway,
  ThreadSnapshot,
} from "../application/ports";

export class LangGraphChatGateway<State> implements ChatGateway<State> {
  constructor(private readonly client: Client) {}

  async getThreadSnapshot(threadId: string): Promise<ThreadSnapshot<State>> {
    const thread = await this.client.threads.get(threadId);
    return {
      updatedAt: thread.updated_at,
      values: thread.values as State | undefined,
    };
  }

  async updateFiles(
    threadId: string,
    files: Record<string, unknown>
  ): Promise<void> {
    await this.client.threads.updateState(threadId, { values: { files } });
  }
}
