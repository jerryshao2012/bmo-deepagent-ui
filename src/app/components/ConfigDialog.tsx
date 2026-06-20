"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Server,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
} from "lucide-react";
import { StandaloneConfig, getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: StandaloneConfig) => void;
  initialConfig?: StandaloneConfig;
}

interface StorageInfoState {
  status: "idle" | "loading" | "success" | "error";
  data: unknown | null;
  error: string | null;
}

export function ConfigDialog({
  open,
  onOpenChange,
  onSave,
  initialConfig,
}: ConfigDialogProps) {
  const [deploymentUrl, setDeploymentUrl] = useState(
    initialConfig?.deploymentUrl || ""
  );
  const [assistantId, setAssistantId] = useState(
    initialConfig?.assistantId || ""
  );
  const [storageInfo, setStorageInfo] = useState<StorageInfoState>({
    status: "idle",
    data: null,
    error: null,
  });
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["storage", "model_factory", "environment_variables"])
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && initialConfig) {
      setDeploymentUrl(initialConfig.deploymentUrl);
      setAssistantId(initialConfig.assistantId);
    }
  }, [open, initialConfig]);

  // Reset storage info when dialog closes
  useEffect(() => {
    if (!open) {
      setStorageInfo({ status: "idle", data: null, error: null });
      setCopied(false);
    }
  }, [open]);

  const handleSave = () => {
    if (!deploymentUrl || !assistantId) {
      alert("Please fill in all required fields");
      return;
    }

    onSave({
      deploymentUrl,
      assistantId,
    });
    onOpenChange(false);
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const fetchStorageInfo = async () => {
    const config = getConfig();
    const url = config?.deploymentUrl || deploymentUrl;

    if (!url) {
      setStorageInfo({
        status: "error",
        data: null,
        error: "No deployment URL configured. Save settings first.",
      });
      return;
    }

    setStorageInfo({ status: "loading", data: null, error: null });
    setExpandedSections(new Set(["storage", "model_factory"]));

    try {
      const token = getBrowserSessionToken();
      const cleanUrl = url.replace(/\/+$/, "");
      const response = await fetch(`${cleanUrl}/storage/info`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": token,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${text || response.statusText}`
        );
      }

      const data = await response.json();
      setStorageInfo({ status: "success", data, error: null });
    } catch (err) {
      setStorageInfo({
        status: "error",
        data: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleCopyJson = async () => {
    if (!storageInfo.data) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(storageInfo.data, null, 2)
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard api may fail
    }
  };

  const renderJsonValue = (value: unknown): React.ReactNode => {
    if (value === null) return <span className="text-muted-foreground">null</span>;
    if (typeof value === "boolean")
      return (
        <span className={value ? "text-green-500" : "text-red-500"}>
          {value.toString()}
        </span>
      );
    if (typeof value === "number")
      return <span className="text-blue-400">{value}</span>;
    if (typeof value === "string") {
      // Truncate very long strings inline
      const display = value.length > 120 ? `${value.slice(0, 120)}...` : value;
      return <span className="text-amber-300 break-all">&quot;{display}&quot;</span>;
    }
    return null;
  };

  const renderSection = (key: string, value: unknown, depth: number = 0) => {
    if (value === null || typeof value !== "object") {
      return (
        <div
          key={key}
          className="flex items-start gap-2 py-0.5"
          style={{ paddingLeft: depth * 16 }}
        >
          <span className="text-muted-foreground shrink-0">{key}:</span>
          {renderJsonValue(value)}
        </div>
      );
    }

    if (Array.isArray(value)) {
      return (
        <div key={key} style={{ paddingLeft: depth * 16 }}>
          <div className="text-muted-foreground">{key}: [</div>
          {value.map((item, i) =>
            renderSection(`[${i}]`, item, depth + 1)
          )}
          <div className="text-muted-foreground">]</div>
        </div>
      );
    }

    const isExpanded = expandedSections.has(key);
    const entries = Object.entries(value as Record<string, unknown>);

    return (
      <div key={key} style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          onClick={() => toggleSection(key)}
          className="flex items-center gap-1 py-0.5 text-left hover:text-foreground text-muted-foreground transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span className="font-medium">{key}</span>
          {!isExpanded && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({entries.length} field{entries.length !== 1 ? "s" : ""})
            </span>
          )}
        </button>
        {isExpanded && (
          <div className="border-l border-border pl-2 ml-1">
            {entries.map(([k, v]) => renderSection(k, v, 0))}
          </div>
        )}
      </div>
    );
  };

  const renderStorageInfoResult = () => {
    if (storageInfo.status === "idle") return null;

    return (
      <div className="mt-4 rounded-md border border-border overflow-hidden">
        {/* Status bar */}
        <div
          className={`flex items-center justify-between px-3 py-2 text-xs font-medium ${
            storageInfo.status === "loading"
              ? "bg-blue-500/10 text-blue-400"
              : storageInfo.status === "success"
                ? "bg-green-500/10 text-green-400"
                : "bg-red-500/10 text-red-400"
          }`}
        >
          <div className="flex items-center gap-2">
            {storageInfo.status === "loading" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Querying server storage info (LLM diagnostics may take a moment)...</span>
              </>
            )}
            {storageInfo.status === "success" && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Storage info retrieved successfully</span>
              </>
            )}
            {storageInfo.status === "error" && (
              <>
                <XCircle className="h-3.5 w-3.5" />
                <span>Failed to retrieve storage info</span>
              </>
            )}
          </div>
          {storageInfo.status === "success" && storageInfo.data != null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleCopyJson}
            >
              {copied ? (
                <>
                  <Check className="mr-1 h-3 w-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1 h-3 w-3" /> Copy JSON
                </>
              )}
            </Button>
          )}
        </div>

        {/* Content */}
        {storageInfo.status === "success" && storageInfo.data != null && (
          <div
            className="max-h-[300px] overflow-y-auto rounded-b-md"
            style={{
              scrollbarWidth: "thin",
              scrollbarColor: "#4b5563 #1f2937",
            }}
          >
            <div className="bg-[#0d1117] p-3 font-mono text-xs text-foreground">
              {typeof storageInfo.data === "object" &&
                storageInfo.data !== null &&
                Object.entries(storageInfo.data as Record<string, unknown>).map(
                  ([k, v]) => (
                    <div key={k} className="mb-1">
                      {renderSection(k, v, 0)}
                    </div>
                  )
                )}
            </div>
          </div>
        )}

        {storageInfo.status === "error" && storageInfo.error && (
          <div className="bg-red-500/5 p-3 text-xs text-red-400 font-mono">
            {storageInfo.error}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-[600px] !flex !flex-col max-h-[85vh] gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-1 pb-4 border-b border-border">
          <DialogTitle>Configuration</DialogTitle>
          <DialogDescription>
            Configure your agent deployment settings. These settings are
            saved in your browser&apos;s local storage.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-1 py-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="deploymentUrl">Deployment URL</Label>
              <Input
                id="deploymentUrl"
                placeholder="https://<deployment-url>"
                value={deploymentUrl}
                onChange={(e) => setDeploymentUrl(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="assistantId">Assistant ID</Label>
              <Input
                id="assistantId"
                placeholder="<assistant-id>"
                value={assistantId}
                onChange={(e) => setAssistantId(e.target.value)}
              />
            </div>

            {/* Storage Info Section */}
            <div className="grid gap-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Server Diagnostics</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Query storage info and run model factory diagnostics on the backend.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fetchStorageInfo}
                  disabled={storageInfo.status === "loading"}
                  className="shrink-0"
                >
                  {storageInfo.status === "loading" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Server className="mr-2 h-4 w-4" />
                  )}
                  {storageInfo.status === "loading"
                    ? "Querying..."
                    : storageInfo.status === "success"
                      ? "Refresh"
                      : "Get Storage Info"}
                </Button>
              </div>
              {renderStorageInfoResult()}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 px-1 pt-4 border-t border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
