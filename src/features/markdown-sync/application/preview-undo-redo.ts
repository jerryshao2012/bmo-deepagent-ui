export interface MarkdownUndoHistoryState {
  past: string[];
  present: string;
  future: string[];
}

export function createMarkdownUndoHistory(initialText = ""): MarkdownUndoHistoryState {
  return {
    past: [],
    present: initialText,
    future: [],
  };
}

export function pushMarkdownUndoState(
  history: MarkdownUndoHistoryState,
  nextText: string,
  maxHistory = 100
): MarkdownUndoHistoryState {
  if (nextText === history.present) {
    return history;
  }
  const nextPast = [...history.past, history.present];
  if (nextPast.length > maxHistory) {
    nextPast.splice(0, nextPast.length - maxHistory);
  }
  return {
    past: nextPast,
    present: nextText,
    future: [],
  };
}

export function undoMarkdownHistory(
  history: MarkdownUndoHistoryState
): { nextHistory: MarkdownUndoHistoryState; text: string } | null {
  if (history.past.length === 0) {
    return null;
  }
  const previous = history.past[history.past.length - 1];
  const nextPast = history.past.slice(0, -1);
  return {
    nextHistory: {
      past: nextPast,
      present: previous,
      future: [history.present, ...history.future],
    },
    text: previous,
  };
}

export function redoMarkdownHistory(
  history: MarkdownUndoHistoryState
): { nextHistory: MarkdownUndoHistoryState; text: string } | null {
  if (history.future.length === 0) {
    return null;
  }
  const next = history.future[0];
  const nextFuture = history.future.slice(1);
  return {
    nextHistory: {
      past: [...history.past, history.present],
      present: next,
      future: nextFuture,
    },
    text: next,
  };
}

export function isMarkdownUndoShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  const isModifier = event.ctrlKey || event.metaKey;
  return isModifier && !event.shiftKey && event.key.toLowerCase() === "z";
}

export function isMarkdownRedoShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  const isModifier = event.ctrlKey || event.metaKey;
  if (isModifier && event.shiftKey && event.key.toLowerCase() === "z") {
    return true;
  }
  if (event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "y") {
    return true;
  }
  return false;
}
