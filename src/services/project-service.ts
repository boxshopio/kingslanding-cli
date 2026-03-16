import type { ApiClient, ProjectInfo, TeamInfo } from "../lib/api.js";
import { CLIError } from "../lib/errors.js";

export class ProjectService {
  constructor(private readonly api: ApiClient) {}

  async listProjects(): Promise<ProjectInfo[]> {
    const result = await this.api.listProjects();
    return result.items;
  }

  async listTeamProjects(teamId: string): Promise<ProjectInfo[]> {
    const result = await this.api.listTeamProjects(teamId);
    return result.items;
  }

  async resolveTeamId(slug: string): Promise<string> {
    const teams = await this.api.listTeams();
    const match = teams.find((t) => t.team.slug === slug);
    if (!match) {
      throw new CLIError(
        'Team "' +
          slug +
          '" not found. Run `kl projects --team` to see available teams.',
      );
    }
    return match.team.team_id;
  }

  async getUserTeams(): Promise<TeamInfo[]> {
    return this.api.listTeams();
  }
}
