import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_API_URL = "https://api.kingslanding.io";
const LOCAL_API_URL = "https://api.kl.test";
export const KL_DIR = path.join(os.homedir(), ".kl");

export interface ProjectConfig {
  project: string;
  directory: string;
  api_url?: string;
}

export interface LoginPreferences {
  /** Whether `kl login` auto-opens the browser (default true). */
  browser?: boolean;
  /** Whether `kl login` always renders the QR code (default false / auto). */
  qr?: boolean;
}

export interface GlobalConfig {
  api_url?: string;
  login?: LoginPreferences;
}

/**
 * Load the global config from `<dir>/config.json` (default `~/.kl`). Returns an
 * empty object when the file is missing or malformed — config is always optional.
 */
export function loadGlobalConfig(dir: string = KL_DIR): GlobalConfig {
  const configPath = path.join(dir, "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as GlobalConfig;
  } catch {
    return {};
  }
}

export function resolveApiUrl(cwd?: string): string {
  const resolvedCwd = cwd ?? process.cwd();

  const envUrl = process.env.KL_API_URL;
  if (envUrl) return envUrl;

  const config = loadProjectConfig(resolvedCwd);
  if (config?.api_url) return config.api_url;

  const globalConfig = loadGlobalConfig();
  if (globalConfig.api_url) return globalConfig.api_url;

  return DEFAULT_API_URL;
}

export function loadProjectConfig(cwd: string): ProjectConfig | null {
  const configPath = path.join(cwd, "kl.json");
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.project || typeof parsed.project !== "string") return null;

    if ("team" in parsed && parsed.team != null) {
      console.warn(
        'Warning: The "team" field in kl.json is deprecated and will be ignored. ' +
          "The server now resolves project ownership automatically. " +
          "You can safely remove it.",
      );
    }

    return {
      project: parsed.project,
      directory: typeof parsed.directory === "string" ? parsed.directory : ".",
      api_url: typeof parsed.api_url === "string" ? parsed.api_url : undefined,
    };
  } catch {
    return null;
  }
}

export function writeProjectConfig(
  cwd: string,
  config: Pick<ProjectConfig, "project" | "directory">,
): void {
  const configPath = path.join(cwd, "kl.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
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
