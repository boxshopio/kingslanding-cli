import type { ApiClient } from "../lib/api.js";
import {
  type Credentials,
  saveCredentials,
  clearCredentials,
  isTokenExpiringSoon,
  parseJwtExpiry,
} from "../lib/auth.js";
import { CLIError, AuthError } from "../lib/errors.js";

const DEFAULT_POLL_INTERVAL = 5000;

export class AuthService {
  constructor(
    private readonly api: ApiClient,
    private readonly apiUrl: string,
  ) {}

  async login(
    onShowCode: (userCode: string, verificationUrl: string) => void,
    pollInterval = DEFAULT_POLL_INTERVAL,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    id_token: string;
  }> {
    const { device_code, user_code, verification_url } =
      await this.api.createDeviceCode();
    onShowCode(user_code, verification_url);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (pollInterval > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      const result = await this.api.pollDeviceToken(device_code);

      if (result.status === "authorized" && result.tokens) {
        const creds: Credentials = {
          access_token: result.tokens.access_token,
          refresh_token: result.tokens.refresh_token,
          id_token: result.tokens.id_token,
          expires_at: parseJwtExpiry(result.tokens.access_token),
        };
        saveCredentials(this.apiUrl, creds);
        return result.tokens;
      }

      if (result.status === "expired") {
        throw new CLIError(
          "Device code expired. Run `kl login` to try again.",
        );
      }
    }
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      await this.api.logout(refreshToken);
    } catch {
      // Warn but don't fail — server-side revocation is best-effort
    }
    clearCredentials(this.apiUrl);
  }

  async refreshIfNeeded(creds: Credentials): Promise<Credentials> {
    if (!isTokenExpiringSoon(creds)) return creds;

    try {
      const result = await this.api.refreshToken(creds.refresh_token);
      const updated: Credentials = {
        access_token: result.access_token,
        refresh_token: creds.refresh_token,
        id_token: result.id_token,
        expires_at: Math.floor(Date.now() / 1000) + result.expires_in,
      };
      saveCredentials(this.apiUrl, updated);
      this.api.updateAuthHeader("Bearer " + updated.access_token);
      return updated;
    } catch {
      clearCredentials(this.apiUrl);
      throw new AuthError();
    }
  }
}
