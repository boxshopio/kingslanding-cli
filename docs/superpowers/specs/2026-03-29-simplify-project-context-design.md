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
        _check_team_membership(owner_id, user["sub"])
    elif owner_id != user["sub"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    return owner_id, project
```

#### New helper: `get_project_owner()`

Queries the `project_names` table by hash key `name`, returns the `user_sub` field (which is either a user ID or team ID).

#### Deploy key auth

Deploy keys are already scoped to a specific project and owner on the server side. When a request authenticates via deploy key (rather than JWT), the server resolves the project from the key's scope directly — `resolve_project()` applies only to the JWT auth path.

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
- If `team` is present in an existing `kl.json`, log a deprecation warning: "The `team` field in kl.json is no longer needed and can be removed"
- `api_url` field stays (useful for local dev override)

#### Command changes

**`kl init`:**

- Still prompts "Who should own this project?" with choices: personal account + user's teams
- Passes `team_id` to the creation API call
- Does not persist team in `kl.json`
- `--team <slug>` flag retained for non-interactive creation

**`kl deploy`:**

- Stops sending `team_id` to the API (server resolves it)
- `--team` flag only accepted when `--create` is also passed (error otherwise)
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

**`kl whoami`:**

- Existing: email, handle, plan tier
- New: list of teams with the user's role in each

**All other commands** (`ps`, `logs`, `run`, `down`, `deploy-key create/status/revoke`):

- Stop passing `team_id` — server resolves from project name
- `--team` flags removed

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
        OUTPUT=$(npx --yes @kingslanding/cli@latest deploy "${{ inputs.directory }}" \
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

**Trade-offs:**

- Adds ~5-10s for `npx` download (cached on subsequent steps in same workflow)
- Requires Node.js on runner (GitHub-hosted runners include it)
- Version pinning: `@kingslanding/cli@latest` can be pinned to a specific version for stability

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
| CLI `--team` flags | Removed from most commands | Breaking for scripts using `--team` on deploy/ps/logs/etc. Retained on `init` and `deploy --create`. |
| GitHub Action inputs | Same inputs, same outputs | Non-breaking for action consumers. |
| `PUT /api/v1/upload` endpoint | Unused after action rewrite | Can be deprecated separately. Not removed in this change. |

## Testing

**API:**

- Unit test `resolve_project()` for personal projects, team projects, and unauthorized access
- Unit test `get_project_owner()` for existing and non-existent projects
- Integration test: deploy to a team project without passing `team_id`
- Integration test: existing clients passing `team_id` still work

**CLI:**

- Config loader: test deprecation warning when `team` is present in `kl.json`
- Config loader: test that `team` field is not read/used
- Deploy service: test that `team_id` is not sent to API
- `kl projects`: test grouped output (personal + teams)
- `kl whoami`: test team membership display
- `kl deploy --json`: test structured output format
- `kl deploy --create`: test interactive owner prompt and `--team` flag

**Action:**

- Integration test: deploy a test site using the composite action
- Verify outputs (deployment-id, project-url) are set correctly
