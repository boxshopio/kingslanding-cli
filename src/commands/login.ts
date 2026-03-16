import { exec } from "node:child_process";
import type { Command } from "commander";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, isLocalMode } from "../lib/config.js";
import {
  getAuthHeader,
  loadCredentials,
  isTokenExpiringSoon,
} from "../lib/auth.js";
import { createSpinner } from "../lib/output.js";
import { AuthService } from "../services/auth-service.js";

function tryOpenBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${cmd} ${JSON.stringify(url)}`, () => {
    // Silent failure — user can copy/paste the URL
  });
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Authenticate with King's Landing")
    .action(async () => {
      const apiUrl = resolveApiUrl();

      if (isLocalMode(apiUrl)) {
        console.log("Local mode — no login required.");
        return;
      }

      const creds = loadCredentials(apiUrl);
      if (creds && !isTokenExpiringSoon(creds)) {
        const api = new ApiClient(apiUrl, "Bearer " + creds.access_token);
        try {
          const account = await api.getAccount();
          console.log("Already logged in as " + account.email);
          return;
        } catch {
          // Token invalid — proceed with login
        }
      }

      const authHeader = getAuthHeader(apiUrl);
      const api = new ApiClient(apiUrl, authHeader);
      const authService = new AuthService(api, apiUrl);

      const spinner = createSpinner("Waiting for browser authorization...");

      await authService.login((userCode, verificationUrl) => {
        console.log();
        console.log("Open this URL in your browser:");
        console.log("  " + verificationUrl);
        console.log();
        console.log("Enter code: " + userCode);
        console.log();
        tryOpenBrowser(verificationUrl);
        spinner.start();
      });

      spinner.stop();

      api.updateAuthHeader(
        "Bearer " + loadCredentials(apiUrl)!.access_token,
      );
      const account = await api.getAccount();
      console.log("Logged in as " + account.email);
    });
}
