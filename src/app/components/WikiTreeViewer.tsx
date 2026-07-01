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
  Network,
} from "lucide-react";
import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileItem } from "@/app/types/types";
import WikiGraphViewer from "@/app/components/WikiGraphViewer";

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
  const [activeTab, setActiveTab] = useState<"tree" | "graph">("tree");
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

  const handleFileClick = async (node: TreeNode) => {
    if (loadingFilePath) return;
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
        throw new Error(`Failed to fetch file content (${res.status})`);
      }

      const data = await res.json();
      onSelectFile({
        path: node.path,
        content: data.content || "",
      });
    } catch (err: any) {
      console.error("Error fetching file content:", err);
    } finally {
      setLoadingFilePath(null);
    }
  };

  const renderNode = (node: TreeNode, depth = 0) => {
    const isExpanded = expanded[node.path];
    const isDirectory = node.type === "directory";

    const toggleExpand = () => {
      setExpanded((prev) => ({
        ...prev,
        [node.path]: !prev[node.path],
      }));
    };

    if (isDirectory) {
      return (
        <div key={node.path} className="select-none">
          <div
            className="flex items-center gap-1 py-1 px-1.5 hover:bg-muted/40 rounded cursor-pointer text-xs group"
            onClick={toggleExpand}
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
          >
            <span className="text-muted-foreground/70 hover:text-foreground">
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </span>
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 text-primary/80 shrink-0" />
            ) : (
              <Folder className="h-4 w-4 text-primary/80 shrink-0" />
            )}
            <span className="font-medium text-foreground/90 group-hover:text-foreground truncate">
              {node.name}
            </span>
          </div>
          {isExpanded && node.children && (
            <div className="flex flex-col">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const isFileLoading = loadingFilePath === node.path;

    return (
      <div
        key={node.path}
        className={cn(
          "flex items-center gap-1.5 py-1 px-1.5 hover:bg-muted/60 rounded cursor-pointer text-xs group select-none",
          isFileLoading && "opacity-70 pointer-events-none"
        )}
        onClick={() => handleFileClick(node)}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        {isFileLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
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

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-center gap-3 text-xs font-medium text-foreground/80">
          <div className="flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5 text-primary" />
            <span>threads-wiki / {threadId.slice(0, 8)}</span>
          </div>
          <div className="flex items-center gap-0.5 bg-muted/60 px-1 py-0.5 rounded border border-border">
            <button
              onClick={() => setActiveTab("tree")}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] transition-all",
                activeTab === "tree"
                  ? "bg-background shadow-xs text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Tree
            </button>
            <button
              onClick={() => setActiveTab("graph")}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] transition-all",
                activeTab === "graph"
                  ? "bg-background shadow-xs text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Graph
            </button>
          </div>
        </div>
        {activeTab === "tree" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={fetchTree}
            title="Refresh tree"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 w-full relative">
        {activeTab === "tree" ? (
          loading ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs">Loading wiki directory tree...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 h-full">
              <AlertCircle className="h-8 w-8 text-muted-foreground/80" />
              <p className="text-xs text-muted-foreground max-w-[240px]">{error}</p>
              <Button size="sm" variant="outline" onClick={fetchTree} className="h-8 text-xs gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : !treeData ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              No tree data available.
            </div>
          ) : (
            <ScrollArea className="h-full w-full">
              <div className="p-2">
                {renderNode(treeData)}
              </div>
            </ScrollArea>
          )
        ) : (
          <WikiGraphViewer threadId={threadId} />
        )}
      </div>
    </div>
  );
};
