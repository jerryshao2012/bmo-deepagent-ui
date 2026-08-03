import { BrowserConfigStore } from "@/platform/config/browser-config-store";
import type { StandaloneConfig } from "@/platform/config/config-store";

export type { StandaloneConfig } from "@/platform/config/config-store";

const DEFAULT_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL;
const DEFAULT_ASSISTANT_ID = process.env.NEXT_PUBLIC_ASSISTANT_ID;
const configStore = new BrowserConfigStore({
  deploymentUrl: DEFAULT_DEPLOYMENT_URL,
  assistantId: DEFAULT_ASSISTANT_ID,
});

export function getConfig(): StandaloneConfig | null {
  return configStore.get();
}

export function saveConfig(config: StandaloneConfig): void {
  configStore.save(config);
}
