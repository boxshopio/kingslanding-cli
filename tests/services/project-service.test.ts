import { describe, it, expect, vi } from "vitest";
import { ProjectService } from "../../src/services/project-service.js";
import type { ApiClient } from "../../src/lib/api.js";

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi
      .fn()
      .mockResolvedValue({ items: [], next_token: null }),
    listTeamProjects: vi.fn().mockResolvedValue({ items: [] }),
    listTeams: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ApiClient;
}

describe("ProjectService", () => {
  describe("listProjects", () => {
    it("returns user projects", async () => {
      const projects = [
        {
          name: "my-site",
          file_count: 5,
          total_size_bytes: 1024,
          cloudfront_url: "/prefix/",
          last_updated: 1234567890,
        },
      ];
      const api = mockApiClient({
        listProjects: vi
          .fn()
          .mockResolvedValue({ items: projects, next_token: null }),
      });
      const service = new ProjectService(api);
      const result = await service.listProjects();
      expect(result).toEqual(projects);
    });
  });

  describe("resolveTeamId", () => {
    it("resolves team slug to team_id", async () => {
      const api = mockApiClient({
        listTeams: vi.fn().mockResolvedValue([
          {
            team: { team_id: "tid-1", name: "Frontend", slug: "frontend" },
            role: "OWNER",
          },
          {
            team: { team_id: "tid-2", name: "Backend", slug: "backend" },
            role: "EDITOR",
          },
        ]),
      });
      const service = new ProjectService(api);
      const teamId = await service.resolveTeamId("backend");
      expect(teamId).toBe("tid-2");
    });

    it("throws when slug not found", async () => {
      const api = mockApiClient({
        listTeams: vi.fn().mockResolvedValue([]),
      });
      const service = new ProjectService(api);
      await expect(service.resolveTeamId("nonexistent")).rejects.toThrow();
    });
  });

  describe("getUserTeams", () => {
    it("returns teams for init picker", async () => {
      const teams = [
        {
          team: { team_id: "t1", name: "Frontend", slug: "frontend" },
          role: "OWNER",
        },
      ];
      const api = mockApiClient({
        listTeams: vi.fn().mockResolvedValue(teams),
      });
      const service = new ProjectService(api);
      const result = await service.getUserTeams();
      expect(result).toHaveLength(1);
      expect(result[0].team.slug).toBe("frontend");
    });
  });
});
