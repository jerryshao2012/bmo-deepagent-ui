export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
}

const CONFIG_KEY = "deep-agent-config";

const DEFAULT_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_LANGGRAPH_URL ||
  process.env.NEXT_PUBLIC_DEPLOYMENT_URL;
const DEFAULT_ASSISTANT_ID = process.env.NEXT_PUBLIC_ASSISTANT_ID;

export function getConfig(): StandaloneConfig | null {
  if (typeof window === "undefined") {
    if (DEFAULT_DEPLOYMENT_URL && DEFAULT_ASSISTANT_ID) {
      return {
        deploymentUrl: DEFAULT_DEPLOYMENT_URL,
        assistantId: DEFAULT_ASSISTANT_ID,
      };
    }
    return null;
  }

  const stored = localStorage.getItem(CONFIG_KEY);
  if (!stored) {
    if (DEFAULT_DEPLOYMENT_URL && DEFAULT_ASSISTANT_ID) {
      return {
        deploymentUrl: DEFAULT_DEPLOYMENT_URL,
        assistantId: DEFAULT_ASSISTANT_ID,
      };
    }
    return null;
  }

  try {
    const config = JSON.parse(stored);
    return {
      deploymentUrl: config.deploymentUrl || DEFAULT_DEPLOYMENT_URL || "",
      assistantId: config.assistantId || DEFAULT_ASSISTANT_ID || "",
      langsmithApiKey: config.langsmithApiKey,
    };
  } catch {
    if (DEFAULT_DEPLOYMENT_URL && DEFAULT_ASSISTANT_ID) {
      return {
        deploymentUrl: DEFAULT_DEPLOYMENT_URL,
        assistantId: DEFAULT_ASSISTANT_ID,
      };
    }
    return null;
  }
}

export function saveConfig(config: StandaloneConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
