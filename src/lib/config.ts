import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_API_URL = "https://api.kingslanding.io";
const LOCAL_API_URL = "https://api.kl.test";
const DEFAULT_COMPUTE_API_URL = "https://compute.kingslanding.io";

export const KL_DIR = path.join(os.homedir(), ".kl");

export interface ProjectConfig {
  project: string;
  directory: string;
  team: string | null;
  api_url?: string;
  compute_api_url?: string;
}

export function resolveApiUrl(cwd?: string): string {
  const resolvedCwd = cwd ?? process.cwd();

  const envUrl = process.env.KL_API_URL;
  if (envUrl) return envUrl;

  const config = loadProjectConfig(resolvedCwd);
  if (config?.api_url) return config.api_url;

  const globalConfigPath = path.join(KL_DIR, "config.json");
  if (fs.existsSync(globalConfigPath)) {
    try {
      const raw = fs.readFileSync(globalConfigPath, "utf-8");
      const globalConfig = JSON.parse(raw) as { api_url?: string };
      if (globalConfig.api_url) return globalConfig.api_url;
    } catch {
      // Ignore malformed global config
    }
  }

  return DEFAULT_API_URL;
}

export function loadProjectConfig(cwd: string): ProjectConfig | null {
  const configPath = path.join(cwd, "kl.json");
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
    if (!parsed.project) return null;
    return {
      project: parsed.project,
      directory: parsed.directory ?? ".",
      team: parsed.team ?? null,
      api_url: parsed.api_url,
      compute_api_url: parsed.compute_api_url,
    };
  } catch {
    return null;
  }
}

export function writeProjectConfig(cwd: string, config: Omit<ProjectConfig, "api_url">): void {
  const configPath = path.join(cwd, "kl.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function resolveComputeApiUrl(cwd?: string): string {
  const envUrl = process.env.KL_COMPUTE_API_URL;
  if (envUrl) return envUrl;

  const resolvedCwd = cwd ?? process.cwd();
  const config = loadProjectConfig(resolvedCwd);
  if (config?.compute_api_url) return config.compute_api_url;

  const globalConfigPath = path.join(KL_DIR, "config.json");
  if (fs.existsSync(globalConfigPath)) {
    try {
      const raw = fs.readFileSync(globalConfigPath, "utf-8");
      const globalConfig = JSON.parse(raw) as {
        api_url?: string;
        compute_api_url?: string;
      };
      if (globalConfig.compute_api_url) return globalConfig.compute_api_url;
    } catch {
      // Ignore malformed global config
    }
  }

  return DEFAULT_COMPUTE_API_URL;
}

export function isLocalMode(apiUrl: string): boolean {
  return apiUrl === LOCAL_API_URL;
}

export function siteUrl(projectName: string, apiUrl: string): string {
  try {
    const host = new URL(apiUrl).hostname; // e.g. "api.kingslanding.io"
    const domain = host.replace(/^api\./, ""); // e.g. "kingslanding.io"
    return "https://" + projectName + "." + domain;
  } catch {
    return "https://" + projectName + ".kingslanding.io";
  }
}
