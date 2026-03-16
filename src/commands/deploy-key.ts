import type { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { CLIError, AuthError } from "../lib/errors.js";
import { DeployKeyService } from "../services/deploy-key-service.js";
import { ProjectService } from "../services/project-service.js";

function resolveProjectAndTeam(options: {
  project?: string;
  team?: string;
}): { projectName: string; teamSlug: string | undefined } {
  const config = loadProjectConfig(process.cwd());
  const projectName = options.project ?? config?.project;
  if (!projectName) {
    throw new CLIError(
      "No project name. Use --project <name> or run `kl init`.",
    );
  }
  const teamSlug = options.team ?? config?.team ?? undefined;
  return { projectName, teamSlug };
}

export function registerDeployKeyCommand(program: Command): void {
  const cmd = program
    .command("deploy-key")
    .description("Manage deploy keys for CI/CD");

  cmd
    .command("create")
    .description("Create a deploy key for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug")
    .action(async (options: { project?: string; team?: string }) => {
      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const { projectName, teamSlug } = resolveProjectAndTeam(options);
      const api = new ApiClient(apiUrl, authHeader);

      let teamId: string | undefined;
      if (teamSlug) {
        const projectService = new ProjectService(api);
        teamId = await projectService.resolveTeamId(teamSlug);
      }

      const deployKeyService = new DeployKeyService(api);
      const result = await deployKeyService.create(projectName, teamId);

      console.log();
      console.log("Deploy key created for " + projectName + ":");
      console.log();
      console.log("  " + result.key);
      console.log();
      console.log(
        "Save this key now — it will not be shown again.",
      );
      console.log(
        "Set it as KL_DEPLOY_KEY in your CI/CD environment.",
      );
    });

  cmd
    .command("revoke")
    .description("Revoke the deploy key for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug")
    .action(async (options: { project?: string; team?: string }) => {
      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const { projectName, teamSlug } = resolveProjectAndTeam(options);

      const shouldRevoke = await confirm({
        message:
          "Revoke the deploy key for " +
          projectName +
          "? This cannot be undone.",
        default: false,
      });

      if (!shouldRevoke) {
        console.log("Cancelled.");
        return;
      }

      const api = new ApiClient(apiUrl, authHeader);

      let teamId: string | undefined;
      if (teamSlug) {
        const projectService = new ProjectService(api);
        teamId = await projectService.resolveTeamId(teamSlug);
      }

      const deployKeyService = new DeployKeyService(api);
      await deployKeyService.revoke(projectName, teamId);
      console.log("Deploy key revoked for " + projectName + ".");
    });

  cmd
    .command("status")
    .description("Check deploy key status for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug")
    .action(async (options: { project?: string; team?: string }) => {
      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const { projectName, teamSlug } = resolveProjectAndTeam(options);
      const api = new ApiClient(apiUrl, authHeader);

      let teamId: string | undefined;
      if (teamSlug) {
        const projectService = new ProjectService(api);
        teamId = await projectService.resolveTeamId(teamSlug);
      }

      const deployKeyService = new DeployKeyService(api);
      const result = await deployKeyService.status(projectName, teamId);

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
