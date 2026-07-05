"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { X, Search, RefreshCw, Sparkles, ChevronRight } from "lucide-react";
import { fetchAvailableSkills, type SkillItem } from "@/lib/skills";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SkillsDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectSkill: (skill: SkillItem) => void;
}

export function SkillsDrawer({ open, onClose, onSelectSkill }: SkillsDrawerProps) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAvailableSkills();
      setSkills(res.skills);
      setIsLive(res.isLive);
    } catch (err: any) {
      setError(err?.message || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadSkills();
    }
  }, [open, loadSkills]);

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const query = searchQuery.toLowerCase();
    return skills.filter((s) => {
      const name = (s.name || "").toLowerCase();
      const desc = (s.description || "").toLowerCase();
      const cat = (s.category || "").toLowerCase();
      const kwMatch = s.keywords?.some((kw) => kw.toLowerCase().includes(query)) || false;
      return name.includes(query) || desc.includes(query) || cat.includes(query) || kwMatch;
    });
  }, [skills, searchQuery]);

  // Click handler for backdrop to close the drawer
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="absolute inset-0 z-40 bg-background/40 backdrop-blur-[2px] transition-opacity duration-300"
        onClick={handleBackdropClick}
      />

      {/* Slide-out Drawer */}
      <div
        className={cn(
          "absolute top-0 bottom-0 right-0 z-50 flex flex-col border-l border-border bg-sidebar shadow-2xl transition-transform duration-300 ease-in-out",
          "w-full sm:w-[380px]"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--color-primary)]" />
            <h3 className="font-semibold text-foreground">Available Skills</h3>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-tertiary hover:text-primary"
              onClick={loadSkills}
              disabled={loading}
              title="Refresh skills list"
            >
              <RefreshCw size={16} className={cn(loading && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-tertiary hover:text-primary"
              onClick={onClose}
              title="Close drawer"
            >
              <X size={18} />
            </Button>
          </div>
        </div>

        {/* Live status banner */}
        <div className="flex items-center gap-2 border-b border-border bg-background/40 px-4 py-2 text-xs">
          <span className={cn("h-2 w-2 rounded-full", isLive ? "bg-success" : "bg-neutral-500")} />
          <span className="text-muted-foreground">
            {isLive ? "Connected to active backend agent environment" : "Showing pre-configured offline skills"}
          </span>
        </div>

        {/* Search */}
        <div className="relative p-4 border-b border-border bg-background/20">
          <Search size={16} className="absolute left-7 top-[22px] text-tertiary" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search capabilities, category, keywords..."
            className="pl-9 bg-background/50 border-border/80 focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>

        {/* Content list */}
        <ScrollArea className="h-0 flex-1">
          <div className="p-4 space-y-3">
            {loading ? (
              // Skeleton loading state
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-lg border border-border/50 bg-background/20 p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-border rounded w-1/3" />
                    <div className="h-4 bg-border rounded w-1/4" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 bg-border rounded w-5/6" />
                    <div className="h-3 bg-border rounded w-2/3" />
                  </div>
                  <div className="flex gap-2">
                    <div className="h-4 bg-border rounded w-12" />
                    <div className="h-4 bg-border rounded w-16" />
                  </div>
                </div>
              ))
            ) : error ? (
              <div className="text-center p-6 border border-red-200/20 bg-red-500/5 rounded-lg text-sm text-red-400">
                <p>{error}</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={loadSkills}>
                  Retry
                </Button>
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="text-center p-8 text-sm text-muted-foreground">
                No skills match your search.
              </div>
            ) : (
              filteredSkills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => onSelectSkill(skill)}
                  className={cn(
                    "w-full text-left rounded-lg border border-border bg-background/30 p-4 transition-all duration-200",
                    "hover:bg-[color-mix(in_srgb,var(--color-primary)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-primary)_30%,transparent)]",
                    "group flex gap-2 justify-between items-start"
                  )}
                >
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-foreground truncate group-hover:text-[var(--color-primary)]">
                        {skill.name}
                      </span>
                      {skill.category && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary/10 text-secondary border border-secondary/20">
                          {skill.category}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {skill.description}
                    </p>
                    {skill.keywords && skill.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {skill.keywords.map((kw) => (
                          <span
                            key={kw}
                            className="text-[9px] text-tertiary bg-background/60 border border-border px-1.5 py-0.5 rounded"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-tertiary mt-1 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
