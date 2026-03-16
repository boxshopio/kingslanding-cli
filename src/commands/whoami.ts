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
      const account = await api.getAccount();
      console.log(account.email + " (" + account.plan_tier + ")");
    });
}
