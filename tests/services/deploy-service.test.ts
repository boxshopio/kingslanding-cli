import { describe, it, expect, vi } from "vitest";
import { DeployService } from "../../src/services/deploy-service.js";
import type { ApiClient } from "../../src/lib/api.js";
import type { FileEntry } from "../../src/lib/files.js";

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    initiateDeploy: vi.fn().mockResolvedValue({
      deployment_id: "deploy-123",
      expires_at: Date.now() / 1000 + 900,
      uploads: [],
      project_created: false,
    }),
    finalizeDeploy: vi.fn().mockResolvedValue({
      url: "https://my-site.kingslanding.io",
      deployment_id: "deploy-123",
      files: 2,
      total_size: 2048,
    }),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ApiClient;
}

describe("DeployService", () => {
  describe("deploy", () => {
    it("initiates, uploads files, and finalizes", async () => {
      const files: FileEntry[] = [
        {
          path: "index.html",
          size: 100,
          content_type: "text/html",
          absolutePath: "/tmp/index.html",
        },
        {
          path: "style.css",
          size: 50,
          content_type: "text/css",
          absolutePath: "/tmp/style.css",
        },
      ];

      const api = mockApiClient({
        initiateDeploy: vi.fn().mockResolvedValue({
          deployment_id: "deploy-123",
          expires_at: Date.now() / 1000 + 900,
          uploads: [
            { path: "index.html", presigned_url: "https://s3/index" },
            { path: "style.css", presigned_url: "https://s3/style" },
          ],
          project_created: false,
        }),
      });

      const service = new DeployService(api);
      const readFile = vi.fn().mockReturnValue(Buffer.from("content"));

      const result = await service.deploy({
        projectName: "my-site",
        files,
        readFile,
        onProgress: vi.fn(),
      });

      expect(result.url).toBe("https://my-site.kingslanding.io");
      expect(api.initiateDeploy).toHaveBeenCalledTimes(1);
      expect(api.uploadFile).toHaveBeenCalledTimes(2);
      expect(api.finalizeDeploy).toHaveBeenCalledTimes(1);
    });

    it("retries failed uploads", async () => {
      const files: FileEntry[] = [
        {
          path: "index.html",
          size: 100,
          content_type: "text/html",
          absolutePath: "/tmp/index.html",
        },
      ];

      const api = mockApiClient({
        initiateDeploy: vi.fn().mockResolvedValue({
          deployment_id: "deploy-123",
          expires_at: Date.now() / 1000 + 900,
          uploads: [
            { path: "index.html", presigned_url: "https://s3/index" },
          ],
          project_created: false,
        }),
        uploadFile: vi
          .fn()
          .mockRejectedValueOnce(new Error("network error"))
          .mockResolvedValueOnce(undefined),
      });

      const service = new DeployService(api);
      const readFile = vi.fn().mockReturnValue(Buffer.from("content"));

      const result = await service.deploy({
        projectName: "my-site",
        files,
        readFile,
        onProgress: vi.fn(),
        retryDelayMs: 0,
      });

      expect(result.url).toBe("https://my-site.kingslanding.io");
      expect(api.uploadFile).toHaveBeenCalledTimes(2);
    });

    it("throws after max retries exceeded", async () => {
      const files: FileEntry[] = [
        {
          path: "index.html",
          size: 100,
          content_type: "text/html",
          absolutePath: "/tmp/index.html",
        },
      ];

      const api = mockApiClient({
        initiateDeploy: vi.fn().mockResolvedValue({
          deployment_id: "deploy-123",
          expires_at: Date.now() / 1000 + 900,
          uploads: [
            { path: "index.html", presigned_url: "https://s3/index" },
          ],
          project_created: false,
        }),
        uploadFile: vi
          .fn()
          .mockRejectedValue(new Error("persistent failure")),
      });

      const service = new DeployService(api);
      const readFile = vi.fn().mockReturnValue(Buffer.from("content"));

      await expect(
        service.deploy({
          projectName: "my-site",
          files,
          readFile,
          onProgress: vi.fn(),
          retryDelayMs: 0,
        }),
      ).rejects.toThrow("could not be uploaded");
    });

    it("passes create option and team_id", async () => {
      const api = mockApiClient({
        initiateDeploy: vi.fn().mockResolvedValue({
          deployment_id: "d",
          expires_at: 0,
          uploads: [],
          project_created: true,
        }),
      });

      const service = new DeployService(api);
      await service.deploy({
        projectName: "new-site",
        files: [],
        readFile: vi.fn(),
        onProgress: vi.fn(),
        create: true,
        teamId: "team-123",
      });

      expect(api.initiateDeploy).toHaveBeenCalledWith(
        "new-site",
        expect.objectContaining({ team_id: "team-123" }),
        { create: true },
      );
      expect(api.finalizeDeploy).toHaveBeenCalledWith(
        "new-site",
        "d",
        "team-123",
      );
    });
  });
});
