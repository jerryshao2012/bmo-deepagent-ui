"use client";

import React, { useMemo, useCallback, useState, useEffect } from "react";
import { FileText, Copy, Download, Edit, Save, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { toast } from "sonner";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import type { FileItem } from "@/app/types/types";
import useSWRMutation from "swr/mutation";

const LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  cpp: "cpp",
  c: "c",
  cs: "csharp",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  xml: "xml",
  html: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

export const FileViewDialog = React.memo<{
  file: FileItem | null;
  onSaveFile: (fileName: string, content: string) => Promise<void>;
  onClose: () => void;
  editDisabled: boolean;
}>(({ file, onSaveFile, onClose, editDisabled }) => {
  const [isEditingMode, setIsEditingMode] = useState(file === null);
  // Keep original filename (with /) for server submission
  const [originalFileName, setOriginalFileName] = useState(String(file?.path || ""));
  // Display filename (stripped) for UI editing
  const [displayFileName, setDisplayFileName] = useState(
    String(file?.path || "").replace(/^[\/\\]+/, "")
  );
  const [fileContent, setFileContent] = useState(String(file?.content || ""));

  const fileUpdate = useSWRMutation(
    { kind: "files-update", fileName: originalFileName, fileContent },
    async ({ fileName, fileContent }) => {
      if (!fileName || !fileContent) return;
      // Submit original filename to server
      return await onSaveFile(fileName, fileContent);
    },
    {
      onSuccess: () => setIsEditingMode(false),
      onError: (error) => toast.error(`Failed to save file: ${error}`),
    }
  );

  useEffect(() => {
    const original = String(file?.path || "");
    const display = original.replace(/^[\/\\]+/, "");
    setOriginalFileName(original);
    setDisplayFileName(display);
    setFileContent(String(file?.content || ""));
    setIsEditingMode(file === null);
  }, [file]);

  const fileExtension = useMemo(() => {
    const fileNameStr = displayFileName || "";
    return fileNameStr.split(".").pop()?.toLowerCase() || "";
  }, [displayFileName]);

  const isMarkdown = useMemo(() => {
    return fileExtension === "md" || fileExtension === "markdown";
  }, [fileExtension]);

  const language = useMemo(() => {
    return LANGUAGE_MAP[fileExtension] || "text";
  }, [fileExtension]);

  const handleCopy = useCallback(() => {
    if (fileContent) {
      navigator.clipboard.writeText(fileContent);
    }
  }, [fileContent]);

  const handleDownload = useCallback(() => {
    if (fileContent && displayFileName) {
      const blob = new Blob([fileContent], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = displayFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [fileContent, displayFileName]);

  const handleEdit = useCallback(() => {
    setIsEditingMode(true);
  }, []);

  const handleCancel = useCallback(() => {
    if (file === null) {
      onClose();
    } else {
      const original = String(file.path || "");
      const display = original.replace(/^[\/\\]+/, "");
      setOriginalFileName(original);
      setDisplayFileName(display);
      setFileContent(String(file.content || ""));
      setIsEditingMode(false);
    }
  }, [file, onClose]);

  // Validate display filename (no spaces, not empty)
  const fileNameIsValid = useMemo(() => {
    return displayFileName.trim() !== "" && !displayFileName.includes(" ");
  }, [displayFileName]);

  // Check if content changed from original
  const hasContentChanged = useMemo(() => {
    if (file === null) return fileContent.trim() !== "";
    const originalContent = String(file.content || "");
    return fileContent !== originalContent;
  }, [file, fileContent]);

  // Determine validation error message
  const validationError = useMemo(() => {
    if (!displayFileName.trim()) return "Filename is required";
    if (!fileContent.trim()) return "Content is required";
    if (displayFileName.includes(" ")) return "Filename cannot contain spaces";
    if (!hasContentChanged) return "No changes detected";
    return null;
  }, [displayFileName, fileContent, hasContentChanged]);

  return (
    <Dialog
      open={true}
      onOpenChange={onClose}
    >
      <DialogContent className="!max-w-none flex h-[80vh] max-h-[80vh] w-[90vw] flex-col p-6">
        <DialogTitle className="sr-only">
          {file?.path || "New File"}
        </DialogTitle>
        <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="text-primary/50 h-5 w-5 shrink-0" />
            {isEditingMode && file === null ? (
              <Input
                value={displayFileName}
                onChange={(e) => {
                  setDisplayFileName(e.target.value);
                  setOriginalFileName(e.target.value);
                }}
                placeholder="Enter filename..."
                className="text-base font-medium"
                aria-invalid={!fileNameIsValid}
              />
            ) : (
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-medium text-primary">
                {file?.path}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!isEditingMode && (
              <>
                <Button
                  onClick={handleEdit}
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  disabled={editDisabled}
                >
                  <Edit
                    size={16}
                    className="mr-1"
                  />
                  Edit
                </Button>
                <Button
                  onClick={handleCopy}
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                >
                  <Copy
                    size={16}
                    className="mr-1"
                  />
                  Copy
                </Button>
                <Button
                  onClick={handleDownload}
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                >
                  <Download
                    size={16}
                    className="mr-1"
                  />
                  Download
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {isEditingMode ? (
            <Textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              placeholder="Enter file content..."
              className="h-full min-h-[400px] resize-none font-mono text-sm"
            />
          ) : (
            <ScrollArea className="bg-surface h-full w-full rounded-md">
              <div className="p-4">
                {fileContent ? (
                  isMarkdown ? (
                    <div className="rounded-md p-6">
                      <MarkdownContent content={fileContent} />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <SyntaxHighlighter
                        language={language}
                        style={oneDark}
                        customStyle={{
                          margin: 0,
                          borderRadius: "0.5rem",
                          fontSize: "0.875rem",
                        }}
                        showLineNumbers
                        wrapLines={false}
                        lineProps={{
                          style: {
                            whiteSpace: "pre",
                          },
                        }}
                      >
                        {fileContent}
                      </SyntaxHighlighter>
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-center p-12">
                    <p className="text-sm text-muted-foreground">
                      File is empty
                    </p>
                  </div>
                )}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
        </div>
        {isEditingMode && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
            {validationError && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {validationError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                onClick={handleCancel}
                variant="outline"
                size="sm"
              >
                <X
                  size={16}
                  className="mr-1"
                />
                Cancel
              </Button>
              <Button
                onClick={() => fileUpdate.trigger()}
                size="sm"
                disabled={
                  fileUpdate.isMutating ||
                  !fileNameIsValid ||
                  !hasContentChanged
                }
              >
                {fileUpdate.isMutating ? (
                  <Loader2
                    size={16}
                    className="mr-1 animate-spin"
                  />
                ) : (
                  <Save
                    size={16}
                    className="mr-1"
                  />
                )}
                Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

FileViewDialog.displayName = "FileViewDialog";
