import type { Command } from "commander";
import { input } from "@inquirer/prompts";
import { loadProjectConfig, writeProjectConfig } from "../lib/config.js";
import { CLIError } from "../lib/errors.js";

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

      writeProjectConfig(cwd, { project, directory });
      console.log("Created kl.json");
    });
}
