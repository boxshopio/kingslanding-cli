import type {
  ApiClient,
  DeployKeyResponse,
  DeployKeyStatusResponse,
} from "../lib/api.js";

export class DeployKeyService {
  constructor(private readonly api: ApiClient) {}

  async create(
    projectName: string,
    teamId?: string,
  ): Promise<DeployKeyResponse> {
    return this.api.createDeployKey(projectName, teamId);
  }

  async status(
    projectName: string,
    teamId?: string,
  ): Promise<DeployKeyStatusResponse> {
    return this.api.getDeployKeyStatus(projectName, teamId);
  }

  async revoke(projectName: string, teamId?: string): Promise<void> {
    return this.api.revokeDeployKey(projectName, teamId);
  }
}
