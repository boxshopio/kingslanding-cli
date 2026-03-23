import type { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { ComputeService } from "../services/compute-service.js";
import { resolveApiUrl, getComputeUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { createSpinner } from "../lib/output.js";
import { CLIError, AuthError } from "../lib/errors.js";

export function registerComposeDownCommand(program: Command): void {
  program
    .command("down")
    .description("Delete the current project and all its containers")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options: { yes?: boolean }) => {
      const cwd = process.cwd();
      const config = loadProjectConfig(cwd);

      const projectId = config?.project;
      if (!projectId) {
        throw new CLIError(
          "No project name. Run `kl init` or create a kl.json with a project field.",
        );
      }

      if (!options.yes) {
        const isTTY = process.stdout.isTTY;
        if (isTTY) {
          const confirmed = await confirm({
            message:
              'Delete project "' +
              projectId +
              '" and all its containers? This cannot be undone.',
            default: false,
          });
          if (!confirmed) {
            throw new CLIError("Aborted.");
          }
        } else {
          throw new CLIError(
            "Use --yes to confirm deletion in non-interactive mode.",
          );
        }
      }

      const apiUrl = resolveApiUrl(cwd);
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const computeApiUrl = await getComputeUrl();
      const computeService = new ComputeService(computeApiUrl, authHeader);

      const spinner = createSpinner("Deleting project...");
      spinner.start();

      try {
        await computeService.deleteProject(projectId);
        spinner.stop();
        console.log('Project "' + projectId + '" deleted.');
      } catch (err) {
        spinner.stop();
        throw err;
      }
    });
}
