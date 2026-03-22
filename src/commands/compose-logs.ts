import type { Command } from "commander";
import { ComputeService } from "../services/compute-service.js";
import { resolveComputeApiUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { CLIError, AuthError } from "../lib/errors.js";

export function registerComposeLogsCommand(program: Command): void {
  program
    .command("logs")
    .description("Fetch logs from the current project")
    .argument("[service]", "Service name to filter logs")
    .option("--tail <n>", "Number of lines to show from the end", "100")
    .action(async (service: string | undefined, options: { tail: string }) => {
      const cwd = process.cwd();
      const config = loadProjectConfig(cwd);

      const projectId = config?.project;
      if (!projectId) {
        throw new CLIError(
          "No project name. Run `kl init` or create a kl.json with a project field.",
        );
      }

      const tail = parseInt(options.tail, 10);
      if (isNaN(tail) || tail < 1) {
        throw new CLIError("--tail must be a positive integer.");
      }

      const computeApiUrl = resolveComputeApiUrl(cwd);
      const authHeader = getAuthHeader(computeApiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const computeService = new ComputeService(computeApiUrl, authHeader);
      const output = await computeService.getLogs(projectId, service, tail);
      process.stdout.write(output);
    });
}
