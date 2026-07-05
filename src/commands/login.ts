import { execFile } from "node:child_process";
import type { Command } from "commander";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, isLocalMode, loadGlobalConfig } from "../lib/config.js";
import type { LoginPreferences } from "../lib/config.js";
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

/**
 * A session is "headless" when there's no local browser to open — over SSH,
 * or on Linux with no display server. In that case the QR (scanned from a
 * phone) is the primary path rather than redundant with an auto-opened browser.
 */
export function isHeadlessSession(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return true;
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return true;
  return false;
}

/**
 * Merge command-line flags with persisted config into effective preferences.
 * Precedence: an explicit flag wins, then persisted config, then the default.
 * `--no-browser` (browserFlag=false) and `--qr` (qrFlag=true) are the only
 * flags, so a flag can force the browser off or the QR on; config supplies the
 * default for whichever flag wasn't passed.
 */
export function resolveLoginPreferences(
  flags: { browserFlag: boolean; qrFlag: boolean },
  config: LoginPreferences,
): { noBrowser: boolean; qr: boolean } {
  const noBrowser = flags.browserFlag === false || config.browser === false;
  const qr = flags.qrFlag || config.qr === true;
  return { noBrowser, qr };
}

export interface LoginDisplay {
  openBrowser: boolean;
  showQr: boolean;
}

/**
 * Decide whether to auto-open a browser and whether to render the QR.
 *
 * We open a browser unless the user opted out (`--no-browser`) or there's
 * none to open (headless). We show the QR whenever we're NOT auto-opening a
 * browser (so the user has a scannable path), or when explicitly forced
 * (`--qr`). On a normal desktop the QR is hidden — it would just duplicate
 * the browser that already opened pre-filled.
 */
export function resolveLoginDisplay(opts: {
  noBrowser: boolean;
  qr: boolean;
  headless: boolean;
}): LoginDisplay {
  const openBrowser = !opts.noBrowser && !opts.headless;
  const showQr = opts.qr || !openBrowser;
  return { openBrowser, showQr };
}

/**
 * Build the login prompt, adapting the wording to what actually happens:
 * automatic framing ("Opening your browser…") when we open it, manual framing
 * ("visit this URL / scan this") when we don't. In browser mode the code isn't
 * repeated — it's already visible in the URL and pre-filled on the page. In
 * manual mode it's shown as a clean token for typing.
 */
export function formatLoginMessage(args: {
  userCode: string;
  target: string;
  openBrowser: boolean;
  qr: string | null;
}): string {
  const { userCode, target, openBrowser, qr } = args;
  const lines: string[] = [];

  if (openBrowser) {
    lines.push("Opening your browser to authorize this device…");
    lines.push("");
    lines.push("  Didn't open? Visit:");
    lines.push("  " + target);
  } else {
    lines.push("To authorize this device, visit:");
    lines.push("  " + target);
  }

  if (qr) {
    lines.push("");
    lines.push("Or scan with your phone:");
    lines.push(qr);
  }

  if (!openBrowser) {
    lines.push("");
    lines.push(`Verification code: ${userCode}`);
  }

  return lines.join("\n");
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Authenticate with King's Landing")
    .option("--no-browser", "Don't open the browser automatically; show a QR to scan instead")
    .option("--qr", "Always show a QR code, even when the browser opens")
    .action(async (options: { browser: boolean; qr?: boolean }) => {
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

      const spinner = createSpinner("Waiting for authorization…");

      const prefs = resolveLoginPreferences(
        { browserFlag: options.browser, qrFlag: options.qr ?? false },
        loadGlobalConfig().login ?? {},
      );
      const display = resolveLoginDisplay({
        noBrowser: prefs.noBrowser,
        qr: prefs.qr,
        headless: isHeadlessSession(process.env, process.platform),
      });

      await authService.login((userCode, verificationUri, verificationUriComplete) => {
        const target = resolveVerificationTarget(verificationUri, verificationUriComplete);

        let qr: string | null = null;
        if (display.showQr) {
          try {
            qr = renderQrCode(target);
          } catch {
            // QR is a convenience — never block login on a render failure
          }
        }

        console.log();
        console.log(formatLoginMessage({ userCode, target, openBrowser: display.openBrowser, qr }));
        console.log();

        if (display.openBrowser) {
          tryOpenBrowser(target);
        }
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
