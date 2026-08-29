import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MarkdownContent } from "../src/app/components/MarkdownContent";
import { FileViewPanel } from "../src/app/components/FileViewPanel";
import type { FileItem } from "../src/app/types/types";

afterEach(() => {
  cleanup();
});

test("clicking state file link in MarkdownContent invokes onFileClick with matching file", () => {
  const onFileClick = mock.fn();
  const files: Record<string, unknown> = {
    "/reports/topic_001_research-latest-ai-technology-trends/final_report.md":
      "# Final Report Content",
    "/reports/topic_001_research-latest-ai-technology-trends/request.md":
      "# Request Content",
  };

  const markdown = `
# Research Reports Archive

| # | Topic | Report Link | Request Link |
|---|---|---|---|
| 1 | AI Trends | [final_report](/reports/topic_001_research-latest-ai-technology-trends/final_report.md) | [request](/reports/topic_001_research-latest-ai-technology-trends/request.md) |
`;

  render(
    <MarkdownContent
      content={markdown}
      files={files}
      onFileClick={onFileClick}
    />
  );

  const reportLink = screen.getByText("final_report");
  assert.equal(reportLink.getAttribute("target"), null);

  fireEvent.click(reportLink);

  assert.equal(onFileClick.mock.callCount(), 1);
  assert.deepEqual(onFileClick.mock.calls[0].arguments[0], {
    path: "/reports/topic_001_research-latest-ai-technology-trends/final_report.md",
    content: "# Final Report Content",
  });
});

test("clicking relative link in MarkdownContent resolves against currentFilePath", () => {
  const onFileClick = mock.fn();
  const files: Record<string, unknown> = {
    "/reports/topic_001_research-latest-ai-technology-trends/request.md":
      "# Resolved Request Content",
  };

  const markdown = `[request](./topic_001_research-latest-ai-technology-trends/request.md)`;

  render(
    <MarkdownContent
      content={markdown}
      files={files}
      currentFilePath="/reports/README.md"
      onFileClick={onFileClick}
    />
  );

  const requestLink = screen.getByText("request");
  fireEvent.click(requestLink);

  assert.equal(onFileClick.mock.callCount(), 1);
  assert.deepEqual(onFileClick.mock.calls[0].arguments[0], {
    path: "/reports/topic_001_research-latest-ai-technology-trends/request.md",
    content: "# Resolved Request Content",
  });
});

test("external links remain target=_blank and do not trigger onFileClick", () => {
  const onFileClick = mock.fn();
  const files: Record<string, unknown> = {
    "/reports/file.md": "Content",
  };

  const markdown = `[external link](https://example.com/reports/file.md)`;

  render(
    <MarkdownContent
      content={markdown}
      files={files}
      onFileClick={onFileClick}
    />
  );

  const externalLink = screen.getByText("external link");
  assert.equal(externalLink.getAttribute("target"), "_blank");

  fireEvent.click(externalLink);
  assert.equal(onFileClick.mock.callCount(), 0);
});

test("FileViewPanel passes onFileClick and originalFileName as currentFilePath", () => {
  const onFileClick = mock.fn();
  const files: Record<string, unknown> = {
    "/reports/READMD.md": "[Final Report](./topic_001/final_report.md)",
    "/reports/topic_001/final_report.md": "# Final Report Text",
  };

  const currentFile: FileItem = {
    path: "/reports/READMD.md",
    content: "[Final Report](./topic_001/final_report.md)",
  };

  render(
    <FileViewPanel
      file={currentFile}
      onSaveFile={async () => {}}
      onClose={() => {}}
      editDisabled={false}
      onFileClick={onFileClick}
      files={files}
    />
  );

  const link = screen.getByText("Final Report");
  fireEvent.click(link);

  assert.equal(onFileClick.mock.callCount(), 1);
  assert.deepEqual(onFileClick.mock.calls[0].arguments[0], {
    path: "/reports/topic_001/final_report.md",
    content: "# Final Report Text",
  });
});
