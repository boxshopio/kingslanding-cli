import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { ComputeService } from "../services/compute-service.js";
import { resolveComputeApiUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { createSpinner } from "../lib/output.js";
import { CLIError, AuthError } from "../lib/errors.js";

export function registerComposeDeploy(program: Command): void {
  program
    .command("compose-deploy")
    .description("Deploy a docker-compose.yml project to King's Landing compute")
    .option("-f, --file <path>", "Path to docker-compose.yml", "docker-compose.yml")
    .action(async (options: { file: string }) => {
      const cwd = process.cwd();
      const config = loadProjectConfig(cwd);

      const projectId = config?.project;
      if (!projectId) {
        throw new CLIError(
          "No project name. Run `kl init` or create a kl.json with a project field.",
        );
      }

      const composePath = path.resolve(cwd, options.file);
      if (!fs.existsSync(composePath)) {
        throw new CLIError("File not found: " + composePath);
      }

      const computeApiUrl = resolveComputeApiUrl(cwd);
      const authHeader = getAuthHeader(computeApiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const composeYaml = fs.readFileSync(composePath, "utf-8");
      const computeService = new ComputeService(computeApiUrl, authHeader);

      const spinner = createSpinner("Deploying...");
      spinner.start();

      try {
        const result = await computeService.deploy(projectId, composeYaml);
        spinner.stop();
        console.log("Live at " + result.url);
      } catch (err) {
        spinner.stop();
        throw err;
      }
    });
}
