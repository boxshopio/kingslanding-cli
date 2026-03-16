import { describe, it, expect, vi } from "vitest";
import { AuthService } from "../../src/services/auth-service.js";
import type { ApiClient } from "../../src/lib/api.js";

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    createDeviceCode: vi.fn(),
    pollDeviceToken: vi.fn(),
    refreshToken: vi.fn(),
    logout: vi.fn(),
    updateAuthHeader: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe("AuthService", () => {
  describe("login (device flow)", () => {
    it("polls until authorized and returns tokens", async () => {
      const tokens = {
        access_token: "at",
        refresh_token: "rt",
        id_token: "idt",
      };
      const api = mockApiClient({
        createDeviceCode: vi.fn().mockResolvedValue({
          device_code: "dc-1",
          user_code: "ABCD-1234",
          verification_url: "https://kingslanding.io/device",
          expires_in: 600,
        }),
        pollDeviceToken: vi
          .fn()
          .mockResolvedValueOnce({
            status: "authorization_pending",
            tokens: null,
          })
          .mockResolvedValueOnce({ status: "authorized", tokens }),
      });

      const service = new AuthService(api, "https://api.kingslanding.io");
      const result = await service.login(vi.fn(), 0);

      expect(result).toEqual(tokens);
      expect(api.pollDeviceToken).toHaveBeenCalledTimes(2);
    });

    it("calls onShowCode with user code and URL", async () => {
      const tokens = {
        access_token: "at",
        refresh_token: "rt",
        id_token: "idt",
      };
      const api = mockApiClient({
        createDeviceCode: vi.fn().mockResolvedValue({
          device_code: "dc-1",
          user_code: "ABCD-1234",
          verification_url: "https://kingslanding.io/device",
          expires_in: 600,
        }),
        pollDeviceToken: vi
          .fn()
          .mockResolvedValue({ status: "authorized", tokens }),
      });

      const onShowCode = vi.fn();
      const service = new AuthService(api, "https://api.kingslanding.io");
      await service.login(onShowCode, 0);

      expect(onShowCode).toHaveBeenCalledWith(
        "ABCD-1234",
        "https://kingslanding.io/device",
      );
    });

    it("stops polling on expired status", async () => {
      const api = mockApiClient({
        createDeviceCode: vi.fn().mockResolvedValue({
          device_code: "dc-1",
          user_code: "ABCD-1234",
          verification_url: "https://kingslanding.io/device",
          expires_in: 600,
        }),
        pollDeviceToken: vi
          .fn()
          .mockResolvedValue({ status: "expired", tokens: null }),
      });

      const service = new AuthService(api, "https://api.kingslanding.io");
      await expect(service.login(vi.fn(), 0)).rejects.toThrow("expired");
    });
  });

  describe("refreshIfNeeded", () => {
    it("refreshes when token is expiring soon", async () => {
      const api = mockApiClient({
        refreshToken: vi.fn().mockResolvedValue({
          access_token: "new-at",
          id_token: "new-idt",
          expires_in: 3600,
        }),
      });

      const service = new AuthService(api, "https://api.kingslanding.io");
      const expiringSoon = {
        access_token: "old-at",
        refresh_token: "rt",
        id_token: "old-idt",
        expires_at: Math.floor(Date.now() / 1000) + 60,
      };

      const result = await service.refreshIfNeeded(expiringSoon);
      expect(result.access_token).toBe("new-at");
      expect(api.refreshToken).toHaveBeenCalledWith("rt");
    });

    it("returns existing credentials when not expiring", async () => {
      const api = mockApiClient();
      const service = new AuthService(api, "https://api.kingslanding.io");
      const valid = {
        access_token: "at",
        refresh_token: "rt",
        id_token: "idt",
        expires_at: Math.floor(Date.now() / 1000) + 7200,
      };

      const result = await service.refreshIfNeeded(valid);
      expect(result).toBe(valid);
      expect(api.refreshToken).not.toHaveBeenCalled();
    });
  });
});
