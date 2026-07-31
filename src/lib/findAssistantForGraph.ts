import type { Assistant, Metadata } from "@langchain/langgraph-sdk";

type AssistantSearchQuery = {
  graphId: string;
  metadata?: Metadata;
  limit: number;
};

type AssistantSearchClient = {
  assistants: {
    search: (query: AssistantSearchQuery) => Promise<Assistant[]>;
  };
};

export async function findAssistantForGraph(
  client: AssistantSearchClient,
  graphId: string
): Promise<Assistant | undefined> {
  const systemAssistants = await client.assistants.search({
    graphId,
    metadata: { created_by: "system" },
    limit: 1,
  });

  if (systemAssistants[0]) {
    return systemAssistants[0];
  }

  const assistants = await client.assistants.search({ graphId, limit: 1 });
  return assistants[0];
}
