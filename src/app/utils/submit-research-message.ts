export interface PendingDocumentFolder {
  threadId: string;
  docFolder: string;
}

export interface SubmitResearchMessageOptions<Result> {
  message: string;
  noWeb: boolean;
  availability: boolean | null;
  threadId: string | null;
  pendingDocument?: PendingDocumentFolder;
  sendMessage: (
    message: string,
    stateUpdates: Record<string, unknown>
  ) => Result;
}

export function submitResearchMessage<Result>({
  message,
  noWeb,
  availability,
  threadId,
  pendingDocument,
  sendMessage,
}: SubmitResearchMessageOptions<Result>): Result {
  const stateUpdates: Record<string, unknown> = { no_web: noWeb };

  if (availability === false) {
    stateUpdates.has_documents = false;
    stateUpdates.doc_folder = null;
  } else if (availability === true) {
    stateUpdates.has_documents = true;
    if (threadId) {
      stateUpdates.doc_folder = `docs/threads/${threadId}`;
    }
  } else if (pendingDocument?.threadId === threadId) {
    stateUpdates.doc_folder = pendingDocument.docFolder;
    stateUpdates.has_documents = true;
  }

  return sendMessage(message, stateUpdates);
}
