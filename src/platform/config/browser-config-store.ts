import type {
  ConfigStore,
  StandaloneConfig,
} from "@/platform/config/config-store";

const CONFIG_KEY = "deep-agent-config";

export class BrowserConfigStore implements ConfigStore {
  constructor(
    private readonly defaults: Partial<StandaloneConfig>,
    private readonly storageProvider: () => Storage | null = () =>
      typeof window === "undefined" ? null : window.localStorage,
  ) {}

  get(): StandaloneConfig | null {
    const storage = this.storageProvider();
    const stored = storage?.getItem(CONFIG_KEY);
    if (!stored) return this.defaultConfig();

    try {
      return this.normalize(JSON.parse(stored) as Partial<StandaloneConfig>);
    } catch {
      return this.defaultConfig();
    }
  }

  save(config: StandaloneConfig): void {
    this.storageProvider()?.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  private defaultConfig(): StandaloneConfig | null {
    if (!this.defaults.deploymentUrl || !this.defaults.assistantId) return null;
    return this.normalize(this.defaults);
  }

  private normalize(config: Partial<StandaloneConfig>): StandaloneConfig {
    return {
      deploymentUrl: config.deploymentUrl || this.defaults.deploymentUrl || "",
      assistantId: config.assistantId || this.defaults.assistantId || "",
      experimentId: config.experimentId || undefined,
      experimentVariant: config.experimentVariant || undefined,
      evalTrackingEnabled: config.evalTrackingEnabled ?? true,
    };
  }
}
