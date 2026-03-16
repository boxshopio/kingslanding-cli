import type { Command } from "commander";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, siteUrl } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { formatTable, formatBytes } from "../lib/output.js";
import { AuthError } from "../lib/errors.js";
import { ProjectService } from "../services/project-service.js";

export function registerProjectsCommand(program: Command): void {
  program
    .command("projects")
    .description("List your projects")
    .option("-t, --team <slug>", "List projects for a team")
    .action(async (options: { team?: string }) => {
      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const api = new ApiClient(apiUrl, authHeader);
      const projectService = new ProjectService(api);

      let teamId: string | undefined;
      if (options.team) {
        teamId = await projectService.resolveTeamId(options.team);
      }

      const projects = teamId
        ? await projectService.listTeamProjects(teamId)
        : await projectService.listProjects();

      const rows = projects.map((p) => [
        p.name,
        siteUrl(p.name, apiUrl),
        String(p.file_count),
        formatBytes(p.total_size_bytes),
        p.last_updated
          ? new Date(p.last_updated * 1000).toLocaleDateString()
          : "—",
      ]);

      console.log(
        formatTable(
          ["NAME", "URL", "FILES", "SIZE", "LAST DEPLOYED"],
          rows,
          "No projects found.",
        ),
      );
    });
}
