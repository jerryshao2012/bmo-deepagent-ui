export interface SessionProvider {
  getToken(): string;
  refresh(deploymentUrl: string): Promise<boolean>;
  handleInvalidSession(): void;
}
