"use client";

import { useState, useEffect, useRef } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Server,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Sparkles,
  Search,
  Wrench,
  RefreshCw,
  Sliders,
  Activity,
  Upload,
  FolderUp,
  FileArchive,
} from "lucide-react";
import { StandaloneConfig, getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";
import { fetchAvailableSkills, uploadSkill, SkillItem } from "@/lib/skills";

async function scanFileSystemEntry(entry: any, path: string = ""): Promise<{ file: File; path: string }[]> {
  const results: { file: File; path: string }[] = [];
  if (!entry) return results;
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file: File) => {
          results.push({ file, path: path ? `${path}/${file.name}` : file.name });
          resolve(results);
        },
        () => resolve(results)
      );
    });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries: any[] = await new Promise((resolve) => {
      reader.readEntries(
        (pts: any[]) => resolve(pts),
        () => resolve([])
      );
    });
    for (const childEntry of entries) {
      const childResults = await scanFileSystemEntry(childEntry, path ? `${path}/${entry.name}` : entry.name);
      results.push(...childResults);
    }
  }
  return results;
}

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
  const [activeTab, setActiveTab] = useState("basic");
  const [storageInfo, setStorageInfo] = useState<StorageInfoState>({
    status: "idle",
    data: null,
    error: null,
  });
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [isLiveSkills, setIsLiveSkills] = useState(false);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["storage", "model_factory", "environment_variables"])
  );
  const [copied, setCopied] = useState(false);
  const [copiedSkillName, setCopiedSkillName] = useState<string | null>(null);
  const [uploadingSkill, setUploadingSkill] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingSkill, setIsDraggingSkill] = useState(false);

  const handleCopySkillName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopiedSkillName(name);
      setTimeout(() => setCopiedSkillName(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleSkillFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingSkill(true);
    setUploadStatus(null);

    try {
      const res = await uploadSkill(file, deploymentUrl);
      setUploadStatus({ type: "success", message: res.message });
      await loadSkills();
    } catch (err) {
      setUploadStatus({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingSkill(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSkillFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingSkill(true);
    setUploadStatus(null);

    try {
      const fileList = Array.from(files);
      const res = await uploadSkill(fileList, deploymentUrl);
      setUploadStatus({ type: "success", message: res.message });
      await loadSkills();
    } catch (err) {
      setUploadStatus({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingSkill(false);
      if (folderInputRef.current) {
        folderInputRef.current.value = "";
      }
    }
  };

  const handleDropSkill = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSkill(false);

    if (!isLiveSkills || uploadingSkill) return;

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    setUploadingSkill(true);
    setUploadStatus(null);

    try {
      const scannedFiles: { file: File; path: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry) {
            const files = await scanFileSystemEntry(entry);
            scannedFiles.push(...files);
          } else {
            const file = item.getAsFile();
            if (file) scannedFiles.push({ file, path: file.name });
          }
        }
      }

      if (scannedFiles.length === 0) {
        throw new Error("No valid files found in drop payload.");
      }

      if (scannedFiles.length === 1 && scannedFiles[0].file.name.toLowerCase().endsWith(".zip")) {
        const res = await uploadSkill(scannedFiles[0].file, deploymentUrl);
        setUploadStatus({ type: "success", message: res.message });
      } else {
        const res = await uploadSkill(scannedFiles, deploymentUrl);
        setUploadStatus({ type: "success", message: res.message });
      }
      await loadSkills();
    } catch (err) {
      setUploadStatus({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingSkill(false);
    }
  };

  useEffect(() => {
    if (open && initialConfig) {
      setDeploymentUrl(initialConfig.deploymentUrl);
      setAssistantId(initialConfig.assistantId);
    }
  }, [open, initialConfig]);

  const loadSkills = async (url?: string) => {
    setSkillsLoading(true);
    try {
      const res = await fetchAvailableSkills(url || deploymentUrl);
      setSkills(res.skills);
      setIsLiveSkills(res.isLive);
    } catch (err) {
      console.error("Failed to load skills:", err);
    } finally {
      setSkillsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadSkills(initialConfig?.deploymentUrl || deploymentUrl);
    }
  }, [open]);

  // Reset storage info when dialog closes
  useEffect(() => {
    if (!open) {
      setStorageInfo({ status: "idle", data: null, error: null });
      setCopied(false);
      setActiveTab("basic");
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
      <div className="mt-3 rounded-md border border-border overflow-hidden">
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
            className="max-h-[280px] overflow-y-auto rounded-b-md"
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] !flex !flex-col max-h-[85vh] gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-1 pb-4 border-b border-border">
          <DialogTitle>Configuration</DialogTitle>
          <DialogDescription>
            Manage basic deployment options, agent skills, and server diagnostics.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          <div className="px-1 pt-3 pb-1 border-b border-border/50 shrink-0">
            <TabsList className="w-full grid grid-cols-3 h-9 bg-muted/50 p-1">
              <TabsTrigger
                value="basic"
                className="flex items-center gap-2 text-xs font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Sliders className="h-3.5 w-3.5" />
                Basic
              </TabsTrigger>
              <TabsTrigger
                value="skills"
                className="flex items-center gap-2 text-xs font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Wrench className="h-3.5 w-3.5" />
                Skills ({skills.length})
              </TabsTrigger>
              <TabsTrigger
                value="diagnostics"
                className="flex items-center gap-2 text-xs font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Activity className="h-3.5 w-3.5" />
                Diagnostics
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-[280px] px-1 py-4">
            {/* TAB 1: BASIC CONFIGURATION */}
            <TabsContent value="basic" className="m-0 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="deploymentUrl" className="text-xs font-semibold">
                  Deployment URL
                </Label>
                <Input
                  id="deploymentUrl"
                  placeholder="https://<deployment-url>"
                  value={deploymentUrl}
                  onChange={(e) => setDeploymentUrl(e.target.value)}
                  className="h-9 text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  The base endpoint of your LangGraph or FastAPI agent deployment.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="assistantId" className="text-xs font-semibold">
                  Assistant ID
                </Label>
                <Input
                  id="assistantId"
                  placeholder="<assistant-id>"
                  value={assistantId}
                  onChange={(e) => setAssistantId(e.target.value)}
                  className="h-9 text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  The graph identifier or agent ID for sending runs and creating threads.
                </p>
              </div>
            </TabsContent>

            {/* TAB 2: AGENT SKILLS */}
            <TabsContent
              value="skills"
              className={`m-0 space-y-3 rounded-lg p-2 transition-colors relative ${
                isDraggingSkill ? "bg-primary/10 border-2 border-dashed border-primary" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isLiveSkills && !uploadingSkill) setIsDraggingSkill(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingSkill(false);
              }}
              onDrop={handleDropSkill}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleSkillFileUpload}
                accept=".zip,.md"
                className="hidden"
              />
              <input
                type="file"
                ref={folderInputRef}
                onChange={handleSkillFolderUpload}
                {...({ webkitdirectory: "", directory: "" } as any)}
                className="hidden"
              />
              <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">Available Agent Skills</span>
                  {isLiveSkills ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Live backend
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                      Pre-configured
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploadingSkill || !isLiveSkills}
                        className="h-7 px-2.5 text-xs font-medium text-foreground bg-background hover:bg-muted"
                        title={!isLiveSkills ? "Connect live backend to upload custom skills" : "Upload skill archive or folder"}
                      >
                        {uploadingSkill ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-primary" />
                        ) : (
                          <Upload className="mr-1.5 h-3.5 w-3.5 text-primary" />
                        )}
                        {uploadingSkill ? "Uploading..." : "Upload Skill"}
                        <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 text-xs">
                      <DropdownMenuItem
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 cursor-pointer text-xs"
                      >
                        <FileArchive className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-medium">Upload Zip Archive</span>
                          <span className="text-[10px] text-muted-foreground">Select .zip or SKILL.md</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => folderInputRef.current?.click()}
                        className="flex items-center gap-2 cursor-pointer text-xs"
                      >
                        <FolderUp className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-medium">Upload Local Folder</span>
                          <span className="text-[10px] text-muted-foreground">Select skill directory</span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => loadSkills()}
                    disabled={skillsLoading}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    title="Refresh skills"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${skillsLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>

              {isDraggingSkill && (
                <div className="p-4 text-center text-xs font-medium text-primary bg-primary/10 rounded-lg border border-dashed border-primary">
                  Drop skill archive (.zip) or folder here to install immediately
                </div>
              )}

              {uploadStatus && (
                <div
                  className={`px-3 py-2 text-xs rounded-md flex items-center justify-between ${
                    uploadStatus.type === "success"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    {uploadStatus.type === "success" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                    )}
                    <span className="truncate">{uploadStatus.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUploadStatus(null)}
                    className="text-xs ml-2 hover:underline shrink-0 opacity-80 hover:opacity-100"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Search filter input */}
              <div className="relative shrink-0">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search skills by name or keyword..."
                  value={skillSearchQuery}
                  onChange={(e) => setSkillSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs bg-muted/20"
                />
              </div>

              {/* Skills list cards */}
              <div className="h-[360px] overflow-y-auto pr-1 space-y-2" style={{ scrollbarWidth: "thin" }}>
                {skillsLoading ? (
                  <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading available skills...
                  </div>
                ) : skills.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground rounded-lg border border-dashed border-border">
                    No skills found matching &quot;{skillSearchQuery}&quot;
                  </div>
                ) : (
                  skills
                    .filter(
                      (skill) =>
                        skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                        skill.description.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                        (skill.keywords && skill.keywords.some((k) => k.toLowerCase().includes(skillSearchQuery.toLowerCase())))
                    )
                    .map((skill) => (
                      <div
                        key={skill.id}
                        className="p-3 rounded-lg border border-border bg-card/40 hover:bg-card/80 transition-colors group/skill"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span className="font-semibold text-xs text-foreground truncate">
                              {skill.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopySkillName(skill.name)}
                              className="opacity-0 group-hover/skill:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground shrink-0"
                              title="Copy skill name"
                            >
                              {copiedSkillName === skill.name ? (
                                <Check className="h-3 w-3 text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                          {skill.category && (
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border border-border/50">
                              {skill.category}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {skill.description}
                        </p>
                        {skill.keywords && skill.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {skill.keywords.slice(0, 4).map((kw) => (
                              <span
                                key={kw}
                                className="text-[9px] bg-muted/60 text-muted-foreground px-1.5 py-0.2 rounded font-mono"
                              >
                                #{kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                )}
              </div>
            </TabsContent>

            {/* TAB 3: DIAGNOSTICS */}
            <TabsContent value="diagnostics" className="m-0 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-semibold">Server Diagnostics</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Query storage usage and run LLM model factory health checks.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fetchStorageInfo}
                  disabled={storageInfo.status === "loading"}
                  className="shrink-0 h-8 text-xs"
                >
                  {storageInfo.status === "loading" ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Server className="mr-2 h-3.5 w-3.5" />
                  )}
                  {storageInfo.status === "loading"
                    ? "Querying..."
                    : storageInfo.status === "success"
                      ? "Refresh"
                      : "Run Diagnostics"}
                </Button>
              </div>

              {storageInfo.status === "idle" ? (
                <div className="p-6 text-center text-xs text-muted-foreground rounded-lg border border-dashed border-border bg-muted/10">
                  Click &quot;Run Diagnostics&quot; above to query storage capacity and model availability from the backend server.
                </div>
              ) : (
                renderStorageInfoResult()
              )}
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="shrink-0 px-1 pt-4 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
