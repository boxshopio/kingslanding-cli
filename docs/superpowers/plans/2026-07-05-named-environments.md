# Named Environments (`-e/--env`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let developers point `kl` at a named backend (`kl -e dev deploy`) defined in global config, with `prod`/`local` built in and prod remaining the zero-config default.

**Architecture:** An "environment" is a named alias for an API URL. A pure `resolveNamedEnv(name, userEnvs)` merges built-in envs (`prod`, `local`) with the user's `environments` map from `~/.config/kl/config.json`; `resolveApiUrl` gains an optional `envName` that, when present, short-circuits to this resolver at the top of the existing precedence chain. A global `-e/--env` commander option on the root program is read in each command action via `program.opts().env` and threaded into `resolveApiUrl`. Credentials are already keyed by API URL, so auth follows for free.

**Tech Stack:** TypeScript (ESM, NodeNext), commander 13, vitest. Spec: `docs/superpowers/specs/2026-07-05-named-environments-design.md`.

---

## File Structure

- `src/lib/config.ts` — MODIFY: add `environments?` to `GlobalConfig`, `BUILTIN_ENVIRONMENTS` const, pure `resolveNamedEnv`, extend `resolveApiUrl` signature. Import `CLIError` from `./errors.js` (errors.ts is a leaf module — no import cycle).
- `src/index.ts` — MODIFY: register the global `-e, --env <name>` option on `program`.
- `src/commands/whoami.ts`, `logout.ts`, `projects.ts`, `deploy.ts`, `login.ts`, `deploy-key.ts` — MODIFY: read `program.opts().env` in each action and pass to `resolveApiUrl`. No action signatures change.
- `tests/lib/config.test.ts` — MODIFY: `resolveNamedEnv` + `resolveApiUrl(envName)` tests.
- `tests/commands/env-flag.test.ts` — CREATE: dependency-free commander smoke test proving `-e dev` before a subcommand lands in `program.opts().env`.

Precedence after this change (most → least explicit):
1. `-e <name>` → `resolveNamedEnv`
2. `KL_API_URL` env (unchanged escape hatch)
3. project `kl.json` `api_url`
4. global `config.json` `api_url`
5. built-in prod default (`DEFAULT_API_URL`)

---

## Task 1: Pure named-env resolution

**Files:**
- Modify: `src/lib/config.ts`
- Test: `tests/lib/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `tests/lib/config.test.ts` (after the `resolveApiUrl` block, ~line 149). Also add `resolveNamedEnv` to the module-binding block at the top of the file (declare `let resolveNamedEnv: typeof import("../../src/lib/config.js").resolveNamedEnv;` near line 13, and assign `resolveNamedEnv = mod.resolveNamedEnv;` in the `beforeEach` near line 25).

```typescript
describe("resolveNamedEnv", () => {
  it("resolves the built-in prod env with no user config", () => {
    expect(resolveNamedEnv("prod")).toBe("https://api.kingslanding.io");
  });

  it("resolves the built-in local env with no user config", () => {
    expect(resolveNamedEnv("local")).toBe("https://api.kl.test");
  });

  it("resolves a user-defined env", () => {
    expect(resolveNamedEnv("dev", { dev: "https://api.dev.kingslanding.io" })).toBe(
      "https://api.dev.kingslanding.io",
    );
  });

  it("lets a user env override a built-in of the same name", () => {
    expect(resolveNamedEnv("prod", { prod: "https://api.internal.test" })).toBe(
      "https://api.internal.test",
    );
  });

  it("throws a CLIError listing known envs for an unknown name", () => {
    expect(() => resolveNamedEnv("stg")).toThrowError(/Unknown environment 'stg'/);
    expect(() => resolveNamedEnv("stg")).toThrowError(/local, prod/);
  });

  it("includes user envs in the known-list of the error", () => {
    expect(() => resolveNamedEnv("stg", { dev: "https://api.dev.kingslanding.io" })).toThrowError(
      /dev, local, prod/,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/lib/config.test.ts`
Expected: FAIL — `resolveNamedEnv is not a function` (undefined export).

- [ ] **Step 3: Implement `resolveNamedEnv` + `BUILTIN_ENVIRONMENTS`**

In `src/lib/config.ts`, add the import near the top (with the other imports):

```typescript
import { CLIError } from "./errors.js";
```

Add `environments` to the `GlobalConfig` interface:

```typescript
export interface GlobalConfig {
  api_url?: string;
  login?: LoginPreferences;
  environments?: Record<string, string>;
}
```

Add the built-ins constant just below the existing `DEFAULT_API_URL` / `LOCAL_API_URL` constants (~line 6):

```typescript
/**
 * Environments shipped with every install. `prod` is the zero-config default;
 * `local` lines up with {@link isLocalMode}'s bypass auth. A user's
 * `environments` map in config.json is merged over these, so any built-in can
 * be repointed.
 */
const BUILTIN_ENVIRONMENTS: Record<string, string> = {
  prod: DEFAULT_API_URL,
  local: LOCAL_API_URL,
};
```

Add the resolver (place it just above `resolveApiUrl`):

```typescript
/**
 * Resolve a named environment to its API URL. Built-in envs are merged with the
 * caller-supplied user envs (user wins). An unknown name throws a {@link CLIError}
 * listing the known names, so the top-level handler prints it and exits cleanly.
 */
export function resolveNamedEnv(name: string, userEnvs: Record<string, string> = {}): string {
  const envs = { ...BUILTIN_ENVIRONMENTS, ...userEnvs };
  const url = envs[name];
  if (!url) {
    const known = Object.keys(envs).sort().join(", ");
    throw new CLIError(
      `Unknown environment '${name}'. Known: ${known}\n` +
        `  (define under "environments" in ${path.join(KL_DIR, "config.json")})`,
    );
  }
  return url;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/config.test.ts`
Expected: PASS (all `resolveNamedEnv` cases green; existing cases still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts tests/lib/config.test.ts
git commit -m "feat: add resolveNamedEnv with built-in prod/local environments"
```

---

## Task 2: Thread `envName` into `resolveApiUrl`

**Files:**
- Modify: `src/lib/config.ts:87` (`resolveApiUrl`)
- Test: `tests/lib/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe("resolveApiUrl", ...)` block (after the `env var takes precedence over kl.json` test, ~line 148). They rely only on built-in envs, so they need no global config file:

```typescript
it("resolves a built-in named env via the envName argument", () => {
  expect(resolveApiUrl(undefined, "local")).toBe("https://api.kl.test");
  expect(resolveApiUrl(undefined, "prod")).toBe("https://api.kingslanding.io");
});

it("named env beats KL_API_URL", () => {
  process.env.KL_API_URL = "https://env-override";
  expect(resolveApiUrl(undefined, "local")).toBe("https://api.kl.test");
});

it("named env beats kl.json api_url", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-env-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "kl.json"),
    JSON.stringify({ project: "test", api_url: "https://custom.api" }),
  );
  expect(resolveApiUrl(tmpDir, "local")).toBe("https://api.kl.test");
  fs.rmSync(tmpDir, { recursive: true });
});

it("throws for an unknown named env", () => {
  expect(() => resolveApiUrl(undefined, "stg")).toThrowError(/Unknown environment 'stg'/);
});

it("ignores an undefined envName and uses the normal chain", () => {
  process.env.KL_API_URL = "https://api.kl.test";
  expect(resolveApiUrl(undefined, undefined)).toBe("https://api.kl.test");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/lib/config.test.ts`
Expected: FAIL — `resolveApiUrl(undefined, "local")` returns the prod default (envName arg ignored) / no throw for `"stg"`.

- [ ] **Step 3: Extend `resolveApiUrl`**

Replace the signature and add the branch at the top of `src/lib/config.ts:87`:

```typescript
export function resolveApiUrl(cwd?: string, envName?: string): string {
  if (envName) {
    return resolveNamedEnv(envName, loadGlobalConfig().environments ?? {});
  }

  const resolvedCwd = cwd ?? process.cwd();

  const envUrl = process.env.KL_API_URL;
  if (envUrl) return envUrl;

  const config = loadProjectConfig(resolvedCwd);
  if (config?.api_url) return config.api_url;

  const globalConfig = loadGlobalConfig();
  if (globalConfig.api_url) return globalConfig.api_url;

  return DEFAULT_API_URL;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/config.test.ts`
Expected: PASS (new cases green; the `resolveApiUrl` regression cases from before still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts tests/lib/config.test.ts
git commit -m "feat: resolve named env via resolveApiUrl envName argument"
```

---

## Task 3: Register the global `-e/--env` option and wire commands

**Files:**
- Modify: `src/index.ts`
- Modify: `src/commands/whoami.ts`, `logout.ts`, `projects.ts`, `deploy.ts`, `login.ts`, `deploy-key.ts`
- Test: `tests/commands/env-flag.test.ts` (create)

- [ ] **Step 1: Write the failing commander smoke test**

Create `tests/commands/env-flag.test.ts` — verifies the exact behavior the wiring relies on (a root option passed *before* a subcommand is readable via `program.opts().env`), with no services involved:

```typescript
import { describe, it, expect } from "vitest";
import { Command } from "commander";

function buildProgram(): { program: Command; seen: () => string | undefined } {
  let captured: string | undefined;
  const program = new Command();
  program.option("-e, --env <name>", "Target a named environment");
  program.command("sub").action(() => {
    captured = program.opts().env as string | undefined;
  });
  return { program, seen: () => captured };
}

describe("global --env option", () => {
  it("is readable via program.opts() when passed before the subcommand", async () => {
    const { program, seen } = buildProgram();
    await program.parseAsync(["-e", "dev", "sub"], { from: "user" });
    expect(seen()).toBe("dev");
  });

  it("is undefined when the flag is absent", async () => {
    const { program, seen } = buildProgram();
    await program.parseAsync(["sub"], { from: "user" });
    expect(seen()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes already (commander behavior check)**

Run: `npm test -- tests/commands/env-flag.test.ts`
Expected: PASS. (This test documents/locks the commander contract the feature depends on; it does not require app changes. If it FAILS, stop — the wiring assumption is wrong and the rest of the task must be reconsidered.)

- [ ] **Step 3: Register the global option in `src/index.ts`**

Add the `.option(...)` to the `program` setup chain (line 23), so it becomes:

```typescript
program
  .name("kl")
  .description("Deploy static sites to King's Landing")
  .version(getVersion())
  .option("-e, --env <name>", "Target a named environment (defined in ~/.config/kl/config.json)");
```

- [ ] **Step 4: Wire each command action to read `program.opts().env`**

In every command below, read the env name from the captured root `program` and pass it into `resolveApiUrl`. No action signatures change.

`src/commands/whoami.ts:12` — replace `const apiUrl = resolveApiUrl();` with:

```typescript
      const envName = program.opts().env as string | undefined;
      const apiUrl = resolveApiUrl(undefined, envName);
```

`src/commands/logout.ts:12` — replace `const apiUrl = resolveApiUrl();` with:

```typescript
      const envName = program.opts().env as string | undefined;
      const apiUrl = resolveApiUrl(undefined, envName);
```

`src/commands/projects.ts:29` — replace `const apiUrl = resolveApiUrl();` with:

```typescript
      const envName = program.opts().env as string | undefined;
      const apiUrl = resolveApiUrl(undefined, envName);
```

`src/commands/login.ts:129` — replace `const apiUrl = resolveApiUrl();` with:

```typescript
      const envName = program.opts().env as string | undefined;
      const apiUrl = resolveApiUrl(undefined, envName);
```

`src/commands/deploy.ts:36` — replace `const apiUrl = resolveApiUrl(cwd);` with:

```typescript
        const envName = program.opts().env as string | undefined;
        const apiUrl = resolveApiUrl(cwd, envName);
```

`src/commands/deploy-key.ts` — the file defines three subcommand actions that each call `const apiUrl = resolveApiUrl();` (lines 42, 70, 102). In each of the three actions, replace that line with:

```typescript
      const envName = program.opts().env as string | undefined;
      const apiUrl = resolveApiUrl(undefined, envName);
```

(In `deploy-key.ts` the register function's `program` parameter is the root program even though the actions live on the nested `deploy-key` command, so `program.opts().env` reads the global option correctly.)

- [ ] **Step 5: Run the full suite + lint + typecheck**

Run: `npm run check`
Expected: PASS — lint (no unused vars — no signatures changed), typecheck (`program.opts().env` cast to `string | undefined`), and all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/commands tests/commands/env-flag.test.ts
git commit -m "feat: add global -e/--env flag for named-environment selection"
```

---

## Task 4: Manual verification against a real build

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: `dist/` produced, no errors.

- [ ] **Step 2: Verify prod default and built-in resolution**

Run: `node dist/index.js -e local whoami`
Expected: it attempts the *local* backend (e.g. "Authenticated via deploy key" / an auth or network message referencing local) — NOT prod. Contrast with `node dist/index.js whoami` (prod default).

- [ ] **Step 3: Verify the unknown-env error**

Run: `node dist/index.js -e nope whoami`
Expected: prints `Unknown environment 'nope'. Known: local, prod` and exits non-zero.

- [ ] **Step 4: Verify the flag appears in help**

Run: `node dist/index.js --help`
Expected: shows `-e, --env <name>  Target a named environment ...` under Options.

- [ ] **Step 5: No commit** (verification only). If any step misbehaves, return to the relevant task.

---

## Post-implementation (operator step, not code)

After `npm run check` is green and the branch is ready, populate the author's real config so `-e dev` works on their machine (prod/local are built in, so only `dev` is needed):

```jsonc
// ~/.config/kl/config.json  — merge, don't clobber existing keys (e.g. login)
{
  "environments": {
    "dev": "https://api.dev.kingslanding.io"
  }
}
```

This is done by the assistant with the user's go-ahead, preserving any existing `config.json` contents.

---

## Self-Review

- **Spec coverage:** config shape (Task 1) · built-in prod/local (Task 1) · `-e` flag global option (Task 3) · resolution precedence with `-e` highest (Task 2) · unknown-env CLIError (Tasks 1–2) · threading to all 7 call sites (Task 3) · credentials-follow-URL (no code, already true) · tests incl. built-in-with-no-config, user-overrides-built-in, precedence, regression (Tasks 1–2) · commander seam (Task 3) · config population (Post-impl). All covered.
- **Placeholder scan:** none — every code/test step shows full content.
- **Type consistency:** `resolveNamedEnv(name: string, userEnvs?: Record<string,string>)` and `resolveApiUrl(cwd?: string, envName?: string)` used identically across tasks; `program.opts().env as string | undefined` consistent at all 7 sites; `environments?: Record<string, string>` matches `resolveNamedEnv`'s param type.
