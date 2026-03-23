import type { Command } from "commander";
import { ComputeService } from "../services/compute-service.js";
import { resolveApiUrl, getComputeUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { CLIError, AuthError } from "../lib/errors.js";

export function registerComposeRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run a one-off command in a project service container")
    .argument("<service>", "Service name to run the command in")
    .argument("<command...>", "Command and arguments to run")
    .action(async (service: string, command: string[]) => {
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
      const result = await computeService.execCommand(
        projectId,
        service,
        command,
      );

      process.stdout.write(result.output);
      process.exit(result.returncode);
    });
}
