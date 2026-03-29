# Simplify Project Context Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove team context from CLI config and most commands by having the server resolve project ownership from the globally unique project name.

**Architecture:** Server-side `resolve_project()` function looks up the owner from the `project_names` DynamoDB table and authorizes the caller. CLI stops sending `team_id` on all operations except project creation. GitHub Action rewritten as a composite action wrapping the CLI.

**Tech Stack:** Python/FastAPI (API), TypeScript/Commander (CLI), GitHub Actions (Action), DynamoDB, Vitest, pytest

**Spec:** `docs/superpowers/specs/2026-03-29-simplify-project-context-design.md`

**Sequencing:** Phase 1 (API) must deploy before Phase 2 (CLI) is released. Phase 3 (Action) requires CLI `--json` flag from Phase 2.

---

## Phase 1: API — Server-Side Owner Resolution

**Repo:** `/Users/dreslan/repos/kingslanding`

### Task 1: Add `get_project_owner()` helper

**Files:**
- Modify: `app/backend/services/project_service.py`
- Create: `app/backend/tests/test_project_owner_resolution.py`

- [ ] **Step 1: Write failing tests for `get_project_owner()`**

```python
# app/backend/tests/test_project_owner_resolution.py
"""Tests for server-side project owner resolution."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from conftest import MOCK_USER, make_project_item


class TestGetProjectOwner:
    """Tests for get_project_owner() — project_names table lookup."""

    def test_returns_owner_for_existing_project(self):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {"name": "my-project", "user_sub": "user-123"}
        }
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        with patch("services.project_service.dynamodb", mock_ddb):
            from services.project_service import get_project_owner

            result = get_project_owner("my-project")

        assert result == "user-123"
        mock_table.get_item.assert_called_once_with(Key={"name": "my-project"})

    def test_returns_none_for_missing_project(self):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        with patch("services.project_service.dynamodb", mock_ddb):
            from services.project_service import get_project_owner

            result = get_project_owner("nonexistent")

        assert result is None

    def test_returns_team_id_for_team_project(self):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {"name": "team-project", "user_sub": "team-uuid-123"}
        }
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        with patch("services.project_service.dynamodb", mock_ddb):
            from services.project_service import get_project_owner

            result = get_project_owner("team-project")

        assert result == "team-uuid-123"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dreslan/repos/kingslanding/app/backend && uv run pytest tests/test_project_owner_resolution.py::TestGetProjectOwner -v`
Expected: FAIL — `get_project_owner` not found in `project_service`

- [ ] **Step 3: Implement `get_project_owner()`**

Add to `app/backend/services/project_service.py` after the `get_project_or_404()` function (after line 37):

```python
def get_project_owner(project_name: str) -> str | None:
    """Look up project owner from the project_names table.

    Returns the owner_id (user_sub or team_id) if the project exists, None otherwise.
    """
    names_table = dynamodb.Table(settings.project_names_table)
    try:
        response = names_table.get_item(Key={"name": project_name})
        item = response.get("Item")
        return item["user_sub"] if item else None
    except Exception as e:
        logger.error(f"Error looking up project owner for {project_name}: {e}")
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dreslan/repos/kingslanding/app/backend && uv run pytest tests/test_project_owner_resolution.py::TestGetProjectOwner -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/dreslan/repos/kingslanding && git add app/backend/services/project_service.py app/backend/tests/test_project_owner_resolution.py && git commit -m "feat: add get_project_owner() for project_names table lookup"
```

---

### Task 2: Add `resolve_project()` function

**Files:**
- Modify: `app/backend/services/project_service.py`
- Modify: `app/backend/tests/test_project_owner_resolution.py`

- [ ] **Step 1: Write failing tests for `resolve_project()`**

Append to `app/backend/tests/test_project_owner_resolution.py`:

```python
class TestResolveProject:
    """Tests for resolve_project() — owner resolution + authorization."""

    def _patch_all(self, ddb_mock):
        """Patch both project_service and team_service DynamoDB."""
        return (
            patch("services.project_service.dynamodb", ddb_mock),
            patch("services.team_service.dynamodb", ddb_mock),
        )

    def test_resolves_personal_project(self):
        mock_table = MagicMock()
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        # project_names lookup
        mock_table.get_item.side_effect = [
            {"Item": {"name": "my-site", "user_sub": "test-user-sub"}},       # get_project_owner
            {"Item": make_project_item(owner_type="user")},                    # get_project_or_404
        ]

        with self._patch_all(mock_ddb)[0], self._patch_all(mock_ddb)[1]:
            from services.project_service import resolve_project

            owner_id, project = resolve_project("my-site", MOCK_USER)

        assert owner_id == "test-user-sub"
        assert project.name == "my-project"

    def test_resolves_team_project_for_member(self):
        mock_table = MagicMock()
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        mock_table.get_item.side_effect = [
            {"Item": {"name": "team-site", "user_sub": "team-uuid"}},             # get_project_owner
            {"Item": make_project_item(user_sub="team-uuid", owner_type="team")},  # get_project_or_404
            {"Item": {"team_id": "team-uuid", "slug": "acme-corp", "name": "Acme Corp", "status": "active", "created_by": "x", "created_at": 0}},  # get_team
            {"Item": {"team_id": "team-uuid", "user_sub": "test-user-sub", "role": "EDITOR", "joined_at": 0}},  # get_member
        ]

        with self._patch_all(mock_ddb)[0], self._patch_all(mock_ddb)[1]:
            from services.project_service import resolve_project

            owner_id, project = resolve_project("team-site", MOCK_USER)

        assert owner_id == "team-uuid"

    def test_rejects_non_member_with_rich_403(self):
        mock_table = MagicMock()
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        mock_table.get_item.side_effect = [
            {"Item": {"name": "team-site", "user_sub": "team-uuid"}},             # get_project_owner
            {"Item": make_project_item(user_sub="team-uuid", owner_type="team")},  # get_project_or_404
            {"Item": {"team_id": "team-uuid", "slug": "acme-corp", "name": "Acme Corp", "status": "active", "created_by": "x", "created_at": 0}},  # get_team
            {},  # get_member — not a member
        ]

        with self._patch_all(mock_ddb)[0], self._patch_all(mock_ddb)[1]:
            from services.project_service import resolve_project

            with pytest.raises(HTTPException) as exc:
                resolve_project("team-site", MOCK_USER)

        assert exc.value.status_code == 403
        assert "acme-corp" in exc.value.detail
        assert "not a member" in exc.value.detail.lower()

    def test_rejects_unauthorized_personal_project(self):
        mock_table = MagicMock()
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        mock_table.get_item.side_effect = [
            {"Item": {"name": "other-site", "user_sub": "other-user"}},        # get_project_owner
            {"Item": make_project_item(user_sub="other-user", owner_type="user")},  # get_project_or_404
        ]

        with self._patch_all(mock_ddb)[0], self._patch_all(mock_ddb)[1]:
            from services.project_service import resolve_project

            with pytest.raises(HTTPException) as exc:
                resolve_project("other-site", MOCK_USER)

        assert exc.value.status_code == 403

    def test_returns_404_for_missing_project(self):
        mock_table = MagicMock()
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        mock_table.get_item.return_value = {}  # project_names returns nothing

        with self._patch_all(mock_ddb)[0], self._patch_all(mock_ddb)[1]:
            from services.project_service import resolve_project

            with pytest.raises(HTTPException) as exc:
                resolve_project("nonexistent", MOCK_USER)

        assert exc.value.status_code == 404

    def test_uses_team_id_hint_when_provided(self):
        """Backward compat: if team_id is explicitly passed, use it directly."""
        mock_table = MagicMock()
        mock_ddb = MagicMock()
        mock_ddb.Table.return_value = mock_table

        mock_table.get_item.side_effect = [
            {"Item": {"team_id": "team-uuid", "user_sub": "test-user-sub", "role": "EDITOR", "joined_at": 0}},  # get_member
            {"Item": make_project_item(user_sub="team-uuid", owner_type="team")},  # get_project_or_404
        ]

        with self._patch_all(mock_ddb)[0], self._patch_all(mock_ddb)[1]:
            from services.project_service import resolve_project

            owner_id, project = resolve_project("team-site", MOCK_USER, team_id="team-uuid")

        assert owner_id == "team-uuid"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dreslan/repos/kingslanding/app/backend && uv run pytest tests/test_project_owner_resolution.py::TestResolveProject -v`
Expected: FAIL — `resolve_project` not found

- [ ] **Step 3: Implement `resolve_project()`**

Add to `app/backend/services/project_service.py` after `get_project_owner()`:

```python
def resolve_project(
    project_name: str,
    user: dict,
    team_id: str | None = None,
) -> tuple[str, Item]:
    """Resolve a project's owner and authorize the caller.

    Args:
        project_name: The project name to look up.
        user: Authenticated user dict (CurrentUser).
        team_id: Optional team_id hint (backward compat). If provided,
                 skips the project_names lookup and uses this directly.

    Returns:
        Tuple of (owner_id, project Item).

    Raises:
        HTTPException 404: Project not found.
        HTTPException 403: Caller not authorized.
    """
    if team_id:
        from services.team_service import get_member

        member = get_member(team_id, user["sub"])
        if not member:
            raise HTTPException(status_code=403, detail="Not a member of this team")
        return team_id, get_project_or_404(project_name, team_id)

    owner_id = get_project_owner(project_name)
    if not owner_id:
        raise HTTPException(status_code=404, detail="Project not found")

    project = get_project_or_404(project_name, owner_id)

    if project.owner_type == "team":
        from services.team_service import get_member, get_team

        team = get_team(owner_id)
        member = get_member(owner_id, user["sub"])
        if not member:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Project '{project_name}' is owned by team '{team.slug}'. "
                    f"You are not a member of this team. Ask a team admin to invite you."
                ),
            )
    elif owner_id != user["sub"]:
        raise HTTPException(status_code=403, detail="Not authorized to access this project")

    return owner_id, project
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dreslan/repos/kingslanding/app/backend && uv run pytest tests/test_project_owner_resolution.py -v`
Expected: All passed

- [ ] **Step 5: Commit**

```bash
cd /Users/dreslan/repos/kingslanding && git add app/backend/services/project_service.py app/backend/tests/test_project_owner_resolution.py && git commit -m "feat: add resolve_project() with rich 403 errors for team projects"
```

---

### Task 3: Wire `resolve_project()` into routers

**Files:**
- Modify: `app/backend/routers/projects.py:439-448` — replace `_resolve_owner()`
- Modify: `app/backend/routers/deploy_keys.py:37-46` — replace `_resolve_owner()`
- Modify: `app/backend/routers/deployments.py:23-42` — replace both `_resolve_owner*()` functions
- Modify: `app/backend/routers/deploy.py:98-107` — update JWT path in `_resolve_deploy_context()`

- [ ] **Step 1: Update `deploy_keys.py` router**

Replace the `_resolve_owner()` function and update endpoints to use `resolve_project()`:

In `app/backend/routers/deploy_keys.py`, replace lines 37-46 (`_resolve_owner` function) with:

```python
from services.project_service import resolve_project as _resolve_project
```

Then update `verify_project_ownership()` at lines 49-55:

```python
def verify_project_ownership(name: str, owner_id: str) -> str:
    """Verify project exists under the given owner. Returns project_id."""
    project_id = make_project_id(owner_id, name)
    existing = get_existing_project(project_id, owner_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_id
```

Update `create_project_deploy_key()` endpoint (line 80):

```python
# Before:
owner_id = _resolve_owner(user, team_id)
# After:
owner_id, _ = _resolve_project(name, user, team_id)
```

Apply the same pattern to `get_project_deploy_key()` and `revoke_project_deploy_key()` endpoints — replace `_resolve_owner(user, team_id)` with `owner_id, _ = _resolve_project(name, user, team_id)`, and remove the `verify_project_ownership()` call (since `resolve_project` already verifies the project exists).

- [ ] **Step 2: Update `projects.py` router**

In `app/backend/routers/projects.py`, replace `_resolve_owner()` at lines 439-448 with:

```python
from services.project_service import resolve_project as _resolve_project
```

For each endpoint that currently does:
```python
owner_id = _resolve_owner(user, team_id)
project = get_project_or_404(project_name, owner_id)
```

Replace with:
```python
owner_id, project = _resolve_project(project_name, user, team_id)
```

For endpoints that only need `owner_id` (e.g., `add_custom_domain` which calls `get_project_or_404` separately), use `owner_id, _ = _resolve_project(...)`.

- [ ] **Step 3: Update `deployments.py` router**

In `app/backend/routers/deployments.py`, replace both `_resolve_owner()` and `_resolve_owner_for_write()` (lines 23-42) with:

```python
from services.project_service import resolve_project as _resolve_project
```

For each endpoint, replace:
```python
owner_id = _resolve_owner(user, team_id)
item = get_project_or_404(project_name, owner_id)
```

With:
```python
owner_id, item = _resolve_project(project_name, user, team_id)
```

Note: `_resolve_owner_for_write` checks `TeamRole.EDITOR` minimum. For now, `resolve_project()` only checks membership (any role). If write-level role checks are needed, add a `min_role` parameter to `resolve_project()` later. The spec doesn't require role-level changes — just ownership resolution.

- [ ] **Step 4: Update `deploy.py` router — JWT path only**

In `app/backend/routers/deploy.py`, update the JWT branch of `_resolve_deploy_context()` (lines 98-107):

```python
    else:
        # JWT user path — resolve owner from project name or team_id hint
        from services.project_service import get_project_owner

        if team_id:
            from dependencies import _check_team_role
            from models import TeamRole

            _check_team_role(team_id, user_sub, TeamRole.EDITOR)
            owner_id = team_id
            owner_type = "team"
        else:
            resolved_owner = get_project_owner(project_name)
            if resolved_owner and resolved_owner != user_sub:
                # Project exists and is owned by someone else (likely a team)
                from services.project_service import get_project_or_404

                project = get_project_or_404(project_name, resolved_owner)
                if project.owner_type == "team":
                    from dependencies import _check_team_role
                    from models import TeamRole

                    _check_team_role(resolved_owner, user_sub, TeamRole.EDITOR)
                    owner_id = resolved_owner
                    owner_type = "team"
                else:
                    raise HTTPException(status_code=403, detail="Not authorized to access this project")
            else:
                owner_id = user_sub
                owner_type = "user"
```

The deploy key path (lines 78-97) remains unchanged.

- [ ] **Step 5: Run the full API test suite**

Run: `cd /Users/dreslan/repos/kingslanding/app/backend && uv run pytest -v`
Expected: All existing tests pass (backward compatible — team_id is still accepted)

- [ ] **Step 6: Commit**

```bash
cd /Users/dreslan/repos/kingslanding && git add app/backend/routers/ app/backend/services/project_service.py && git commit -m "feat: wire resolve_project() into all routers, make team_id optional"
```

---

### Task 4: Add owner context to deploy initiate response

**Files:**
- Modify: `app/backend/routers/deploy.py:35-41` — add `owner` field to `DeployInitiateResponse`
- Modify: `app/backend/services/deploy_api_service.py` — return owner info from `initiate_deploy()`

- [ ] **Step 1: Add `owner` to `DeployInitiateResponse`**

In `app/backend/routers/deploy.py`, update the response model (lines 35-41):

```python
class OwnerInfo(BaseModel):
    """Owner context returned with deploy responses."""

    type: str  # "user" or "team"
    slug: str | None = None  # team slug, None for personal


class DeployInitiateResponse(BaseModel):
    """Response for a successful deployment initiation."""

    deployment_id: str
    expires_at: int
    uploads: list[dict]
    project_created: bool
    owner: OwnerInfo | None = None
```

- [ ] **Step 2: Return owner info from the deploy endpoint**

In `app/backend/routers/deploy.py`, update `deploy_initiate()` (after line 125):

```python
    owner_id, owner_type = _resolve_deploy_context(name, user, body.team_id)

    # Resolve team slug for owner context
    owner_info = None
    if owner_type == "team":
        try:
            from services.team_service import get_team

            team = get_team(owner_id)
            owner_info = OwnerInfo(type="team", slug=team.slug)
        except Exception:
            owner_info = OwnerInfo(type="team")
    else:
        owner_info = OwnerInfo(type="user")

    result = initiate_deploy(
        project_name=name,
        owner_id=owner_id,
        owner_type=owner_type,
        files=[f.model_dump() for f in body.files],
        auto_create=create,
        deployed_by=user["sub"],
    )
    return DeployInitiateResponse(**result, owner=owner_info)
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/dreslan/repos/kingslanding/app/backend && uv run pytest -v`
Expected: All pass (owner field is optional with default None)

- [ ] **Step 4: Commit**

```bash
cd /Users/dreslan/repos/kingslanding && git add app/backend/routers/deploy.py && git commit -m "feat: include owner context in deploy initiate response"
```

---

## Phase 2: CLI — Drop Team from Config

**Repo:** `/Users/dreslan/repos/kingslanding-cli`

### Task 5: Update config loader — remove team, add deprecation warning

**Files:**
- Modify: `src/lib/config.ts:9-14,39-56,58-61`
- Modify: `tests/lib/config.test.ts:61-95`

- [ ] **Step 1: Write failing tests**

Replace the `loadProjectConfig` and `writeProjectConfig` describe blocks in `tests/lib/config.test.ts`:

```typescript
describe("loadProjectConfig", () => {
  it("returns config without team field", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    const klJson = path.join(tmpDir, "kl.json");
    fs.writeFileSync(klJson, JSON.stringify({ project: "my-site", directory: "dist" }));
    const config = loadProjectConfig(tmpDir);
    expect(config).toEqual({ project: "my-site", directory: "dist" });
    expect(config).not.toHaveProperty("team");
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("logs deprecation warning when team field is present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    const klJson = path.join(tmpDir, "kl.json");
    fs.writeFileSync(klJson, JSON.stringify({ project: "my-site", directory: "dist", team: "frontend" }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadProjectConfig(tmpDir);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns null when kl.json does not exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    expect(loadProjectConfig(tmpDir)).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("defaults directory to . when not specified", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    fs.writeFileSync(path.join(tmpDir, "kl.json"), JSON.stringify({ project: "test" }));
    const config = loadProjectConfig(tmpDir);
    expect(config?.directory).toBe(".");
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("writeProjectConfig", () => {
  it("writes kl.json without team field", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-write-"));
    writeProjectConfig(tmpDir, { project: "my-site", directory: "dist" });
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, "kl.json"), "utf-8"));
    expect(written.project).toBe("my-site");
    expect(written.directory).toBe("dist");
    expect(written).not.toHaveProperty("team");
    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm test -- tests/lib/config.test.ts`
Expected: Failures — config still returns `team` field

- [ ] **Step 3: Update `src/lib/config.ts`**

Update `ProjectConfig` interface (lines 9-14):

```typescript
export interface ProjectConfig {
  project: string;
  directory: string;
  api_url?: string;
}
```

Update `loadProjectConfig()` (lines 39-56):

```typescript
export function loadProjectConfig(cwd: string): ProjectConfig | null {
  const configPath = path.join(cwd, "kl.json");
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.project || typeof parsed.project !== "string") return null;

    if ("team" in parsed && parsed.team != null) {
      console.warn(
        'Warning: The "team" field in kl.json is deprecated and will be ignored. ' +
        "The server now resolves project ownership automatically. " +
        "You can safely remove it.",
      );
    }

    return {
      project: parsed.project,
      directory: typeof parsed.directory === "string" ? parsed.directory : ".",
      api_url: typeof parsed.api_url === "string" ? parsed.api_url : undefined,
    };
  } catch {
    return null;
  }
}
```

Update `writeProjectConfig()` (line 58):

```typescript
export function writeProjectConfig(cwd: string, config: Pick<ProjectConfig, "project" | "directory">): void {
  const configPath = path.join(cwd, "kl.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm test -- tests/lib/config.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
cd /Users/dreslan/repos/kingslanding-cli && git add src/lib/config.ts tests/lib/config.test.ts && git commit -m "feat: remove team from ProjectConfig, add deprecation warning"
```

---

### Task 6: Remove `teamId` from API client and services

**Files:**
- Modify: `src/lib/api.ts:9-12,139-200`
- Modify: `src/services/deploy-service.ts:10-19,24-107`
- Modify: `src/services/deploy-key-service.ts`
- Modify: `tests/services/deploy-service.test.ts:149-179`
- Modify: `tests/services/deploy-key-service.test.ts`

- [ ] **Step 1: Update deploy service test — remove teamId**

In `tests/services/deploy-service.test.ts`, replace the test at lines 149-179:

```typescript
    it("passes create option", async () => {
      const api = mockApiClient({
        initiateDeploy: vi.fn().mockResolvedValue({
          deployment_id: "d",
          expires_at: 0,
          uploads: [],
          project_created: true,
        }),
      });

      const service = new DeployService(api);
      await service.deploy({
        projectName: "new-site",
        files: [],
        readFile: vi.fn(),
        onProgress: vi.fn(),
        create: true,
      });

      expect(api.initiateDeploy).toHaveBeenCalledWith(
        "new-site",
        expect.objectContaining({ files: [] }),
        { create: true },
      );
      expect(api.finalizeDeploy).toHaveBeenCalledWith("new-site", "d");
    });
```

- [ ] **Step 2: Update deploy-key service test — remove teamId**

In `tests/services/deploy-key-service.test.ts`, update the tests:

```typescript
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm test`
Expected: Failures — services still accept teamId

- [ ] **Step 4: Update API client — remove teamId from signatures**

In `src/lib/api.ts`:

Remove `team_id` from `DeployInitiateRequest` and add `owner` to `DeployInitiateResponse` (lines 9-19):
```typescript
export interface DeployInitiateRequest {
  files: FileManifestEntry[];
}

export interface DeployInitiateResponse {
  deployment_id: string;
  expires_at: number;
  uploads: { path: string; presigned_url: string }[];
  project_created: boolean;
  owner?: { type: string; slug?: string | null };
}
```

Remove `teamId` param from `finalizeDeploy` (lines 152-167):
```typescript
  async finalizeDeploy(
    projectName: string,
    deploymentId: string,
  ): Promise<DeployFinalizeResponse> {
    return this.request(
      "POST",
      "/projects/" + projectName + "/deploy/" + deploymentId + "/finalize",
    );
  }
```

Remove `teamId` param from `createDeployKey` (lines 169-178):
```typescript
  async createDeployKey(projectName: string): Promise<DeployKeyResponse> {
    return this.request("POST", "/projects/" + projectName + "/deploy-key");
  }
```

Remove `teamId` param from `getDeployKeyStatus` (lines 180-189):
```typescript
  async getDeployKeyStatus(projectName: string): Promise<DeployKeyStatusResponse> {
    return this.request("GET", "/projects/" + projectName + "/deploy-key");
  }
```

Remove `teamId` param from `revokeDeployKey` (lines 191-200):
```typescript
  async revokeDeployKey(projectName: string): Promise<void> {
    await this.request("DELETE", "/projects/" + projectName + "/deploy-key");
  }
```

- [ ] **Step 5: Update deploy service — remove teamId**

In `src/services/deploy-service.ts`:

Remove `teamId` from `DeployOptions` and add `owner` to the return type (lines 10-19):
```typescript
export interface DeployOptions {
  projectName: string;
  files: FileEntry[];
  readFile: (absolutePath: string) => Buffer;
  onProgress: (completed: number, total: number) => void;
  create?: boolean;
  concurrency?: number;
  retryDelayMs?: number;
}

export interface DeployResult extends DeployFinalizeResponse {
  owner?: { type: string; slug?: string | null };
}
```

Update the `deploy()` method return type to `DeployResult`, remove `teamId` from destructuring (line 31) and from API calls:

Line 44: `{ files: manifest }` (remove `team_id: teamId`)
Line 106: Capture owner from initiate and merge into finalize result:
```typescript
    const finalizeResult = await this.api.finalizeDeploy(projectName, initResult.deployment_id);
    return { ...finalizeResult, owner: initResult.owner };
```

- [ ] **Step 6: Update deploy-key service — remove teamId**

Replace `src/services/deploy-key-service.ts`:

```typescript
import type {
  ApiClient,
  DeployKeyResponse,
  DeployKeyStatusResponse,
} from "../lib/api.js";

export class DeployKeyService {
  constructor(private readonly api: ApiClient) {}

  async create(projectName: string): Promise<DeployKeyResponse> {
    return this.api.createDeployKey(projectName);
  }

  async status(projectName: string): Promise<DeployKeyStatusResponse> {
    return this.api.getDeployKeyStatus(projectName);
  }

  async revoke(projectName: string): Promise<void> {
    return this.api.revokeDeployKey(projectName);
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm test`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
cd /Users/dreslan/repos/kingslanding-cli && git add src/lib/api.ts src/services/deploy-service.ts src/services/deploy-key-service.ts tests/services/deploy-service.test.ts tests/services/deploy-key-service.test.ts && git commit -m "refactor: remove teamId from API client and service layers"
```

---

### Task 7: Simplify init command — remove team picker

**Files:**
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Replace init command**

Replace `src/commands/init.ts`:

```typescript
import type { Command } from "commander";
import { input } from "@inquirer/prompts";
import { loadProjectConfig, writeProjectConfig } from "../lib/config.js";
import { CLIError } from "../lib/errors.js";

const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]{2,61}[a-z0-9]$/;

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a kl.json config in the current directory")
    .action(async () => {
      const cwd = process.cwd();
      const existing = loadProjectConfig(cwd);
      if (existing) {
        throw new CLIError(
          "kl.json already exists in this directory. Delete it first to re-initialize.",
        );
      }

      const project = await input({
        message: "Project name",
        validate: (value) => {
          if (!PROJECT_NAME_REGEX.test(value)) {
            return "Must be 4-63 characters, lowercase alphanumeric and hyphens, start/end with alphanumeric.";
          }
          return true;
        },
      });

      const directory = await input({
        message: "Deploy directory",
        default: ".",
      });

      writeProjectConfig(cwd, { project, directory });
      console.log("Created kl.json");
    });
}
```

- [ ] **Step 2: Run the full test suite**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm run check`
Expected: Lint + typecheck + tests all pass

- [ ] **Step 3: Commit**

```bash
cd /Users/dreslan/repos/kingslanding-cli && git add src/commands/init.ts && git commit -m "refactor: simplify init command — remove team picker"
```

---

### Task 8: Update deploy command — deprecation warning, remove team usage

**Files:**
- Modify: `src/commands/deploy.ts:43,52,107-137,167`

- [ ] **Step 1: Update deploy command**

In `src/commands/deploy.ts`:

Keep the `--team` option defined (line 43) but change its behavior. Remove `config?.team` fallback and team resolution logic. Replace lines 107-137 and update `runDeploy`:

```typescript
        // Deprecation warning for --team without --create
        if (options.team && !options.create) {
          console.warn(
            "Warning: --team is no longer needed for deploys to existing projects and will be removed in a future version.",
          );
        }

        // Ensure auth
        let authHeader = getAuthHeader(apiUrl);
        if (!authHeader) {
          throw new AuthError("Not logged in. Run `kl login` first.");
        }

        const api = new ApiClient(apiUrl, authHeader);

        // Refresh token if needed (JWT only, not deploy keys)
        if (!isDeployKeyAuth()) {
          const creds = loadCredentials(apiUrl);
          if (creds) {
            const authService = new AuthService(api, apiUrl);
            await authService.refreshIfNeeded(creds);
            authHeader = getAuthHeader(apiUrl);
            if (authHeader) {
              api.updateAuthHeader(authHeader);
            }
          }
        }
```

Update `runDeploy` to remove `teamId`:

```typescript
        const runDeploy = async (create?: boolean) => {
          return deployService.deploy({
            projectName,
            files,
            readFile: defaultReadFile,
            onProgress: (completed, total) => {
              spinner.text = "Uploading " + completed + "/" + total + " files...";
            },
            create,
          });
        };
```

Add verbose owner output after the deploy succeeds (inside the success block, before the "Done." message):

```typescript
          if (options.verbose && result.owner) {
            const ownerLabel = result.owner.type === "team" && result.owner.slug
              ? result.owner.slug
              : "personal";
            console.log("Deploying to " + projectName + " (owner: " + ownerLabel + ")");
          }
```

Remove the `ProjectService` import if no longer used in this file (it was only used for `resolveTeamId`).

- [ ] **Step 2: Run tests**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm run check`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
cd /Users/dreslan/repos/kingslanding-cli && git add src/commands/deploy.ts && git commit -m "refactor: remove team resolution from deploy command, add deprecation warning"
```

---

### Task 9: Update deploy-key commands — deprecation warning, remove team usage

**Files:**
- Modify: `src/commands/deploy-key.ts`

- [ ] **Step 1: Update deploy-key commands**

Replace `src/commands/deploy-key.ts`:

```typescript
import type { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl, loadProjectConfig } from "../lib/config.js";
import { getAuthHeader } from "../lib/auth.js";
import { CLIError, AuthError } from "../lib/errors.js";
import { DeployKeyService } from "../services/deploy-key-service.js";

function resolveProject(options: { project?: string }): string {
  const config = loadProjectConfig(process.cwd());
  const projectName = options.project ?? config?.project;
  if (!projectName) {
    throw new CLIError(
      "No project name. Use --project <name> or run `kl init`.",
    );
  }
  return projectName;
}

function warnTeamDeprecation(team: string | undefined): void {
  if (team) {
    console.warn(
      "Warning: --team is no longer needed and will be removed in a future version. " +
      "The server now resolves project ownership automatically.",
    );
  }
}

export function registerDeployKeyCommand(program: Command): void {
  const cmd = program
    .command("deploy-key")
    .description("Manage deploy keys for CI/CD");

  cmd
    .command("create")
    .description("Create a deploy key for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug (deprecated, ignored)")
    .action(async (options: { project?: string; team?: string }) => {
      warnTeamDeprecation(options.team);

      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const projectName = resolveProject(options);
      const api = new ApiClient(apiUrl, authHeader);
      const deployKeyService = new DeployKeyService(api);
      const result = await deployKeyService.create(projectName);

      console.log();
      console.log("Deploy key created for " + projectName + ":");
      console.log();
      console.log("  " + result.key);
      console.log();
      console.log("Save this key now — it will not be shown again.");
      console.log("Set it as KL_DEPLOY_KEY in your CI/CD environment.");
    });

  cmd
    .command("revoke")
    .description("Revoke the deploy key for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug (deprecated, ignored)")
    .action(async (options: { project?: string; team?: string }) => {
      warnTeamDeprecation(options.team);

      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const projectName = resolveProject(options);

      const shouldRevoke = await confirm({
        message: "Revoke the deploy key for " + projectName + "? This cannot be undone.",
        default: false,
      });

      if (!shouldRevoke) {
        console.log("Cancelled.");
        return;
      }

      const api = new ApiClient(apiUrl, authHeader);
      const deployKeyService = new DeployKeyService(api);
      await deployKeyService.revoke(projectName);
      console.log("Deploy key revoked for " + projectName + ".");
    });

  cmd
    .command("status")
    .description("Check deploy key status for a project")
    .option("-p, --project <name>", "Project name")
    .option("-t, --team <slug>", "Team slug (deprecated, ignored)")
    .action(async (options: { project?: string; team?: string }) => {
      warnTeamDeprecation(options.team);

      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      const projectName = resolveProject(options);
      const api = new ApiClient(apiUrl, authHeader);
      const deployKeyService = new DeployKeyService(api);
      const result = await deployKeyService.status(projectName);

      if (result.exists) {
        console.log("Deploy key active for " + projectName);
        console.log("  Prefix: " + result.key_prefix);
        if (result.created_at) {
          console.log(
            "  Created: " + new Date(result.created_at * 1000).toISOString(),
          );
        }
      } else {
        console.log("No deploy key configured for " + projectName + ".");
      }
    });
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm run check`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
cd /Users/dreslan/repos/kingslanding-cli && git add src/commands/deploy-key.ts && git commit -m "refactor: remove team resolution from deploy-key commands, add deprecation warning"
```

---

### Task 10: Update projects command — grouped output

**Files:**
- Modify: `src/commands/projects.ts`
- Modify: `tests/services/project-service.test.ts`

- [ ] **Step 1: Update project-service test — remove obsolete team tests**

Replace `tests/services/project-service.test.ts`:

```typescript
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
        {
          name: "my-site",
          file_count: 5,
          total_size_bytes: 1024,
          cloudfront_url: "/prefix/",
          last_updated: 1234567890,
        },
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm test -- tests/services/project-service.test.ts`
Expected: Fail — `listAllProjects` doesn't exist

- [ ] **Step 3: Add `listAllProjects()` to ProjectService**

In `src/services/project-service.ts`, add the new method:

```typescript
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
```

- [ ] **Step 4: Update projects command for grouped output**

Replace `src/commands/projects.ts`:

```typescript
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
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm run check`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
cd /Users/dreslan/repos/kingslanding-cli && git add src/services/project-service.ts src/commands/projects.ts tests/services/project-service.test.ts && git commit -m "feat: add grouped project listing across personal and team projects"
```

---

### Task 11: Update whoami command — show teams

**Files:**
- Modify: `src/commands/whoami.ts`

- [ ] **Step 1: Update whoami to show teams**

Replace `src/commands/whoami.ts`:

```typescript
import type { Command } from "commander";
import { ApiClient } from "../lib/api.js";
import { resolveApiUrl } from "../lib/config.js";
import { getAuthHeader, isDeployKeyAuth } from "../lib/auth.js";
import { AuthError } from "../lib/errors.js";

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show the current authenticated user")
    .action(async () => {
      const apiUrl = resolveApiUrl();
      const authHeader = getAuthHeader(apiUrl);
      if (!authHeader) {
        throw new AuthError("Not logged in. Run `kl login` first.");
      }

      if (isDeployKeyAuth()) {
        console.log("Authenticated via deploy key");
        return;
      }

      const api = new ApiClient(apiUrl, authHeader);
      const [account, teams] = await Promise.all([
        api.getAccount(),
        api.listTeams(),
      ]);

      console.log(account.email + " (" + account.plan_tier + ")");

      if (teams.length > 0) {
        console.log();
        console.log("Teams:");
        for (const t of teams) {
          console.log("  " + t.team.name + " (" + t.team.slug + ") — " + t.role.toLowerCase());
        }
      }
    });
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm run check`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
cd /Users/dreslan/repos/kingslanding-cli && git add src/commands/whoami.ts && git commit -m "feat: show team memberships in whoami output"
```

---

### Task 12: Add `--json` flag to deploy command

**Files:**
- Modify: `src/commands/deploy.ts`

- [ ] **Step 1: Add `--json` option and output**

In `src/commands/deploy.ts`, add the option after line 45:

```typescript
    .option("--json", "Output deployment result as JSON")
```

Add `json?: boolean` to the options type.

Then update the success output (around line 209-224). Replace:

```typescript
          if (options.verbose) {
            console.log(
              "Deployed " +
                result.files +
                " files (" +
                formatBytes(result.total_size) +
                ") in " +
                elapsed +
                "s",
            );
          }

          console.log("Done. " + result.url);
```

With:

```typescript
          if (options.json) {
            console.log(JSON.stringify({
              deployment_id: result.deployment_id,
              project_url: result.url,
              files: result.files,
              total_size: result.total_size,
            }));
          } else {
            if (options.verbose) {
              console.log(
                "Deployed " +
                  result.files +
                  " files (" +
                  formatBytes(result.total_size) +
                  ") in " +
                  elapsed +
                  "s",
              );
            }
            console.log("Done. " + result.url);
          }
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/dreslan/repos/kingslanding-cli && npm run check`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
cd /Users/dreslan/repos/kingslanding-cli && git add src/commands/deploy.ts && git commit -m "feat: add --json flag to deploy for structured output"
```

---

## Phase 3: Action — Rewrite as CLI Wrapper

**Repo:** `/Users/dreslan/repos/deploy-to-kingslanding`

### Task 13: Rewrite action as composite wrapping the CLI

**Files:**
- Modify: `action.yml`
- Modify: `README.md`
- Delete: `src/deploy.js`
- Delete: `src/index.js`
- Delete: `src/deploy.test.js`
- Delete: `dist/` (entire directory)

- [ ] **Step 1: Replace `action.yml`**

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
          --json 2>/dev/null)
        echo "deployment-id=$(echo "$OUTPUT" | jq -r '.deployment_id')" >> "$GITHUB_OUTPUT"
        echo "project-url=$(echo "$OUTPUT" | jq -r '.project_url')" >> "$GITHUB_OUTPUT"
        echo "Deployed to $(echo "$OUTPUT" | jq -r '.project_url')"
      env:
        KL_DEPLOY_KEY: ${{ inputs.deploy-key }}
        KL_API_URL: ${{ inputs.api-url }}
```

- [ ] **Step 2: Delete old implementation files**

```bash
cd /Users/dreslan/repos/deploy-to-kingslanding && rm -rf src/ dist/
```

- [ ] **Step 3: Update `package.json`**

Remove `@actions/core` dependency and build scripts. Keep only metadata fields (name, version, description, license).

- [ ] **Step 4: Update `README.md`**

Update to reflect the simplified architecture — note that the action now uses the CLI internally, remove the 9MB payload limit note, update the usage example if needed.

- [ ] **Step 5: Commit**

```bash
cd /Users/dreslan/repos/deploy-to-kingslanding && git add -A && git commit -m "feat: rewrite action as composite wrapping @kingslanding/cli

Replaces standalone JS deploy logic with npx @kingslanding/cli.
Eliminates 9MB payload limit, adds retry logic and parallel uploads.
Same inputs/outputs — no breaking change for consumers."
```

---

## Final Verification

- [ ] **Run full test suites across all repos**

```bash
cd /Users/dreslan/repos/kingslanding/app/backend && uv run pytest -v
cd /Users/dreslan/repos/kingslanding-cli && npm run check
```

- [ ] **Verify backward compatibility** — existing `kl.json` files with `team` field produce deprecation warning but still work

- [ ] **Verify sequencing** — API changes are independent and can deploy first. CLI changes depend on API. Action changes depend on CLI `--json`.
