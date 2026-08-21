import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";

import {
  CHAT_INPUT_HISTORY_LIMIT,
  CHAT_INPUT_HISTORY_STORAGE_KEY,
  useChatInputHistory,
} from "../src/app/hooks/useChatInputHistory";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function HistoryComposer() {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const {
    input,
    setInput,
    clearInput,
    recordSubmittedInput,
    handleHistoryKeyDown,
  } = useChatInputHistory(textareaRef);

  return (
    <>
      <textarea
        aria-label="Composer"
        ref={textareaRef}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleHistoryKeyDown}
      />
      <button onClick={() => recordSubmittedInput(input)}>Record</button>
      <button onClick={clearInput}>Clear</button>
    </>
  );
}

function seedHistory(entries: string[]) {
  localStorage.setItem(CHAT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
}

function composer() {
  return screen.getByRole("textbox", {
    name: "Composer",
  }) as HTMLTextAreaElement;
}

function setCaret(position: number, end = position) {
  composer().setSelectionRange(position, end);
}

test("persists the 100 newest unique prompts and moves repeats to newest", () => {
  const { result } = renderHook(() => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    return useChatInputHistory(textareaRef);
  });

  act(() => {
    for (let index = 0; index <= CHAT_INPUT_HISTORY_LIMIT; index += 1) {
      result.current.recordSubmittedInput(`prompt-${index}`);
    }
    result.current.recordSubmittedInput("prompt-50");
  });

  const stored = JSON.parse(
    localStorage.getItem(CHAT_INPUT_HISTORY_STORAGE_KEY) ?? "[]"
  );
  assert.equal(stored.length, CHAT_INPUT_HISTORY_LIMIT);
  assert.equal(stored[0], "prompt-1");
  assert.equal(stored.at(-1), "prompt-50");
  assert.equal(
    stored.filter((entry: string) => entry === "prompt-50").length,
    1
  );
});

test("merges submissions from composers mounted before storage changes", () => {
  const firstComposer = renderHook(() => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    return useChatInputHistory(textareaRef);
  });
  const secondComposer = renderHook(() => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    return useChatInputHistory(textareaRef);
  });

  act(() => firstComposer.result.current.recordSubmittedInput("first task"));
  act(() => secondComposer.result.current.recordSubmittedInput("second task"));

  assert.deepEqual(
    JSON.parse(localStorage.getItem(CHAT_INPUT_HISTORY_STORAGE_KEY) ?? "[]"),
    ["first task", "second task"]
  );

  act(() => {
    firstComposer.result.current.handleHistoryKeyDown({
      key: "ArrowUp",
      currentTarget: { selectionStart: 0, selectionEnd: 0 },
      preventDefault() {},
    } as React.KeyboardEvent<HTMLTextAreaElement>);
  });
  assert.equal(firstComposer.result.current.input, "second task");
});

test("navigates older prompts and restores the original draft", () => {
  seedHistory(["oldest", "newest"]);
  render(<HistoryComposer />);

  fireEvent.change(composer(), { target: { value: "unfinished draft" } });
  setCaret(4);
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "newest");

  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "oldest");
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "oldest");

  fireEvent.keyDown(composer(), { key: "ArrowDown" });
  assert.equal(composer().value, "newest");
  fireEvent.keyDown(composer(), { key: "ArrowDown" });
  assert.equal(composer().value, "unfinished draft");
});

test("enters history only from a collapsed caret on the first logical line", () => {
  seedHistory(["remembered"]);
  render(<HistoryComposer />);

  fireEvent.change(composer(), { target: { value: "first\nsecond" } });
  setCaret(composer().value.length);
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "first\nsecond");

  setCaret(0, 3);
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "first\nsecond");

  setCaret(2);
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "remembered");
  assert.equal(composer().selectionStart, "remembered".length);
  assert.equal(composer().selectionEnd, "remembered".length);
});

test("manual edits exit browsing and become the draft restored by ArrowDown", () => {
  seedHistory(["oldest", "newest"]);
  render(<HistoryComposer />);

  fireEvent.change(composer(), { target: { value: "initial draft" } });
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "newest");

  fireEvent.change(composer(), { target: { value: "edited recall" } });
  setCaret(composer().value.length);
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "newest");
  fireEvent.keyDown(composer(), { key: "ArrowDown" });
  assert.equal(composer().value, "edited recall");
});

test("preserves multiline cursor movement while browsing recalled prompts", () => {
  seedHistory(["older", "newest first line\nnewest second line"]);
  render(<HistoryComposer />);

  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "newest first line\nnewest second line");

  setCaret(composer().value.length);
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "newest first line\nnewest second line");

  setCaret(2);
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "older");

  setCaret(2);
  fireEvent.keyDown(composer(), { key: "ArrowDown" });
  assert.equal(composer().value, "newest first line\nnewest second line");

  setCaret(2);
  fireEvent.keyDown(composer(), { key: "ArrowDown" });
  assert.equal(composer().value, "newest first line\nnewest second line");

  setCaret(composer().value.length);
  fireEvent.keyDown(composer(), { key: "ArrowDown" });
  assert.equal(composer().value, "");
});

test("Escape clears input and navigation without deleting stored history", () => {
  seedHistory(["remembered"]);
  render(<HistoryComposer />);

  fireEvent.change(composer(), { target: { value: "draft" } });
  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  fireEvent.keyDown(composer(), { key: "Escape" });
  assert.equal(composer().value, "");
  assert.deepEqual(
    JSON.parse(localStorage.getItem(CHAT_INPUT_HISTORY_STORAGE_KEY) ?? "[]"),
    ["remembered"]
  );

  fireEvent.keyDown(composer(), { key: "ArrowUp" });
  assert.equal(composer().value, "remembered");
});

test("ignores corrupt storage and replaces it on the next submission", () => {
  localStorage.setItem(CHAT_INPUT_HISTORY_STORAGE_KEY, "not-json");
  render(<HistoryComposer />);

  fireEvent.change(composer(), { target: { value: "valid prompt" } });
  fireEvent.click(screen.getByRole("button", { name: "Record" }));

  assert.deepEqual(
    JSON.parse(localStorage.getItem(CHAT_INPUT_HISTORY_STORAGE_KEY) ?? "[]"),
    ["valid prompt"]
  );
});

test("keeps in-memory history when localStorage reads and writes fail", () => {
  const storagePrototype = Object.getPrototypeOf(
    window.localStorage
  ) as Storage;
  const originalGetItem = storagePrototype.getItem;
  const originalSetItem = storagePrototype.setItem;
  storagePrototype.getItem = () => {
    throw new Error("storage blocked");
  };
  storagePrototype.setItem = () => {
    throw new Error("storage blocked");
  };

  try {
    render(<HistoryComposer />);
    fireEvent.change(composer(), { target: { value: "in memory" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.keyDown(composer(), { key: "ArrowUp" });
    assert.equal(composer().value, "in memory");
  } finally {
    storagePrototype.getItem = originalGetItem;
    storagePrototype.setItem = originalSetItem;
  }
});
