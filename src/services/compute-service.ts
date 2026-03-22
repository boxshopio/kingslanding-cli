import { ApiError, NetworkError } from "../lib/errors.js";

export interface ComputeDeployResult {
  project_id: string;
  url: string;
  state: string;
}

export interface ComputeProjectStatus {
  project_id: string;
  state: string;
  url: string;
}

export interface ComputeExecResult {
  output: string;
  returncode: number;
}

export class ComputeService {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeader: string,
  ) {}

  async deploy(
    projectId: string,
    composeYaml: string,
  ): Promise<ComputeDeployResult> {
    return this.request("POST", "/deploy", {
      project_id: projectId,
      compose_yaml: composeYaml,
    });
  }

  async listProjects(): Promise<ComputeProjectStatus[]> {
    return this.request("GET", "/projects");
  }

  async stopProject(projectId: string): Promise<void> {
    await this.request<void>("POST", "/projects/" + projectId + "/stop");
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request<void>("DELETE", "/projects/" + projectId);
  }

  async getLogs(
    projectId: string,
    service?: string,
    tail = 100,
  ): Promise<string> {
    const params = new URLSearchParams({ tail: String(tail) });
    if (service) params.set("service", service);
    const result = await this.request<{ output: string }>(
      "GET",
      "/projects/" + projectId + "/logs?" + params.toString(),
    );
    return result.output;
  }

  async getPs(projectId: string): Promise<string> {
    const result = await this.request<{ output: string }>(
      "GET",
      "/projects/" + projectId + "/ps",
    );
    return result.output;
  }

  async execCommand(
    projectId: string,
    service: string,
    command: string[],
  ): Promise<ComputeExecResult> {
    return this.request("POST", "/projects/" + projectId + "/exec", {
      service,
      command,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
    };
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
        const json = (await response.json()) as Record<string, unknown>;
        if (typeof json.detail === "string") detail = json.detail;
      } catch {
        // Non-JSON error body
      }
      throw new ApiError(response.status, detail);
    }

    return response.json() as Promise<T>;
  }
}
