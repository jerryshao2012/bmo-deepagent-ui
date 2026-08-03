export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  experimentId?: string;
  experimentVariant?: string;
  evalTrackingEnabled?: boolean;
}

export interface ConfigStore {
  get(): StandaloneConfig | null;
  save(config: StandaloneConfig): void;
}
