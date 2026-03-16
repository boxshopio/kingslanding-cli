import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ApiClient } from "../../src/lib/api.js";
import { DeployService, defaultReadFile } from "../../src/services/deploy-service.js";
import { buildFileManifest } from "../../src/lib/files.js";

const API_URL = "https://api.kl.test";
const SITE_DOMAIN = "kl.test";

// Disable TLS verification for self-signed local certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

/**
 * LocalStack generates presigned URLs with the Docker-internal hostname
 * `localstack:4566`. From the host machine, we need `localhost:4566`.
 */
class LocalApiClient extends ApiClient {
  async uploadFile(
    presignedUrl: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const rewritten = presignedUrl.replace(
      "http://localstack:4566",
      "http://localhost:4566",
    );
    return super.uploadFile(rewritten, body, contentType);
  }
}

async function isLocalStackRunning(): Promise<boolean> {
  try {
    const r = await fetch(API_URL + "/health", {
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function uniqueName(): string {
  return "test-" + Math.random().toString(36).slice(2, 10);
}

async function deleteProject(name: string): Promise<void> {
  try {
    await fetch(API_URL + "/api/v1/projects/" + name, {
      method: "DELETE",
      headers: { Authorization: "Bearer local-bypass" },
    });
  } catch {
    // Best-effort cleanup
  }
}

async function fetchSite(url: string, retries = 20): Promise<Response | null> {
  let response: Response | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(2000),
        redirect: "follow",
      });
      if (response.ok) return response;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return response;
}

describe("CLI integration (local stack)", () => {
  let skip = false;

  beforeAll(async () => {
    skip = !(await isLocalStackRunning());
    if (skip) console.log("Skipping integration tests — local stack not running");
  });

  describe("deploy flow", () => {
    it("deploys a site and verifies it is live", async () => {
      if (skip) return;

      const projectName = uniqueName();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-integration-"));

      try {
        // Create test files
        fs.writeFileSync(
          path.join(tmpDir, "index.html"),
          "<h1>Integration Test: " + projectName + "</h1>",
        );
        fs.mkdirSync(path.join(tmpDir, "assets"));
        fs.writeFileSync(
          path.join(tmpDir, "assets", "style.css"),
          "body { color: blue; }",
        );

        // Build manifest
        const files = buildFileManifest(tmpDir);
        expect(files).toHaveLength(2);

        // Deploy via service layer
        const api = new LocalApiClient(API_URL, "Bearer local-bypass");
        const deployService = new DeployService(api);

        const result = await deployService.deploy({
          projectName,
          files,
          readFile: defaultReadFile,
          onProgress: () => {},
          create: true,
        });

        expect(result.url).toContain(projectName);
        expect(result.files).toBe(2);
        expect(result.total_size).toBeGreaterThan(0);

        // Verify site is live
        const siteUrl = "https://" + projectName + "." + SITE_DOMAIN + "/";
        const siteResponse = await fetchSite(siteUrl);

        expect(siteResponse).not.toBeNull();
        expect(siteResponse!.ok).toBe(true);
        const html = await siteResponse!.text();
        expect(html).toContain(projectName);
      } finally {
        await deleteProject(projectName);
        fs.rmSync(tmpDir, { recursive: true });
      }
    }, 30000);

    it("deploys an update to an existing project", async () => {
      if (skip) return;

      const projectName = uniqueName();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-integration-"));

      try {
        const api = new LocalApiClient(API_URL, "Bearer local-bypass");
        const deployService = new DeployService(api);

        // Initial deploy
        fs.writeFileSync(path.join(tmpDir, "index.html"), "<h1>v1</h1>");
        let files = buildFileManifest(tmpDir);

        await deployService.deploy({
          projectName,
          files,
          readFile: defaultReadFile,
          onProgress: () => {},
          create: true,
        });

        // Update deploy (no create flag)
        fs.writeFileSync(path.join(tmpDir, "index.html"), "<h1>v2</h1>");
        files = buildFileManifest(tmpDir);

        const result = await deployService.deploy({
          projectName,
          files,
          readFile: defaultReadFile,
          onProgress: () => {},
        });

        expect(result.files).toBe(1);

        // Verify updated content is live
        const siteUrl = "https://" + projectName + "." + SITE_DOMAIN + "/";
        let body = "";
        for (let i = 0; i < 20; i++) {
          try {
            const resp = await fetch(siteUrl, {
              signal: AbortSignal.timeout(2000),
              redirect: "follow",
            });
            if (resp.ok) {
              body = await resp.text();
              if (body.includes("v2")) break;
            }
          } catch {
            // Retry
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        expect(body).toContain("v2");
      } finally {
        await deleteProject(projectName);
        fs.rmSync(tmpDir, { recursive: true });
      }
    }, 30000);
  });

  describe("account and projects", () => {
    it("returns account info via getAccount", async () => {
      if (skip) return;

      const api = new ApiClient(API_URL, "Bearer local-bypass");
      const account = await api.getAccount();

      expect(account.email).toBeDefined();
      expect(account.plan_tier).toBeDefined();
      expect(account.status).toBe("active");
    });

    it("lists projects", async () => {
      if (skip) return;

      const api = new ApiClient(API_URL, "Bearer local-bypass");
      const result = await api.listProjects();

      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe("device auth flow", () => {
    it("creates a device code and polls pending status", async () => {
      if (skip) return;

      const api = new ApiClient(API_URL, null);

      // Create device code
      const codeResult = await api.createDeviceCode();
      expect(codeResult.device_code).toBeDefined();
      expect(codeResult.user_code).toMatch(/^[A-Z]{4}-\d{4}$/);
      expect(codeResult.verification_url).toContain("/device");
      expect(codeResult.expires_in).toBeGreaterThan(0);

      // Poll — should be pending (nobody verified yet)
      const pollResult = await api.pollDeviceToken(codeResult.device_code);
      expect(pollResult.status).toBe("authorization_pending");
      expect(pollResult.tokens).toBeNull();
    });
  });

  describe("token refresh", () => {
    it("returns dummy tokens in local bypass mode", async () => {
      if (skip) return;

      const api = new ApiClient(API_URL, null);
      const result = await api.refreshToken("any-refresh-token");

      expect(result.access_token).toBeDefined();
      expect(result.id_token).toBeDefined();
      expect(result.expires_in).toBeGreaterThan(0);
    });
  });
});
