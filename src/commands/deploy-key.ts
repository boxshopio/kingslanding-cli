import type { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { CLIError, AuthError } from "../lib/errors.js";
import { DeployKeyService } from "../services/deploy-key-service.js";

function resolveProject(options: { project?: string }): string {
  const config = loadProjectConfig(process.cwd());
  const projectName = options.project ?? config?.project;
  if (!projectName) {
    throw new CLIError(
      "No project name. Use --project <name> or run `kl init`.",
    );
  }
  return projectName;
}

function warnTeamDeprecation(team: string | undefined): void {
  if (team) {
    console.warn(
      "Warning: --team is no longer needed and will be removed in a future version. " +
      "The server now resolves project ownership automatically.",
    );
  }
}

export function registerDeployKeyCommand(program: Command): void {
  const cmd = program
    .command("deploy-key")
    .description("Manage deploy keys for CI/CD");

  cmd
    .command("create")
    .description("Create a deploy key for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug (deprecated, ignored)")
    .action(async (options: { project?: string; team?: string }) => {
      warnTeamDeprecation(options.team);

      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const projectName = resolveProject(options);
      const api = new ApiClient(apiUrl, authHeader);
      const deployKeyService = new DeployKeyService(api);
      const result = await deployKeyService.create(projectName);

      console.log();
      console.log("Deploy key created for " + projectName + ":");
      console.log();
      console.log("  " + result.key);
      console.log();
      console.log("Save this key now — it will not be shown again.");
      console.log("Set it as KL_DEPLOY_KEY in your CI/CD environment.");
    });

  cmd
    .command("revoke")
    .description("Revoke the deploy key for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug (deprecated, ignored)")
    .action(async (options: { project?: string; team?: string }) => {
      warnTeamDeprecation(options.team);

      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const projectName = resolveProject(options);

      const shouldRevoke = await confirm({
        message: "Revoke the deploy key for " + projectName + "? This cannot be undone.",
        default: false,
      });

      if (!shouldRevoke) {
        console.log("Cancelled.");
        return;
      }

      const api = new ApiClient(apiUrl, authHeader);
      const deployKeyService = new DeployKeyService(api);
      await deployKeyService.revoke(projectName);
      console.log("Deploy key revoked for " + projectName + ".");
    });

  cmd
    .command("status")
    .description("Check deploy key status for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug (deprecated, ignored)")
    .action(async (options: { project?: string; team?: string }) => {
      warnTeamDeprecation(options.team);

      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const projectName = resolveProject(options);
      const api = new ApiClient(apiUrl, authHeader);
      const deployKeyService = new DeployKeyService(api);
      const result = await deployKeyService.status(projectName);

      if (result.exists) {
        console.log("Deploy key active for " + projectName);
        console.log("  Prefix: " + result.key_prefix);
        if (result.created_at) {
          console.log(
            "  Created: " + new Date(result.created_at * 1000).toISOString(),
          );
        }
      } else {
        console.log("No deploy key configured for " + projectName + ".");
      }
    });
}
