# Simplify Project Context Model

## Problem

The `team` field in `kl.json` and `--team` flags throughout the CLI expose authorization plumbing to users. Project names are globally unique on the platform (flat subdomain namespace), so the server can resolve ownership from the project name alone. Team context is only genuinely needed at project creation time.

This creates confusion: users don't have a clear mental model of "where does my project live?" The nullable `team` field silently means "personal account," and forgetting to set it causes deploys to target the wrong owner.

Additionally, the `deploy-to-kingslanding` GitHub Action is a completely separate implementation with its own API client, file handling, and deploy path (`PUT /api/v1/upload`). This creates a maintenance burden and imposes a 9MB payload limit that the CLI's presigned-URL architecture avoids.

## Design

Three coordinated changes across the kingslanding API, CLI, and GitHub Action.

### 1. API: Server-Side Owner Resolution (kingslanding)

Add a `resolve_project()` function that looks up the project owner from the `project_names` DynamoDB table, then authorizes the caller:

- **Personal project**: caller's `user_sub` must match the project's `user_sub`
- **Team project**: caller must be a member of the owning team (checked via `team_members` table)

Make `team_id` **optional** on all individual project operation endpoints. When omitted, the server resolves ownership from the project name. When provided, it serves as an optimization hint (skips the lookup) and is validated against the resolved owner.

**Endpoints where `team_id` becomes optional:**

- `GET /projects/{name}`
- `GET /projects/{name}/files`
- `DELETE /projects/{name}`
- `POST /projects/{name}/invalidate`
- `PATCH /projects/{name}/password`
- `DELETE /projects/{name}/password`
- `POST /projects/{name}/deploy`
- `POST /projects/{name}/deploy/{id}/finalize`
- `POST /projects/{name}/deploy-key`
- `GET /projects/{name}/deploy-key`
- `DELETE /projects/{name}/deploy-key`
- `POST /projects/{name}/custom-domain`
- `POST /projects/{name}/custom-domain/certificate`
- `GET /projects/{name}/custom-domain`
- `POST /projects/{name}/custom-domain/provision`
- `DELETE /projects/{name}/custom-domain/{domain}`
- `DELETE /projects/{name}/custom-domain`

**Endpoints where `team_id` remains required:**

- `POST /projects/{name}/deploy?create=true` (when project doesn't exist yet — must know the owner)
- `GET /teams/{team_id}/projects` (listing inherently needs to know which team)

**No breaking changes.** Existing clients that pass `team_id` continue to work.

#### Implementation: `resolve_project()`

```python
def resolve_project(project_name: str, user: CurrentUser, team_id: str | None = None) -> tuple[str, dict]:
    """Resolve a project's owner and authorize the caller.

    Returns (owner_id, project_item).
    """
    # If team_id is provided, use existing behavior (optimization hint)
    if team_id:
        _check_team_membership(team_id, user["sub"])
        return team_id, get_project_or_404(project_name, team_id)

    # Look up owner from project_names table
    owner_id = get_project_owner(project_name)  # project_names table: name -> user_sub
    if not owner_id:
        raise HTTPException(status_code=404, detail="Project not found")

    project = get_project_or_404(project_name, owner_id)

    # Authorize caller against the resolved owner
    if project.get("owner_type") == "team":
        team = get_team(owner_id)
        member = get_member(owner_id, user["sub"])
        if not member:
            raise HTTPException(
                status_code=403,
                detail=f"Project '{project_name}' is owned by team '{team['slug']}'. "
                       f"You are not a member of this team. Ask a team admin to invite you.",
            )
    elif owner_id != user["sub"]:
        raise HTTPException(status_code=403, detail="Not authorized to access this project")

    return owner_id, project
```

#### New helper: `get_project_owner()`

Queries the `project_names` table by hash key `name`, returns the `user_sub` field (which is either a user ID or team ID).

#### Deploy key auth

Deploy keys are already scoped to a specific project and owner on the server side via the composite `project_id` (`project#{owner_id}#{name}`). When a request authenticates via deploy key (rather than JWT), the server extracts the owner from the key record directly — `resolve_project()` applies only to the JWT auth path.

**Important:** Each router (`projects.py`, `deploy.py`, `deploy_keys.py`) has its own `_resolve_owner()` function. All of these must be updated to use `resolve_project()` for the JWT auth path. The deploy key auth path in `_resolve_deploy_context()` already works without `team_id` and needs no changes.

Deploy keys survive team membership changes — the key is tied to the team+project, not the individual who created it. If the creating user leaves the team, the key continues to work. Keys only stop working if the team itself is suspended or deleted.

### 2. CLI: Drop Team from Config (kingslanding-cli)

#### Config changes

**`kl.json` schema:**

```json
{
  "project": "marketing-site",
  "directory": "build"
}
```

- `team` field removed from the schema
- If `team` is present in an existing `kl.json`, log a deprecation warning: "The 'team' field in kl.json is deprecated and will be ignored. The server now resolves project ownership automatically. You can safely remove it."
- `api_url` field stays (useful for local dev override)

#### Command changes

**`kl init`:**

- Becomes purely local config: prompts for project name and deploy directory, writes `kl.json`
- No team/owner prompt — owner selection happens during first deploy via the `--create` flow
- Today `kl init` does not call the API (it only writes `kl.json`), so this is not a behavior change
- `--team` flag removed from init

**`kl deploy`:**

- Stops sending `team_id` to the API (server resolves it)
- `--team` flag without `--create`: accepted but ignored with deprecation warning ("--team is no longer needed for deploys to existing projects and will be removed in a future version")
- `--team` flag with `--create`: used to specify owner for new project creation
- `--create` behavior:
  - Interactive: prompts for owner if project doesn't exist
  - Non-interactive with `KL_DEPLOY_KEY`: deploy key is already scoped to a project+owner on the server, no `--team` needed
  - Non-interactive without deploy key: requires `--team <slug>` to specify owner for the new project

**`kl deploy --json`** (new):

- Outputs structured JSON on success: `{"deployment_id": "...", "project_url": "..."}`
- Required for GitHub Action output capture
- Human-readable output remains the default

**`kl projects`:**

- No flags: lists all projects the user can access, grouped by owner (personal first, then each team)
- `--team <slug>`: filters to a specific team's projects
- `--personal`: filters to personal projects only
- Implementation: calls `GET /projects` (personal) + `GET /teams` + `GET /teams/{id}/projects` for each team

Grouped output format:
```
Personal
  NAME          URL                                    FILES  SIZE    LAST DEPLOYED
  my-blog       https://my-blog.kingslanding.io        42     1.2MB   3/28/2026

Acme Corp (acme-corp)
  NAME          URL                                    FILES  SIZE    LAST DEPLOYED
  marketing     https://marketing.kingslanding.io      120    4.5MB   3/29/2026
  docs          https://docs.kingslanding.io           85     2.1MB   3/25/2026
```

**`kl whoami`:**

- Existing: email, handle, plan tier
- New: list of teams with the user's role in each

**All other commands** (`ps`, `logs`, `run`, `down`, `deploy-key create/status/revoke`):

- Stop passing `team_id` — server resolves from project name
- `--team` flags: accepted but ignored with deprecation warning for one major version, then removed

**Verbose output (`--verbose` / `-v`):**

- When deploying, print the resolved owner context: `Deploying to marketing-site (owner: acme-corp)`
- Helps users verify the server resolved ownership correctly, replacing the signal previously provided by the `team` field in `kl.json`

#### Service layer changes

- `ProjectService`: remove `teamSlug` threading from deploy, deploy-key, and compute methods
- `DeployService`: remove `teamId` from `initiateDeploy()` and `finalizeDeploy()`
- `DeployKeyService`: remove `teamId` from all methods
- `ComputeService`: remove `teamId` from all methods
- Config loader: stop reading `team` from `kl.json`, add deprecation warning

### 3. Action: Rewrite as CLI Wrapper (deploy-to-kingslanding)

Replace the standalone JavaScript action with a composite action that wraps the CLI.

**New `action.yml`:**

```yaml
name: Deploy to King's Landing
description: Deploy a static site to King's Landing

inputs:
  project:
    description: Project name on King's Landing
    required: true
  directory:
    description: Directory to deploy
    required: true
  deploy-key:
    description: Deploy key for authentication
    required: true
  api-url:
    description: API URL override
    required: false

outputs:
  deployment-id:
    description: The deployment ID
    value: ${{ steps.deploy.outputs.deployment-id }}
  project-url:
    description: The live project URL
    value: ${{ steps.deploy.outputs.project-url }}

runs:
  using: composite
  steps:
    - name: Deploy
      id: deploy
      shell: bash
      run: |
        OUTPUT=$(npx --yes @kingslanding/cli@^1 deploy "${{ inputs.directory }}" \
          --project "${{ inputs.project }}" \
          --json)
        echo "deployment-id=$(echo "$OUTPUT" | jq -r '.deployment_id')" >> "$GITHUB_OUTPUT"
        echo "project-url=$(echo "$OUTPUT" | jq -r '.project_url')" >> "$GITHUB_OUTPUT"
      env:
        KL_DEPLOY_KEY: ${{ inputs.deploy-key }}
        KL_API_URL: ${{ inputs.api-url }}
```

**Files to delete:**

- `src/deploy.js`
- `src/index.js`
- `src/deploy.test.js`
- `dist/` (entire directory)

**`package.json`:** Remove or reduce to minimal metadata. No runtime dependencies needed.

**Dependency:** The CLI's `--json` flag must ship before or simultaneously with the action rewrite. The composite action depends on structured JSON output for setting GitHub Action outputs.

**Trade-offs:**

- Adds ~5-10s for `npx` download (cached on subsequent steps in same workflow)
- Requires Node.js on runner (GitHub-hosted runners include it)
- Version pinned to `@^1` (semver-safe) to avoid breaking CI on new major releases

**Benefits:**

- Eliminates 9MB payload limit (gets presigned URL uploads)
- Gets retry logic, parallel uploads, proper MIME detection for free
- One deploy path to maintain instead of two
- Same inputs/outputs — no breaking change for action consumers

## Backward Compatibility

| Surface | Change | Impact |
|---------|--------|--------|
| API endpoints | `team_id` becomes optional | Non-breaking. Existing clients still work. |
| `kl.json` | `team` field ignored | Deprecation warning logged. No breakage. |
| CLI `--team` flags | Warn-and-ignore on most commands | Deprecation warning logged. Scripts continue to work. Retained on `deploy --create` for project creation. Flags removed in next major version. |
| GitHub Action inputs | Same inputs, same outputs | Non-breaking for action consumers. |
| `PUT /api/v1/upload` endpoint | Unused after action rewrite | Can be deprecated separately. Not removed in this change. |

## Out of Scope

- **Project ownership transfer.** Moving a project from personal to team (or between teams) is not addressed. A future `kl transfer` command could handle this.
- **Deprecation of `PUT /api/v1/upload`.** The legacy single-payload upload endpoint used by the current action is left in place. It can be deprecated separately once the action rewrite ships and existing action versions age out.

## Sequencing

The changes must ship in this order:

1. **API** — `resolve_project()` and optional `team_id` (backward compatible, can ship independently)
2. **CLI** — drop team from config, add `--json` flag, deprecation warnings (requires API change)
3. **Action** — rewrite as composite action (requires CLI `--json` flag)

## Testing

**API:**

- Unit test `resolve_project()` for personal projects, team projects, and unauthorized access
- Unit test `resolve_project()` returns rich 403 message with team slug for team permission failures
- Unit test `get_project_owner()` for existing and non-existent projects
- Unit test: `team_id` provided as optimization hint still works (backward compat)
- Integration test: deploy to a team project without passing `team_id`
- Integration test: deploy-key create/status/revoke for team project without `team_id`
- Integration test: existing clients passing `team_id` still work

**CLI:**

- Config loader: test deprecation warning when `team` is present in `kl.json`
- Config loader: test that `team` field is not read/used
- Deploy service: test that `team_id` is not sent to API
- `--team` flag on non-creation commands: test deprecation warning is logged and flag is ignored
- `kl init`: test that no team prompt is shown, only project name + directory
- `kl projects`: test grouped output format (personal + teams)
- `kl whoami`: test team membership display
- `kl deploy --json`: test structured output format
- `kl deploy --create`: test interactive owner prompt and `--team` flag
- `kl deploy --verbose`: test resolved owner context is printed

**Action:**

- Integration test: deploy a test site using the composite action
- Verify outputs (deployment-id, project-url) are set correctly
