import type { Command } from "commander";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl } from "../lib/config.js";
import { getAuthHeader, isDeployKeyAuth } from "../lib/auth.js";
import { AuthError } from "../lib/errors.js";

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show the current authenticated user")
    .action(async () => {
      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      if (isDeployKeyAuth()) {
        console.log("Authenticated via deploy key");
        return;
      }

      const api = new ApiClient(apiUrl, authHeader);
      const [account, teams] = await Promise.all([
        api.getAccount(),
        api.listTeams(),
      ]);

      console.log(account.email + " (" + account.plan_tier + ")");

      if (teams.length > 0) {
        console.log();
        console.log("Teams:");
        for (const t of teams) {
          console.log("  " + t.team.name + " (" + t.team.slug + ") — " + t.role.toLowerCase());
        }
      }
    });
}
