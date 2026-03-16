#!/usr/bin/env -S node --no-warnings

import { Command } from "commander";
import { registerLoginCommand } from "./commands/login.js";
import { registerLogoutCommand } from "./commands/logout.js";
import { registerInitCommand } from "./commands/init.js";
import { registerDeployCommand } from "./commands/deploy.js";
import { registerProjectsCommand } from "./commands/projects.js";
import { registerWhoamiCommand } from "./commands/whoami.js";
import { registerDeployKeyCommand } from "./commands/deploy-key.js";
import { CLIError } from "./lib/errors.js";
import { checkCredentialPermissions } from "./lib/auth.js";

const warning = checkCredentialPermissions();
if (warning) console.warn(warning);

const program = new Command();

program
  .name("kl")
  .description("Deploy static sites to King's Landing")
  .version("0.1.0");

registerLoginCommand(program);
registerLogoutCommand(program);
registerInitCommand(program);
registerDeployCommand(program);
registerProjectsCommand(program);
registerWhoamiCommand(program);
registerDeployKeyCommand(program);

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CLIError) {
    console.error(err.message);
    process.exit(err.exitCode);
  }
  console.error(err instanceof Error ? err.message : "An unexpected error occurred.");
  process.exit(1);
});
