import { execFile } from "node:child_process";
import type { Command } from "commander";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, isLocalMode } from "../lib/config.js";
import { getAuthHeader, loadCredentials, isTokenExpiringSoon } from "../lib/auth.js";
import { createSpinner } from "../lib/output.js";
import { renderQrCode } from "../lib/qr.js";
import { AuthService } from "../services/auth-service.js";

function tryOpenBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  // execFile (no shell) passes the URL as a single argv element, so a
  // server-provided URL can't inject shell metacharacters.
  execFile(cmd, [url], () => {
    // Silent failure — user can copy/paste the URL
  });
}

/**
 * Pick the URL to open: the code-embedded (complete) URL when the server
 * provides it, otherwise the plain verification URI (older server).
 */
export function resolveVerificationTarget(
  verificationUri: string,
  verificationUriComplete: string | undefined,
): string {
  return verificationUriComplete ?? verificationUri;
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

      await authService.login((userCode, verificationUri, verificationUriComplete) => {
        const target = resolveVerificationTarget(verificationUri, verificationUriComplete);
        console.log();
        console.log("Open this URL in your browser:");
        console.log("  " + target);
        console.log();
        console.log("Enter code: " + userCode);
        console.log();
        try {
          console.log(renderQrCode(target));
        } catch {
          // QR is a convenience — never block login on a render failure
        }
        tryOpenBrowser(target);
        spinner.start();
      });

      spinner.stop();

      const newCreds = loadCredentials(apiUrl);
      if (!newCreds) {
        console.log("Logged in.");
        return;
      }

      api.updateAuthHeader("Bearer " + newCreds.access_token);
      try {
        const account = await api.getAccount();
        console.log("Logged in as " + account.email);
      } catch {
        console.log("Logged in.");
      }
    });
}
