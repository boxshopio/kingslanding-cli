import type { Command } from "commander";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, siteUrl } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { formatTable, formatBytes } from "../lib/output.js";
import { AuthError } from "../lib/errors.js";
import { ProjectService } from "../services/project-service.js";
import type { ProjectInfo } from "../lib/api.js";

function formatProjectRows(projects: ProjectInfo[], apiUrl: string): string[][] {
  return projects.map((p) => [
    p.name,
    siteUrl(p.name, apiUrl),
    String(p.file_count),
    formatBytes(p.total_size_bytes),
    p.last_updated
      ? new Date(p.last_updated * 1000).toLocaleDateString()
      : "—",
  ]);
}

export function registerProjectsCommand(program: Command): void {
  program
    .command("projects")
    .description("List your projects")
    .option("-t, --team <slug>", "List projects for a team")
    .option("--personal", "List only personal projects")
    .action(async (options: { team?: string; personal?: boolean }) => {
      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const api = new ApiClient(apiUrl, authHeader);
      const projectService = new ProjectService(api);
      const headers = ["NAME", "URL", "FILES", "SIZE", "LAST DEPLOYED"];

      if (options.team) {
        const teamId = await projectService.resolveTeamId(options.team);
        const projects = await projectService.listTeamProjects(teamId);
        console.log(formatTable(headers, formatProjectRows(projects, apiUrl), "No projects found."));
        return;
      }

      if (options.personal) {
        const projects = await projectService.listProjects();
        console.log(formatTable(headers, formatProjectRows(projects, apiUrl), "No projects found."));
        return;
      }

      // Default: grouped output
      const groups = await projectService.listAllProjects();

      if (groups.length === 0) {
        console.log("No projects found.");
        return;
      }

      for (const group of groups) {
        console.log(group.label);
        console.log(formatTable(headers, formatProjectRows(group.projects, apiUrl), ""));
        console.log();
      }
    });
}
