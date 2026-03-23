import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, getComputeUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader, loadCredentials, isDeployKeyAuth } from "../lib/auth.js";
import { buildFileManifest } from "../lib/files.js";
import { createSpinner, formatBytes } from "../lib/output.js";
import { CLIError, ApiError, AuthError } from "../lib/errors.js";
import { AuthService } from "../services/auth-service.js";
import { DeployService, defaultReadFile } from "../services/deploy-service.js";
import { ProjectService } from "../services/project-service.js";
import { ComputeService } from "../services/compute-service.js";

const COMPOSE_FILE_NAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

function findComposeFile(dir: string, explicitFile?: string): string | null {
  if (explicitFile) {
    const resolved = path.resolve(dir, explicitFile);
    return fs.existsSync(resolved) ? resolved : null;
  }
  for (const name of COMPOSE_FILE_NAMES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description("Deploy a directory to King's Landing")
    .argument("[dir]", "Directory to deploy")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug")
    .option("--create", "Create project if it does not exist")
    .option("-v, --verbose", "Show detailed output")
    .option("-f, --file <path>", "Path to compose file (compose deploy only)")
    .action(
      async (
        dirArg: string | undefined,
        options: {
          project?: string;
          team?: string;
          create?: boolean;
          verbose?: boolean;
          file?: string;
        },
      ) => {
        const cwd = process.cwd();
        const config = loadProjectConfig(cwd);
        const apiUrl = resolveApiUrl(cwd);

        // Resolve deploy directory early so compose detection uses the right path
        const relativeDir = dirArg ?? config?.directory ?? ".";
        const deployDir = path.resolve(cwd, relativeDir);

        // Auto-detect compose deploy
        const composePath = findComposeFile(deployDir, options.file);
        if (composePath) {
          const projectName = options.project ?? config?.project;
          if (!projectName) {
            throw new CLIError(
              "No project name. Use --project <name> or run `kl init`.",
            );
          }

          const authHeader = getAuthHeader(apiUrl);
          if (!authHeader) {
            throw new AuthError("Not logged in. Run `kl login` first.");
          }

          const computeApiUrl = await getComputeUrl();
          const composeYaml = fs.readFileSync(composePath, "utf-8");
          const computeService = new ComputeService(computeApiUrl, authHeader);

          const spinner = createSpinner("Deploying...");
          spinner.start();

          try {
            const result = await computeService.deploy(projectName, composeYaml);
            spinner.stop();
            console.log("Live at " + result.url);
          } catch (err) {
            spinner.stop();
            throw err;
          }
          return;
        }

        // Resolve project name
        const projectName = options.project ?? config?.project;
        if (!projectName) {
          throw new CLIError(
            "No project name. Use --project <name> or run `kl init`.",
          );
        }

        // Resolve team
        let teamId: string | undefined;
        const teamSlug = options.team ?? config?.team;

        // Ensure auth
        let authHeader = getAuthHeader(apiUrl);
        if (!authHeader) {
          throw new AuthError("Not logged in. Run `kl login` first.");
        }

        const api = new ApiClient(apiUrl, authHeader);

        // Refresh token if needed (JWT only, not deploy keys)
        if (!isDeployKeyAuth()) {
          const creds = loadCredentials(apiUrl);
          if (creds) {
            const authService = new AuthService(api, apiUrl);
            await authService.refreshIfNeeded(creds);
            // Re-read auth header after potential refresh
            authHeader = getAuthHeader(apiUrl);
            if (authHeader) {
              api.updateAuthHeader(authHeader);
            }
          }
        }

        // Resolve team slug to ID
        if (teamSlug) {
          const projectService = new ProjectService(api);
          teamId = await projectService.resolveTeamId(teamSlug);
        }

        // Build manifest
        const files = buildFileManifest(deployDir, cwd);
        if (options.verbose) {
          console.log(
            "Deploying " +
              files.length +
              " files (" +
              formatBytes(files.reduce((sum, f) => sum + f.size, 0)) +
              ") from " +
              deployDir,
          );
        }

        const deployService = new DeployService(api);
        const spinner = createSpinner("Deploying...");
        spinner.start();

        const startTime = Date.now();

        const runDeploy = async (create?: boolean) => {
          return deployService.deploy({
            projectName,
            files,
            readFile: defaultReadFile,
            onProgress: (completed, total) => {
              spinner.text = "Uploading " + completed + "/" + total + " files...";
            },
            create,
            teamId,
          });
        };

        try {
          let result;
          try {
            result = await runDeploy(options.create);
          } catch (err) {
            if (
              err instanceof ApiError &&
              err.status === 404 &&
              !options.create
            ) {
              spinner.stop();

              const isTTY = process.stdout.isTTY;
              if (isTTY) {
                const shouldCreate = await confirm({
                  message:
                    'Project "' +
                    projectName +
                    '" does not exist. Create it?',
                  default: true,
                });
                if (!shouldCreate) {
                  throw new CLIError("Deploy cancelled.");
                }
                spinner.start();
                result = await runDeploy(true);
              } else {
                throw new CLIError(
                  'Project "' +
                    projectName +
                    '" not found. Use --create to create it.',
                );
              }
            } else {
              throw err;
            }
          }

          spinner.stop();
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

          if (options.verbose) {
            console.log(
              "Deployed " +
                result.files +
                " files (" +
                formatBytes(result.total_size) +
                ") in " +
                elapsed +
                "s",
            );
          }

          console.log("Done. " + result.url);
        } catch (err) {
          spinner.stop();
          throw err;
        }
      },
    );
}
