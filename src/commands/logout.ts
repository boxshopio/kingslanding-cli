import type { Command } from "commander";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl } from "../lib/config.js";
import { loadCredentials } from "../lib/auth.js";
import { AuthService } from "../services/auth-service.js";

export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Clear stored credentials")
    .action(async () => {
      const apiUrl = resolveApiUrl();
      const creds = loadCredentials(apiUrl);

      if (!creds) {
        console.log("Not logged in.");
        return;
      }

      const api = new ApiClient(apiUrl, "Bearer " + creds.access_token);
      const authService = new AuthService(api, apiUrl);
      await authService.logout(creds.refresh_token);
      console.log("Logged out.");
    });
}
