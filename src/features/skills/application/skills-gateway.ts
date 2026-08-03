export interface SkillItem {
  id: string;
  name: string;
  description: string;
  source?: string;
  isRemovable?: boolean;
  category?: string;
  keywords?: string[];
}

export type SkillUploadInput = File | File[] | { file: File; path?: string }[];

export interface SkillsGateway {
  list(): Promise<{ skills: SkillItem[]; isLive: boolean }>;
  upload(
    input: SkillUploadInput
  ): Promise<{ success: boolean; message: string; skillName?: string }>;
  delete(skillId: string): Promise<{ success: boolean; message: string }>;
}
