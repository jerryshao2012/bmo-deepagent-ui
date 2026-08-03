export interface MarkdownSyncState {
  version: number;
  content: string;
  pendingWrite: string | null;
  lastSynced: string | null;
}

export function editMarkdown(
  state: MarkdownSyncState,
  content: string
): MarkdownSyncState {
  return { ...state, version: state.version + 1, content, pendingWrite: content };
}

export function acceptRemoteMarkdown(
  state: MarkdownSyncState,
  remote: string,
  requestVersion: number
): MarkdownSyncState {
  if (
    requestVersion !== state.version ||
    state.pendingWrite !== null ||
    !remote ||
    remote === state.content ||
    remote === state.lastSynced
  ) {
    return state;
  }
  return {
    ...state,
    version: state.version + 1,
    content: remote,
    lastSynced: remote,
  };
}

export function confirmMarkdownWrite(
  state: MarkdownSyncState,
  content: string
): MarkdownSyncState {
  return {
    ...state,
    lastSynced: content,
    pendingWrite: state.pendingWrite === content ? null : state.pendingWrite,
  };
}
