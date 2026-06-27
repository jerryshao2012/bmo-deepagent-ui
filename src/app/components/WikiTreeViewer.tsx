"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Loader2,
  RefreshCw,
  Database,
  FileCode,
  AlertCircle,
} from "lucide-react";
import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileItem } from "@/app/types/types";

export interface TreeNode {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  children?: TreeNode[];
}

interface WikiTreeViewerProps {
  threadId: string;
  onSelectFile: (file: FileItem) => void;
  onFileCountChange?: (count: number) => void;
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(filename: string) {
  if (filename.endsWith(".faiss") || filename.endsWith(".pkl")) {
    return <Database className="h-4 w-4 text-purple-400 shrink-0" />;
  }
  if (filename.endsWith(".md") || filename.endsWith(".txt")) {
    return <FileText className="h-4 w-4 text-blue-400 shrink-0" />;
  }
  return <FileCode className="h-4 w-4 text-emerald-400 shrink-0" />;
}

export const WikiTreeViewer: React.FC<WikiTreeViewerProps> = ({
  threadId,
  onSelectFile,
  onFileCountChange,
}) => {
  const [treeData, setTreeData] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "": true, // root expanded
    "wiki": true, // wiki directory expanded by default
  });
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const appConfig = getConfig();
      const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
      const token = getBrowserSessionToken();
      const res = await fetch(`${deploymentUrl}/threads/${threadId}/wiki/tree`, {
        headers: token ? { "X-API-Key": token } : {},
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Wiki workspace not found. Please wait for document ingestion or trigger ingest.");
        }
        throw new Error(`Failed to fetch wiki tree (${res.status})`);
      }

      const data = await res.json();
      setTreeData(data.tree);
      if (typeof data.file_count === "number" && onFileCountChange) {
        onFileCountChange(data.file_count);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load wiki directory tree.");
    } finally {
      setLoading(false);
    }
  }, [threadId, onFileCountChange]);

  useEffect(() => {
    if (threadId) {
      fetchTree();
    }
  }, [threadId, fetchTree]);

  const toggleExpand = (path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const handleFileClick = async (node: TreeNode) => {
    if (loadingFilePath) return;

    if (
      node.name.endsWith(".faiss") ||
      node.name.endsWith(".pkl") ||
      node.path.startsWith("index/")
    ) {
      onSelectFile({
        path: node.path,
        content: "Content view is unavailable",
      });
      return;
    }

    setLoadingFilePath(node.path);
    try {
      const appConfig = getConfig();
      const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
      const token = getBrowserSessionToken();
      const res = await fetch(
        `${deploymentUrl}/threads/${threadId}/wiki/file?path=${encodeURIComponent(
          node.path
        )}`,
        {
          headers: token ? { "X-API-Key": token } : {},
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to read file (${res.status})`);
      }

      const data = await res.json();
      onSelectFile({
        path: data.path || node.path,
        content: data.content || "",
      });
    } catch (err: any) {
      console.error("Failed to load file content:", err);
    } finally {
      setLoadingFilePath(null);
    }
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isDir = node.type === "directory";
    const isExpanded = !!expanded[node.path];

    if (isDir) {
      const children = node.children || [];
      return (
        <div key={node.path || node.name} className="select-none">
          <div
            onClick={() => toggleExpand(node.path)}
            className={cn(
              "flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-colors text-sm hover:bg-accent/60",
              depth === 0 ? "font-semibold text-foreground" : "text-foreground/90"
            )}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <span className="text-muted-foreground">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
            </span>
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
            ) : (
              <Folder className="h-4 w-4 text-amber-500 shrink-0" />
            )}
            <span className="truncate flex-1">{node.name}</span>
            <span className="text-[11px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/50">
              {children.length}
            </span>
          </div>
          {isExpanded && children.length > 0 && (
            <div className="flex flex-col">
              {children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const isLoadingThis = loadingFilePath === node.path;

    return (
      <div
        key={node.path}
        onClick={() => handleFileClick(node)}
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors text-sm hover:bg-accent/80 group",
          isLoadingThis ? "bg-accent/50" : ""
        )}
        style={{ paddingLeft: `${depth * 14 + 24}px` }}
      >
        {isLoadingThis ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        ) : (
          getFileIcon(node.name)
        )}
        <span className="truncate flex-1 text-foreground/90 group-hover:text-foreground">
          {node.name}
        </span>
        {node.size !== undefined && (
          <span className="text-[11px] text-muted-foreground/60 group-hover:text-muted-foreground font-mono">
            {formatFileSize(node.size)}
          </span>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground space-y-2">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-xs">Loading wiki directory tree...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 rounded-lg border border-border bg-card/50">
        <AlertCircle className="h-8 w-8 text-muted-foreground/80" />
        <p className="text-xs text-muted-foreground max-w-[240px]">{error}</p>
        <Button size="sm" variant="outline" onClick={fetchTree} className="h-8 text-xs gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (!treeData) return null;

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
          <Database className="h-3.5 w-3.5 text-primary" />
          <span>threads-wiki / {threadId.slice(0, 8)}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={fetchTree}
          title="Refresh tree"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      <ScrollArea className="flex-1 p-2">
        {renderNode(treeData)}
      </ScrollArea>
    </div>
  );
};
