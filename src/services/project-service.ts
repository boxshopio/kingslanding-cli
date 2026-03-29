import type { ApiClient, ProjectInfo, TeamInfo } from "../lib/api.js";
import { CLIError } from "../lib/errors.js";

export interface ProjectGroup {
  label: string;
  projects: ProjectInfo[];
}

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

  async listAllProjects(): Promise<ProjectGroup[]> {
    const [personalResult, teams] = await Promise.all([
      this.api.listProjects(),
      this.api.listTeams(),
    ]);

    const groups: ProjectGroup[] = [];

    if (personalResult.items.length > 0) {
      groups.push({ label: "Personal", projects: personalResult.items });
    }

    for (const t of teams) {
      const teamResult = await this.api.listTeamProjects(t.team.team_id);
      if (teamResult.items.length > 0) {
        groups.push({
          label: t.team.name + " (" + t.team.slug + ")",
          projects: teamResult.items,
        });
      }
    }

    return groups;
  }

  async resolveTeamId(slug: string): Promise<string> {
    const teams = await this.api.listTeams();
    const match = teams.find((t) => t.team.slug === slug);
    if (!match) {
      throw new CLIError(
        'Team "' + slug + '" not found. Run `kl projects --team` to see available teams.',
      );
    }
    return match.team.team_id;
  }

  async getUserTeams(): Promise<TeamInfo[]> {
    return this.api.listTeams();
  }
}
