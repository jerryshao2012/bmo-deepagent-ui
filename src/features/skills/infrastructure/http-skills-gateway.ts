import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";
import { authenticatedFetch } from "@/platform/http/authenticated-fetch";

import type {
  SkillItem,
  SkillsGateway,
  SkillUploadInput,
} from "../application/skills-gateway";

export class HttpSkillsGateway implements SkillsGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async list(): Promise<{ skills: SkillItem[]; isLive: boolean }> {
    try {
      const response = await this.request("/skills", { method: "GET" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data?.skills)) return { skills: [], isLive: false };
      return {
        skills: data.skills.map((skill: Record<string, any>) => ({
          id: skill.id || skill.name || "unknown-skill",
          name: skill.name || skill.id || "Unknown Skill",
          description: skill.description || "No description provided.",
          source: skill.source || "backend",
          isRemovable: Boolean(
            skill.is_removable || skill.isRemovable || skill.source === "uploaded"
          ),
          category: skill.category || "Agent Capability",
          keywords: skill.keywords || [],
        })),
        isLive: true,
      };
    } catch (error) {
      console.warn("Failed to fetch live skills from backend:", error);
      return { skills: [], isLive: false };
    }
  }

  async upload(input: SkillUploadInput) {
    const formData = new FormData();
    if (Array.isArray(input)) {
      input.forEach((item) => {
        const file = "file" in item ? item.file : item;
        const path = "file" in item ? item.path : undefined;
        formData.append("files", file);
        formData.append("paths", path || file.webkitRelativePath || file.name);
      });
    } else {
      formData.append("file", input);
    }
    const response = await this.request("/skills/upload", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw await this.responseError(response);
    const data = await response.json();
    return {
      success: true,
      message: data.message || "Skill uploaded successfully.",
      skillName: data.skill_name,
    };
  }

  async delete(skillId: string) {
    const response = await this.request(
      `/skills/${encodeURIComponent(skillId)}`,
      { method: "DELETE" }
    );
    if (!response.ok) throw await this.responseError(response);
    const data = await response.json();
    return {
      success: true,
      message: data.message || "Skill removed successfully.",
    };
  }

  private request(path: string, init?: RequestInit): Promise<Response> {
    return authenticatedFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "X-API-Key": this.token, ...init?.headers },
    });
  }

  private async responseError(response: Response): Promise<Error> {
    const text = await response.text();
    return new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }
}

export function createConfiguredSkillsGateway(deploymentUrl?: string) {
  const url = deploymentUrl || getConfig()?.deploymentUrl;
  if (!url) return null;
  return new HttpSkillsGateway(
    url.replace(/\/+$/, ""),
    getBrowserSessionToken()
  );
}
