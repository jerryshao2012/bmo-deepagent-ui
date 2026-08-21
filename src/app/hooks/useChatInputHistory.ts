"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";

export const CHAT_INPUT_HISTORY_STORAGE_KEY = "deep-agent-chat-input-history";
export const CHAT_INPUT_HISTORY_LIMIT = 100;

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const history: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const duplicateIndex = history.indexOf(entry);
    if (duplicateIndex >= 0) history.splice(duplicateIndex, 1);
    history.push(entry);
  }
  return history.slice(-CHAT_INPUT_HISTORY_LIMIT);
}

function readHistory(): string[] {
  try {
    const stored = browserStorage()?.getItem(CHAT_INPUT_HISTORY_STORAGE_KEY);
    return stored ? normalizeHistory(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

function writeHistory(history: string[]) {
  try {
    browserStorage()?.setItem(
      CHAT_INPUT_HISTORY_STORAGE_KEY,
      JSON.stringify(history)
    );
  } catch {
    // Keep the in-memory history usable when browser storage is unavailable.
  }
}

export type ChatInputHistory = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  clearInput: () => void;
  recordSubmittedInput: (value: string) => void;
  handleHistoryKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  resetHistoryNavigation: () => void;
};

export function useChatInputHistory(
  textareaRef: RefObject<HTMLTextAreaElement | null>
): ChatInputHistory {
  const [input, setInputState] = useState("");
  const historyRef = useRef<string[] | null>(null);
  const navigationIndexRef = useRef<number | null>(null);
  const draftRef = useRef("");
  const moveCaretToEndRef = useRef(false);

  if (historyRef.current === null) {
    historyRef.current = readHistory();
  }

  const resetHistoryNavigation = useCallback(() => {
    navigationIndexRef.current = null;
    draftRef.current = "";
  }, []);

  const setInput = useCallback<Dispatch<SetStateAction<string>>>(
    (value) => {
      resetHistoryNavigation();
      setInputState(value);
    },
    [resetHistoryNavigation]
  );

  const clearInput = useCallback(() => {
    resetHistoryNavigation();
    moveCaretToEndRef.current = false;
    setInputState("");
  }, [resetHistoryNavigation]);

  const recordSubmittedInput = useCallback(
    (value: string) => {
      if (!value.trim()) return;

      historyRef.current = normalizeHistory([
        ...(historyRef.current ?? []),
        ...readHistory(),
        value,
      ]);
      writeHistory(historyRef.current);
      resetHistoryNavigation();
    },
    [resetHistoryNavigation]
  );

  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        if (!input && navigationIndexRef.current === null) return false;
        event.preventDefault();
        clearInput();
        return true;
      }

      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return false;
      }

      const currentIndex = navigationIndexRef.current;
      if (currentIndex === null) {
        historyRef.current = normalizeHistory([
          ...(historyRef.current ?? []),
          ...readHistory(),
        ]);
      }

      const history = historyRef.current ?? [];
      if (history.length === 0) return false;

      const { selectionStart, selectionEnd } = event.currentTarget;
      const selectionIsCollapsed = selectionStart === selectionEnd;
      const caretIsOnFirstLine = !input.slice(0, selectionStart).includes("\n");
      const caretIsOnLastLine = !input.slice(selectionEnd).includes("\n");
      if (
        !selectionIsCollapsed ||
        (event.key === "ArrowUp" && !caretIsOnFirstLine) ||
        (event.key === "ArrowDown" && !caretIsOnLastLine)
      ) {
        return false;
      }

      let nextValue: string;

      if (currentIndex === null) {
        if (event.key !== "ArrowUp") return false;

        draftRef.current = input;
        navigationIndexRef.current = history.length - 1;
        nextValue = history[history.length - 1];
      } else if (event.key === "ArrowUp") {
        const nextIndex = Math.max(0, currentIndex - 1);
        navigationIndexRef.current = nextIndex;
        nextValue = history[nextIndex];
      } else if (currentIndex < history.length - 1) {
        const nextIndex = currentIndex + 1;
        navigationIndexRef.current = nextIndex;
        nextValue = history[nextIndex];
      } else {
        navigationIndexRef.current = null;
        nextValue = draftRef.current;
        draftRef.current = "";
      }

      event.preventDefault();
      moveCaretToEndRef.current = true;
      setInputState(nextValue);
      return true;
    },
    [clearInput, input]
  );

  useLayoutEffect(() => {
    if (!moveCaretToEndRef.current) return;
    moveCaretToEndRef.current = false;
    textareaRef.current?.setSelectionRange(input.length, input.length);
  }, [input, textareaRef]);

  return {
    input,
    setInput,
    clearInput,
    recordSubmittedInput,
    handleHistoryKeyDown,
    resetHistoryNavigation,
  };
}
