import { ApiError, NetworkError } from "./errors.js";

export interface FileManifestEntry {
  path: string;
  size: number;
  content_type: string;
}

export interface DeployInitiateRequest {
  files: FileManifestEntry[];
  team_id?: string;
}

export interface DeployInitiateResponse {
  deployment_id: string;
  expires_at: number;
  uploads: { path: string; presigned_url: string }[];
  project_created: boolean;
}

export interface DeployFinalizeResponse {
  url: string;
  deployment_id: string;
  files: number;
  total_size: number;
}

export interface AccountInfo {
  email: string;
  handle: string | null;
  plan_tier: string;
  created_at: number;
  status: string;
}

export interface TeamInfo {
  team: { team_id: string; name: string; slug: string };
  role: string;
}

export interface ProjectInfo {
  name: string;
  file_count: number;
  total_size_bytes: number;
  cloudfront_url: string;
  last_updated: number;
}

export interface DeployKeyResponse {
  key: string;
  key_prefix: string;
  message: string;
}

export interface DeployKeyStatusResponse {
  exists: boolean;
  key_prefix: string | null;
  created_at: number | null;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
}

export interface DeviceTokenResponse {
  status: string;
  tokens: {
    access_token: string;
    refresh_token: string;
    id_token: string;
  } | null;
}

export interface RefreshResponse {
  access_token: string;
  id_token: string;
  expires_in: number;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private authHeader: string | null,
  ) {}

  updateAuthHeader(header: string): void {
    this.authHeader = header;
  }

  async createDeviceCode(): Promise<DeviceCodeResponse> {
    return this.request("POST", "/auth/device/code", undefined, false);
  }

  async pollDeviceToken(deviceCode: string): Promise<DeviceTokenResponse> {
    return this.request(
      "POST",
      "/auth/device/token",
      { device_code: deviceCode },
      false,
    );
  }

  async refreshToken(refreshToken: string): Promise<RefreshResponse> {
    return this.request(
      "POST",
      "/auth/refresh",
      { refresh_token: refreshToken },
      false,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    await this.request("POST", "/auth/logout", {
      refresh_token: refreshToken,
    });
  }

  async getAccount(): Promise<AccountInfo> {
    return this.request("GET", "/account");
  }

  async listTeams(): Promise<TeamInfo[]> {
    return this.request("GET", "/teams");
  }

  async listProjects(
    limit = 100,
  ): Promise<{ items: ProjectInfo[]; next_token: string | null }> {
    return this.request("GET", "/projects?limit=" + limit);
  }

  async listTeamProjects(teamId: string): Promise<{ items: ProjectInfo[] }> {
    return this.request("GET", "/teams/" + teamId + "/projects");
  }

  async initiateDeploy(
    projectName: string,
    body: DeployInitiateRequest,
    options?: { create?: boolean },
  ): Promise<DeployInitiateResponse> {
    const qs = options?.create ? "?create=true" : "";
    return this.request(
      "POST",
      "/projects/" + projectName + "/deploy" + qs,
      body,
    );
  }

  async finalizeDeploy(
    projectName: string,
    deploymentId: string,
    teamId?: string,
  ): Promise<DeployFinalizeResponse> {
    const qs = teamId ? "?team_id=" + teamId : "";
    return this.request(
      "POST",
      "/projects/" +
        projectName +
        "/deploy/" +
        deploymentId +
        "/finalize" +
        qs,
    );
  }

  async createDeployKey(
    projectName: string,
    teamId?: string,
  ): Promise<DeployKeyResponse> {
    const qs = teamId ? "?team_id=" + teamId : "";
    return this.request(
      "POST",
      "/projects/" + projectName + "/deploy-key" + qs,
    );
  }

  async getDeployKeyStatus(
    projectName: string,
    teamId?: string,
  ): Promise<DeployKeyStatusResponse> {
    const qs = teamId ? "?team_id=" + teamId : "";
    return this.request(
      "GET",
      "/projects/" + projectName + "/deploy-key" + qs,
    );
  }

  async revokeDeployKey(
    projectName: string,
    teamId?: string,
  ): Promise<void> {
    const qs = teamId ? "?team_id=" + teamId : "";
    await this.request(
      "DELETE",
      "/projects/" + projectName + "/deploy-key" + qs,
    );
  }

  async uploadFile(
    presignedUrl: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(presignedUrl, {
        method: "PUT",
        body,
        headers: { "Content-Type": contentType },
      });
    } catch {
      throw new NetworkError(presignedUrl);
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        "S3 upload failed: " + response.statusText,
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<T> {
    const url = this.baseUrl + "/api/v1" + path;
    const headers: Record<string, string> = {};

    if (auth && this.authHeader) {
      headers["Authorization"] = this.authHeader;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new NetworkError(this.baseUrl);
    }

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      let detail = "HTTP " + response.status;
      try {
        const json = await response.json();
        if (json.detail) detail = json.detail;
      } catch {
        // Non-JSON error body
      }
      throw new ApiError(response.status, detail);
    }

    return response.json() as Promise<T>;
  }
}
