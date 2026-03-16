import type { Command } from "commander";
import { input, select } from "@inquirer/prompts";
import { ApiClient } from "../lib/api.js";
import {
  resolveApiUrl,
  loadProjectConfig,
  writeProjectConfig,
} from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { CLIError } from "../lib/errors.js";
import { ProjectService } from "../services/project-service.js";

const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]{2,61}[a-z0-9]$/;

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a kl.json config in the current directory")
    .action(async () => {
      const cwd = process.cwd();
      const existing = loadProjectConfig(cwd);
      if (existing) {
        throw new CLIError(
          "kl.json already exists in this directory. Delete it first to re-initialize.",
        );
      }

      const project = await input({
        message: "Project name",
        validate: (value) => {
          if (!PROJECT_NAME_REGEX.test(value)) {
            return "Must be 4-63 characters, lowercase alphanumeric and hyphens, start/end with alphanumeric.";
          }
          return true;
        },
      });

      const directory = await input({
        message: "Deploy directory",
        default: ".",
      });

      let team: string | null = null;

      const apiUrl = resolveApiUrl(cwd);
      const authHeader = getAuthHeader(apiUrl);
      if (authHeader) {
        try {
          const api = new ApiClient(apiUrl, authHeader);
          const projectService = new ProjectService(api);
          const teams = await projectService.getUserTeams();

          if (teams.length > 0) {
            const choices = [
              { name: "Personal (no team)", value: "" },
              ...teams.map((t) => ({
                name: t.team.name + " (" + t.team.slug + ")",
                value: t.team.slug,
              })),
            ];

            const selected = await select({
              message: "Team",
              choices,
            });
            if (selected) team = selected;
          }
        } catch {
          // If we can't fetch teams (not logged in, etc.), skip the prompt
        }
      }

      writeProjectConfig(cwd, { project, directory, team });
      console.log("Created kl.json");
    });
}
