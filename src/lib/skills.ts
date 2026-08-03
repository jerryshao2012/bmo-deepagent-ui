import type {
  SkillItem,
  SkillUploadInput,
} from "@/features/skills/application/skills-gateway";
import { createConfiguredSkillsGateway } from "@/features/skills/infrastructure/http-skills-gateway";

export type { SkillItem };

export async function fetchAvailableSkills(deploymentUrl?: string) {
  return (
    (await createConfiguredSkillsGateway(deploymentUrl)?.list()) || {
      skills: [],
      isLive: false,
    }
  );
}

export async function uploadSkill(
  input: SkillUploadInput,
  deploymentUrl?: string
) {
  const gateway = createConfiguredSkillsGateway(deploymentUrl);
  if (!gateway) {
    throw new Error("No deployment URL configured. Save settings first.");
  }
  return gateway.upload(input);
}

export async function deleteSkill(skillId: string, deploymentUrl?: string) {
  const gateway = createConfiguredSkillsGateway(deploymentUrl);
  if (!gateway) {
    throw new Error("No deployment URL configured. Save settings first.");
  }
  return gateway.delete(skillId);
}
