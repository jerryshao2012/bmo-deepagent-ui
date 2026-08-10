export interface MarkdownSyncState {
  version: number;
  content: string;
  pendingWrite: string | null;
  lastSynced: string | null;
}

export const BACKEND_MIRROR_BASE_RETRY_MS = 4_000;
export const BACKEND_MIRROR_MAX_RETRY_MS = 60_000;

export function backendMirrorRetryDelay(consecutiveFailures: number): number {
  const exponent = Math.max(0, Math.floor(consecutiveFailures) - 1);
  return Math.min(
    BACKEND_MIRROR_MAX_RETRY_MS,
    BACKEND_MIRROR_BASE_RETRY_MS * 2 ** exponent
  );
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
