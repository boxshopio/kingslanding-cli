import type {
  ApiClient,
  DeployKeyResponse,
  DeployKeyStatusResponse,
} from "../lib/api.js";

export class DeployKeyService {
  constructor(private readonly api: ApiClient) {}

  async create(projectName: string): Promise<DeployKeyResponse> {
    return this.api.createDeployKey(projectName);
  }

  async status(projectName: string): Promise<DeployKeyStatusResponse> {
    return this.api.getDeployKeyStatus(projectName);
  }

  async revoke(projectName: string): Promise<void> {
    return this.api.revokeDeployKey(projectName);
  }
}
