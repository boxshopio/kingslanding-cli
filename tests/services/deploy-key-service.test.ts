import { describe, it, expect, vi } from "vitest";
import { DeployKeyService } from "../../src/services/deploy-key-service.js";
import type { ApiClient } from "../../src/lib/api.js";

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    createDeployKey: vi.fn(),
    getDeployKeyStatus: vi.fn(),
    revokeDeployKey: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe("DeployKeyService", () => {
  it("creates a deploy key", async () => {
    const api = mockApiClient({
      createDeployKey: vi.fn().mockResolvedValue({
        key: "kl_abc123",
        key_prefix: "kl_abc1",
        message: "Deploy key generated",
      }),
    });
    const service = new DeployKeyService(api);
    const result = await service.create("my-site");
    expect(result.key).toBe("kl_abc123");
    expect(api.createDeployKey).toHaveBeenCalledWith("my-site");
  });

  it("checks deploy key status", async () => {
    const api = mockApiClient({
      getDeployKeyStatus: vi.fn().mockResolvedValue({
        exists: true,
        key_prefix: "kl_abc1",
        created_at: 1234567890,
      }),
    });
    const service = new DeployKeyService(api);
    const result = await service.status("my-site");
    expect(result.exists).toBe(true);
  });

  it("revokes a deploy key", async () => {
    const api = mockApiClient({
      revokeDeployKey: vi.fn().mockResolvedValue(undefined),
    });
    const service = new DeployKeyService(api);
    await service.revoke("my-site");
    expect(api.revokeDeployKey).toHaveBeenCalledWith("my-site");
  });
});
