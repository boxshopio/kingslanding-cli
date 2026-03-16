import * as fs from "node:fs";
import * as path from "node:path";
import { KL_DIR, isLocalMode } from "./config.js";

export interface Credentials {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: number;
}

type CredentialStore = Record<string, Credentials>;

function defaultCredPath(): string {
  return path.join(KL_DIR, "credentials.json");
}

function readStore(credPath: string): CredentialStore {
  if (!fs.existsSync(credPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(credPath, "utf-8")) as CredentialStore;
  } catch {
    return {};
  }
}

function writeStore(store: CredentialStore, credPath: string): void {
  const dir = path.dirname(credPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(credPath, JSON.stringify(store, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function loadCredentials(apiUrl: string, credPath?: string): Credentials | null {
  const store = readStore(credPath ?? defaultCredPath());
  return store[apiUrl] ?? null;
}

export function saveCredentials(apiUrl: string, creds: Credentials, credPath?: string): void {
  const p = credPath ?? defaultCredPath();
  const store = readStore(p);
  store[apiUrl] = creds;
  writeStore(store, p);
}

export function clearCredentials(apiUrl: string, credPath?: string): void {
  const p = credPath ?? defaultCredPath();
  const store = readStore(p);
  delete store[apiUrl];
  writeStore(store, p);
}

export function checkCredentialPermissions(credPath?: string): string | null {
  const p = credPath ?? defaultCredPath();
  if (!fs.existsSync(p)) return null;
  const stats = fs.statSync(p);
  const perms = stats.mode & 0o777;
  if (perms !== 0o600) {
    return "Warning: " + p + " has open permissions. Run: chmod 600 " + p;
  }
  return null;
}

export function parseJwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    return decoded.exp ?? 0;
  } catch {
    return 0;
  }
}

export function getAuthHeader(apiUrl: string, credPath?: string): string | null {
  const deployKey = process.env.KL_DEPLOY_KEY;
  if (deployKey) return "Bearer " + deployKey;
  if (isLocalMode(apiUrl)) return "Bearer local-bypass";
  const creds = loadCredentials(apiUrl, credPath);
  if (creds) return "Bearer " + creds.access_token;
  return null;
}

export function isDeployKeyAuth(): boolean {
  return !!process.env.KL_DEPLOY_KEY;
}

export function isTokenExpiringSoon(creds: Credentials, bufferSeconds = 300): boolean {
  return creds.expires_at - bufferSeconds <= Math.floor(Date.now() / 1000);
}
