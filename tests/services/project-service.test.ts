import { describe, it, expect, vi } from "vitest";
import { ProjectService } from "../../src/services/project-service.js";
import type { ApiClient } from "../../src/lib/api.js";

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue({ items: [], next_token: null }),
    listTeamProjects: vi.fn().mockResolvedValue({ items: [] }),
    listTeams: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ApiClient;
}

describe("ProjectService", () => {
  describe("listProjects", () => {
    it("returns user projects", async () => {
      const projects = [
        { name: "my-site", file_count: 5, total_size_bytes: 1024, cloudfront_url: "/prefix/", last_updated: 1234567890 },
      ];
      const api = mockApiClient({
        listProjects: vi.fn().mockResolvedValue({ items: projects, next_token: null }),
      });
      const service = new ProjectService(api);
      const result = await service.listProjects();
      expect(result).toEqual(projects);
    });
  });

  describe("listAllProjects", () => {
    it("returns personal and team projects grouped", async () => {
      const personalProjects = [{ name: "my-blog", file_count: 5, total_size_bytes: 1024, cloudfront_url: "/", last_updated: 0 }];
      const teamProjects = [{ name: "marketing", file_count: 10, total_size_bytes: 2048, cloudfront_url: "/", last_updated: 0 }];

      const api = mockApiClient({
        listProjects: vi.fn().mockResolvedValue({ items: personalProjects, next_token: null }),
        listTeams: vi.fn().mockResolvedValue([
          { team: { team_id: "t1", name: "Acme Corp", slug: "acme-corp" }, role: "OWNER" },
        ]),
        listTeamProjects: vi.fn().mockResolvedValue({ items: teamProjects }),
      });

      const service = new ProjectService(api);
      const result = await service.listAllProjects();

      expect(result).toHaveLength(2);
      expect(result[0].label).toBe("Personal");
      expect(result[0].projects).toEqual(personalProjects);
      expect(result[1].label).toBe("Acme Corp (acme-corp)");
      expect(result[1].projects).toEqual(teamProjects);
    });

    it("omits groups with no projects", async () => {
      const api = mockApiClient({
        listProjects: vi.fn().mockResolvedValue({ items: [], next_token: null }),
        listTeams: vi.fn().mockResolvedValue([
          { team: { team_id: "t1", name: "Empty Team", slug: "empty" }, role: "OWNER" },
        ]),
        listTeamProjects: vi.fn().mockResolvedValue({ items: [] }),
      });

      const service = new ProjectService(api);
      const result = await service.listAllProjects();
      expect(result).toHaveLength(0);
    });
  });

  describe("resolveTeamId", () => {
    it("resolves team slug to team_id", async () => {
      const api = mockApiClient({
        listTeams: vi.fn().mockResolvedValue([
          { team: { team_id: "tid-1", name: "Frontend", slug: "frontend" }, role: "OWNER" },
          { team: { team_id: "tid-2", name: "Backend", slug: "backend" }, role: "EDITOR" },
        ]),
      });
      const service = new ProjectService(api);
      const teamId = await service.resolveTeamId("backend");
      expect(teamId).toBe("tid-2");
    });

    it("throws when slug not found", async () => {
      const api = mockApiClient({ listTeams: vi.fn().mockResolvedValue([]) });
      const service = new ProjectService(api);
      await expect(service.resolveTeamId("nonexistent")).rejects.toThrow();
    });
  });
});
