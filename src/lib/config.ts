import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CLIError } from "./errors.js";

const DEFAULT_API_URL = "https://api.kingslanding.io";
const LOCAL_API_URL = "https://api.kl.test";

/**
 * Environments shipped with every install. `prod` is the zero-config default;
 * `local` lines up with {@link isLocalMode}'s bypass auth. A user's
 * `environments` map in config.json is merged over these, so any built-in can
 * be repointed.
 */
const BUILTIN_ENVIRONMENTS: Record<string, string> = {
  prod: DEFAULT_API_URL,
  local: LOCAL_API_URL,
};

/** Pre-XDG location; migrated to {@link KL_DIR} on first run. */
export const LEGACY_KL_DIR = path.join(os.homedir(), ".kl");

/**
 * Resolve kl's config/state directory following the XDG Base Directory Spec:
 * `$XDG_CONFIG_HOME/kl`, defaulting to `~/.config/kl`. Per the spec, a
 * non-absolute `$XDG_CONFIG_HOME` is invalid and ignored. Both `config.json`
 * and `credentials.json` live here (single-dir model, like GitHub's `gh`).
 */
export function resolveKlDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "kl");
}

export const KL_DIR = resolveKlDir();

/**
 * One-time migration of the legacy `~/.kl` directory to {@link KL_DIR}. Runs at
 * CLI startup. No-op if the legacy dir is absent or the new dir already exists,
 * so it never clobbers current config. Best-effort: a failure warns rather than
 * crashing, since the user can always re-authenticate with `kl login`.
 */
export function migrateLegacyConfigDir(
  legacyDir: string = LEGACY_KL_DIR,
  newDir: string = KL_DIR,
): void {
  if (legacyDir === newDir) return;
  if (!fs.existsSync(legacyDir) || fs.existsSync(newDir)) return;
  try {
    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    fs.renameSync(legacyDir, newDir);
    console.warn("Migrated kl config from " + legacyDir + " to " + newDir);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      "Warning: could not migrate " +
        legacyDir +
        " to " +
        newDir +
        " (" +
        reason +
        "). Run 'kl login' to re-authenticate.",
    );
  }
}

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
  environments?: Record<string, string>;
}

/**
 * Load the global config from `<dir>/config.json` (default `~/.config/kl`). Returns an
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

/**
 * Resolve a named environment to its API URL. Built-in envs are merged with the
 * caller-supplied user envs (user wins). An unknown name throws a {@link CLIError}
 * listing the known names, so the top-level handler prints it and exits cleanly.
 */
export function resolveNamedEnv(name: string, userEnvs: Record<string, string> = {}): string {
  const envs = { ...BUILTIN_ENVIRONMENTS, ...userEnvs };
  const url = envs[name];
  if (!url) {
    const known = Object.keys(envs).sort().join(", ");
    throw new CLIError(
      `Unknown environment '${name}'. Known: ${known}\n` +
        `  (define under "environments" in ${path.join(KL_DIR, "config.json")})`,
    );
  }
  return url;
}

export function resolveApiUrl(cwd?: string, envName?: string): string {
  if (envName) {
    return resolveNamedEnv(envName, loadGlobalConfig().environments ?? {});
  }

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
