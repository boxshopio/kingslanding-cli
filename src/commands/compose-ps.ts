import type { Command } from "commander";
import { ComputeService } from "../services/compute-service.js";
import { resolveApiUrl, getComputeUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { CLIError, AuthError } from "../lib/errors.js";

export function registerComposePsCommand(program: Command): void {
  program
    .command("ps")
    .description("Show running containers for the current project")
    .action(async () => {
      const cwd = process.cwd();
      const config = loadProjectConfig(cwd);

      const projectId = config?.project;
      if (!projectId) {
        throw new CLIError(
          "No project name. Run `kl init` or create a kl.json with a project field.",
        );
      }

      const apiUrl = resolveApiUrl(cwd);
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const computeApiUrl = await getComputeUrl();
      const computeService = new ComputeService(computeApiUrl, authHeader);
      const output = await computeService.getPs(projectId);
      process.stdout.write(output);
    });
}
