import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiClient } from "../../src/lib/api.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("ApiClient", () => {
  let api: ApiClient;

  beforeEach(() => {
    mockFetch.mockReset();
    api = new ApiClient("https://api.kingslanding.io", "Bearer test-token");
  });

  it("sends auth header on requests", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ email: "user@test.com" }), { status: 200 }),
    );
    await api.getAccount();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.kingslanding.io/api/v1/account",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("parses API error responses", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found" }), { status: 404 }),
    );
    await expect(api.getAccount()).rejects.toThrow("Not found");
  });

  it("handles network errors", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(api.getAccount()).rejects.toThrow("Could not reach the API");
  });

  it("handles 429 rate limit", async () => {
    mockFetch.mockResolvedValue(new Response("", { status: 429 }));
    await expect(api.getAccount()).rejects.toThrow("Rate limited");
  });

  describe("initiateDeploy", () => {
    it("sends file manifest and returns presigned URLs", async () => {
      const response = {
        deployment_id: "deploy-123",
        expires_at: 12345,
        uploads: [
          {
            path: "index.html",
            presigned_url: "https://s3.example.com/...",
          },
        ],
        project_created: false,
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(response), { status: 200 }),
      );

      const result = await api.initiateDeploy("my-site", {
        files: [{ path: "index.html", size: 100, content_type: "text/html" }],
      });

      expect(result.deployment_id).toBe("deploy-123");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.kingslanding.io/api/v1/projects/my-site/deploy",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("appends ?create=true when create option is set", async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            deployment_id: "d",
            uploads: [],
            expires_at: 0,
            project_created: true,
          }),
          { status: 200 },
        ),
      );

      await api.initiateDeploy("my-site", { files: [] }, { create: true });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("?create=true"),
        expect.anything(),
      );
    });
  });

  describe("finalizeDeploy", () => {
    it("calls finalize endpoint", async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            url: "https://my-site.kingslanding.io",
            deployment_id: "d",
            files: 1,
            total_size: 100,
          }),
          { status: 200 },
        ),
      );

      const result = await api.finalizeDeploy("my-site", "deploy-123");
      expect(result.url).toBe("https://my-site.kingslanding.io");
    });

    it("passes team_id as query param", async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            url: "u",
            deployment_id: "d",
            files: 1,
            total_size: 100,
          }),
          { status: 200 },
        ),
      );

      await api.finalizeDeploy("my-site", "deploy-123", "team-456");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("?team_id=team-456"),
        expect.anything(),
      );
    });
  });

  describe("uploadFile", () => {
    it("PUTs file content to presigned URL", async () => {
      mockFetch.mockResolvedValue(new Response("", { status: 200 }));

      const body = Buffer.from("hello");
      await api.uploadFile("https://s3.example.com/upload", body, "text/html");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://s3.example.com/upload",
        expect.objectContaining({
          method: "PUT",
          body,
          headers: expect.objectContaining({ "Content-Type": "text/html" }),
        }),
      );
    });
  });
});
