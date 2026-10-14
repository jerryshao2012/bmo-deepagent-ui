import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarkdownUndoHistory,
  pushMarkdownUndoState,
  undoMarkdownHistory,
  redoMarkdownHistory,
  isMarkdownUndoShortcut,
  isMarkdownRedoShortcut,
} from "../src/features/markdown-sync/application/preview-undo-redo";

test("createMarkdownUndoHistory initializes empty past and future", () => {
  const history = createMarkdownUndoHistory("initial text");
  assert.deepEqual(history.past, []);
  assert.equal(history.present, "initial text");
  assert.deepEqual(history.future, []);
});

test("pushMarkdownUndoState adds present to past and clears future", () => {
  let history = createMarkdownUndoHistory("v1");
  history = pushMarkdownUndoState(history, "v2");
  assert.deepEqual(history.past, ["v1"]);
  assert.equal(history.present, "v2");
  assert.deepEqual(history.future, []);

  history = pushMarkdownUndoState(history, "v3");
  assert.deepEqual(history.past, ["v1", "v2"]);
  assert.equal(history.present, "v3");

  // Pushing identical text is a no-op
  const same = pushMarkdownUndoState(history, "v3");
  assert.equal(same, history);
});

test("pushMarkdownUndoState caps history length", () => {
  let history = createMarkdownUndoHistory("v0");
  for (let i = 1; i <= 10; i++) {
    history = pushMarkdownUndoState(history, `v${i}`, 5);
  }
  assert.equal(history.past.length, 5);
  assert.deepEqual(history.past, ["v5", "v6", "v7", "v8", "v9"]);
  assert.equal(history.present, "v10");
});

test("undo and redo step backward and forward through history", () => {
  let history = createMarkdownUndoHistory("a");
  history = pushMarkdownUndoState(history, "b");
  history = pushMarkdownUndoState(history, "c");

  // Undo c -> b
  const undo1 = undoMarkdownHistory(history);
  assert.ok(undo1);
  assert.equal(undo1.text, "b");
  assert.deepEqual(undo1.nextHistory.past, ["a"]);
  assert.equal(undo1.nextHistory.present, "b");
  assert.deepEqual(undo1.nextHistory.future, ["c"]);

  // Undo b -> a
  const undo2 = undoMarkdownHistory(undo1.nextHistory);
  assert.ok(undo2);
  assert.equal(undo2.text, "a");
  assert.deepEqual(undo2.nextHistory.past, []);
  assert.equal(undo2.nextHistory.present, "a");
  assert.deepEqual(undo2.nextHistory.future, ["b", "c"]);

  // Undo at start returns null
  assert.equal(undoMarkdownHistory(undo2.nextHistory), null);

  // Redo a -> b
  const redo1 = redoMarkdownHistory(undo2.nextHistory);
  assert.ok(redo1);
  assert.equal(redo1.text, "b");
  assert.deepEqual(redo1.nextHistory.past, ["a"]);
  assert.equal(redo1.nextHistory.present, "b");
  assert.deepEqual(redo1.nextHistory.future, ["c"]);

  // Redo b -> c
  const redo2 = redoMarkdownHistory(redo1.nextHistory);
  assert.ok(redo2);
  assert.equal(redo2.text, "c");
  assert.deepEqual(redo2.nextHistory.past, ["a", "b"]);
  assert.equal(redo2.nextHistory.present, "c");
  assert.deepEqual(redo2.nextHistory.future, []);

  // Redo at end returns null
  assert.equal(redoMarkdownHistory(redo2.nextHistory), null);
});

test("new push after undo clears redo future", () => {
  let history = createMarkdownUndoHistory("a");
  history = pushMarkdownUndoState(history, "b");
  history = pushMarkdownUndoState(history, "c");

  const undoRes = undoMarkdownHistory(history);
  assert.ok(undoRes);
  assert.deepEqual(undoRes.nextHistory.future, ["c"]);

  const branched = pushMarkdownUndoState(undoRes.nextHistory, "d");
  assert.deepEqual(branched.past, ["a", "b"]);
  assert.equal(branched.present, "d");
  assert.deepEqual(branched.future, []);
  assert.equal(redoMarkdownHistory(branched), null);
});

test("isMarkdownUndoShortcut recognizes Ctrl+Z and Cmd+Z", () => {
  // Windows/Linux Ctrl+Z
  assert.equal(
    isMarkdownUndoShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false }),
    true
  );
  assert.equal(
    isMarkdownUndoShortcut({ key: "Z", ctrlKey: true, metaKey: false, shiftKey: false }),
    true
  );
  // macOS Cmd+Z
  assert.equal(
    isMarkdownUndoShortcut({ key: "z", ctrlKey: false, metaKey: true, shiftKey: false }),
    true
  );
  // Shift+Ctrl+Z is NOT undo
  assert.equal(
    isMarkdownUndoShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true }),
    false
  );
  // Plain z is NOT undo
  assert.equal(
    isMarkdownUndoShortcut({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false }),
    false
  );
});

test("isMarkdownRedoShortcut recognizes Ctrl+Shift+Z, Cmd+Shift+Z, and Ctrl+Y", () => {
  // Ctrl+Shift+Z
  assert.equal(
    isMarkdownRedoShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true }),
    true
  );
  assert.equal(
    isMarkdownRedoShortcut({ key: "Z", ctrlKey: true, metaKey: false, shiftKey: true }),
    true
  );
  // Cmd+Shift+Z
  assert.equal(
    isMarkdownRedoShortcut({ key: "z", ctrlKey: false, metaKey: true, shiftKey: true }),
    true
  );
  // Windows Ctrl+Y
  assert.equal(
    isMarkdownRedoShortcut({ key: "y", ctrlKey: true, metaKey: false, shiftKey: false }),
    true
  );
  assert.equal(
    isMarkdownRedoShortcut({ key: "Y", ctrlKey: true, metaKey: false, shiftKey: false }),
    true
  );
  // Plain y or z is NOT redo
  assert.equal(
    isMarkdownRedoShortcut({ key: "y", ctrlKey: false, metaKey: false, shiftKey: false }),
    false
  );
  assert.equal(
    isMarkdownRedoShortcut({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false }),
    false
  );
});
