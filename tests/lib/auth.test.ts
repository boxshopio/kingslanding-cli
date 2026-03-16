import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  getAuthHeader,
  checkCredentialPermissions,
  parseJwtExpiry,
  isTokenExpiringSoon,
  isDeployKeyAuth,
  Credentials,
} from "../../src/lib/auth.js";

describe("credential storage", () => {
  let tmpDir: string;
  let credPath: string;
  const apiUrl = "https://api.kingslanding.io";
  const creds: Credentials = {
    access_token: "at-123",
    refresh_token: "rt-456",
    id_token: "idt-789",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-auth-test-"));
    credPath = path.join(tmpDir, "credentials.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("saves and loads credentials keyed by API URL", () => {
    saveCredentials(apiUrl, creds, credPath);
    const loaded = loadCredentials(apiUrl, credPath);
    expect(loaded).toEqual(creds);
  });

  it("returns null when no credentials exist", () => {
    expect(loadCredentials(apiUrl, credPath)).toBeNull();
  });

  it("clears credentials for a specific API URL", () => {
    saveCredentials(apiUrl, creds, credPath);
    clearCredentials(apiUrl, credPath);
    expect(loadCredentials(apiUrl, credPath)).toBeNull();
  });

  it("preserves other API URL credentials when clearing one", () => {
    const devUrl = "https://api.dev.kingslanding.io";
    saveCredentials(apiUrl, creds, credPath);
    saveCredentials(devUrl, { ...creds, access_token: "dev-at" }, credPath);
    clearCredentials(apiUrl, credPath);
    expect(loadCredentials(apiUrl, credPath)).toBeNull();
    expect(loadCredentials(devUrl, credPath)?.access_token).toBe("dev-at");
  });

  it("sets file permissions to 0600", () => {
    saveCredentials(apiUrl, creds, credPath);
    const stats = fs.statSync(credPath);
    expect(stats.mode & 0o777).toBe(0o600);
  });
});

describe("getAuthHeader", () => {
  it("returns deploy key when KL_DEPLOY_KEY is set", () => {
    const originalEnv = process.env.KL_DEPLOY_KEY;
    process.env.KL_DEPLOY_KEY = "kl_abc123";
    expect(getAuthHeader("https://api.kingslanding.io")).toBe("Bearer kl_abc123");
    if (originalEnv === undefined) delete process.env.KL_DEPLOY_KEY;
    else process.env.KL_DEPLOY_KEY = originalEnv;
  });

  it("returns local-bypass for local mode", () => {
    expect(getAuthHeader("https://api.kl.test")).toBe("Bearer local-bypass");
  });
});

describe("parseJwtExpiry", () => {
  it("extracts exp from a JWT payload", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "123", exp: 1700000000 })).toString("base64url");
    const token = "header." + payload + ".signature";
    expect(parseJwtExpiry(token)).toBe(1700000000);
  });

  it("returns 0 for malformed tokens", () => {
    expect(parseJwtExpiry("not-a-jwt")).toBe(0);
    expect(parseJwtExpiry("")).toBe(0);
  });
});

describe("isTokenExpiringSoon", () => {
  it("returns true when token expires within buffer", () => {
    const c: Credentials = {
      access_token: "at", refresh_token: "rt", id_token: "idt",
      expires_at: Math.floor(Date.now() / 1000) + 60,
    };
    expect(isTokenExpiringSoon(c, 300)).toBe(true);
  });

  it("returns false when token is well within validity", () => {
    const c: Credentials = {
      access_token: "at", refresh_token: "rt", id_token: "idt",
      expires_at: Math.floor(Date.now() / 1000) + 7200,
    };
    expect(isTokenExpiringSoon(c, 300)).toBe(false);
  });
});

describe("isDeployKeyAuth", () => {
  it("returns true when KL_DEPLOY_KEY is set", () => {
    const orig = process.env.KL_DEPLOY_KEY;
    process.env.KL_DEPLOY_KEY = "kl_test";
    expect(isDeployKeyAuth()).toBe(true);
    if (orig === undefined) delete process.env.KL_DEPLOY_KEY;
    else process.env.KL_DEPLOY_KEY = orig;
  });

  it("returns false when KL_DEPLOY_KEY is not set", () => {
    const orig = process.env.KL_DEPLOY_KEY;
    delete process.env.KL_DEPLOY_KEY;
    expect(isDeployKeyAuth()).toBe(false);
    if (orig !== undefined) process.env.KL_DEPLOY_KEY = orig;
  });
});

describe("checkCredentialPermissions", () => {
  it("returns null when file does not exist", () => {
    expect(checkCredentialPermissions("/nonexistent/path")).toBeNull();
  });

  it("returns null when permissions are 0600", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-auth-perm-"));
    const credPath = path.join(tmpDir, "creds.json");
    fs.writeFileSync(credPath, "{}", { mode: 0o600 });
    expect(checkCredentialPermissions(credPath)).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
