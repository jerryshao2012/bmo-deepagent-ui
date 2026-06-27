import { getBrowserSessionToken } from "./langgraph-client";
import { getConfig } from "./config";

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  source?: string;
  isRemovable?: boolean;
  category?: string;
  keywords?: string[];
}

export async function fetchAvailableSkills(
  deploymentUrl?: string
): Promise<{ skills: SkillItem[]; isLive: boolean }> {
  const config = getConfig();
  const url = deploymentUrl || config?.deploymentUrl;

  if (!url) {
    return { skills: [], isLive: false };
  }

  try {
    const token = getBrowserSessionToken();
    const cleanUrl = url.replace(/\/+$/, "");
    const response = await fetch(`${cleanUrl}/skills`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": token,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data && Array.isArray(data.skills)) {
      const fetchedSkills: SkillItem[] = data.skills.map((s: any) => ({
        id: s.id || s.name || "unknown-skill",
        name: s.name || s.id || "Unknown Skill",
        description: s.description || "No description provided.",
        source: s.source || "backend",
        isRemovable: Boolean(s.is_removable || s.isRemovable || s.source === "uploaded"),
        category: s.category || "Agent Capability",
        keywords: s.keywords || [],
      }));

      return { skills: fetchedSkills, isLive: true };
    }
  } catch (err) {
    console.warn("Failed to fetch live skills from backend:", err);
  }

  return { skills: [], isLive: false };
}

export async function uploadSkill(
  input: File | File[] | { file: File; path?: string }[],
  deploymentUrl?: string
): Promise<{ success: boolean; message: string; skillName?: string }> {
  const config = getConfig();
  const url = deploymentUrl || config?.deploymentUrl;

  if (!url) {
    throw new Error("No deployment URL configured. Save settings first.");
  }

  const token = getBrowserSessionToken();
  const cleanUrl = url.replace(/\/+$/, "");
  const formData = new FormData();

  if (Array.isArray(input)) {
    input.forEach((item) => {
      if (typeof item === "object" && "file" in item && item.file instanceof File) {
        formData.append("files", item.file);
        formData.append("paths", item.path || item.file.webkitRelativePath || item.file.name);
      } else if (item instanceof File) {
        formData.append("files", item);
        formData.append("paths", item.webkitRelativePath || item.name);
      }
    });
  } else {
    formData.append("file", input);
  }

  const response = await fetch(`${cleanUrl}/skills/upload`, {
    method: "POST",
    headers: {
      "X-API-Key": token,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  const data = await response.json();
  return {
    success: true,
    message: data.message || "Skill uploaded successfully.",
    skillName: data.skill_name,
  };
}

export async function deleteSkill(
  skillId: string,
  deploymentUrl?: string
): Promise<{ success: boolean; message: string }> {
  const config = getConfig();
  const url = deploymentUrl || config?.deploymentUrl;

  if (!url) {
    throw new Error("No deployment URL configured. Save settings first.");
  }

  const token = getBrowserSessionToken();
  const cleanUrl = url.replace(/\/+$/, "");

  const response = await fetch(`${cleanUrl}/skills/${encodeURIComponent(skillId)}`, {
    method: "DELETE",
    headers: {
      "X-API-Key": token,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  const data = await response.json();
  return {
    success: true,
    message: data.message || "Skill removed successfully.",
  };
}
