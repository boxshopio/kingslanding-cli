# Named Environments (`-e/--env`) — Design

**Date:** 2026-07-05
**Status:** Approved, pending implementation
**Author:** tony

## Problem

Developers working on `kl` routinely need to point the CLI at different API
backends — `local`, `dev`, and `prod`. Today the only mechanism is the
`KL_API_URL` environment variable, which is verbose to set per-invocation and
easy to leave exported (stale) across a shell session. End users, by contrast,
only ever care about `prod` and should not need to know this machinery exists.

We want a convenient, low-key way for developers to select a backend, without
adding a concept normal users must learn.

## Goals

- Let a developer target a backend by short name: `kl -e dev deploy`.
- Keep `prod` the zero-config default — a fresh install with no config file
  works and hits prod.
- No hidden persistent state that could cause an accidental prod deploy.
- Reuse the existing per-URL credential model — no new auth concept.

## Non-Goals

- `kl env list/use/add` management subcommands (YAGNI — edit the JSON directly,
  like AWS profiles). May be added later if hand-editing becomes painful.
- A persistent "active/current" environment (kubectl-style). Deliberately
  rejected: for a deploy tool, a sticky context is a footgun ("I forgot I was
  on dev / on prod"). Selection is per-invocation only.
- Accepting a raw URL as the `-e` value. `-e` takes a *defined name* only; the
  `KL_API_URL` env var remains the ad-hoc raw-URL escape hatch.

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| State model | Per-invocation flag only, no sticky state | Safest for a deploy tool; nothing to forget |
| `-e` value | Named env only (must resolve); unknown → hard error | Typo-proof, matches AWS `--profile` |
| Where envs are defined | Global `config.json` only, never `kl.json` | Machine/developer setting, not per-project; avoids committing a `dev` endpoint |
| Is prod addressable? | Yes — built-in named env, overridable | Nothing unchangeably locked in; `-e prod` works out of the box |
| Precedence of `-e` | Highest — above `KL_API_URL` | It's the most explicit signal (typed now) |

## Design

### Config shape (global only)

`GlobalConfig` gains an optional `environments` map in
`~/.config/kl/config.json`:

```json
{
  "api_url": "https://api.kingslanding.io",
  "environments": {
    "dev": "https://api.dev.kingslanding.io"
  }
}
```

`ProjectConfig` (`kl.json`) is untouched — no risk of an environment endpoint
being committed to a repo.

### Built-in environments

A constant seeds two always-present names; the user's `environments` map is
merged *over* it (user entries win), so any built-in can be repointed:

```typescript
const BUILTIN_ENVIRONMENTS: Record<string, string> = {
  prod: DEFAULT_API_URL,   // https://api.kingslanding.io
  local: LOCAL_API_URL,    // https://api.kl.test
};
```

Consequences:

- `kl -e prod` and `kl -e local` work with an empty (or absent) config file.
- `prod` is no longer "special" — it is simply the default env; the hardcoded
  `DEFAULT_API_URL` is only the last-resort zero-config fallback, not a lock.
- `local` lines up with the existing `isLocalMode()` / `local-bypass` auth
  machinery (config.ts:137, auth.ts:81) — no drift between the URL the flag
  resolves and the URL the bypass recognizes.
- Because the user's config takes precedence over the built-ins, the user can
  even repoint `prod` if they ever need to.

### Flag

A **global** commander option on `program` in `index.ts`, so it may appear
before the subcommand:

```
-e, --env <name>    Target a named environment (defined in ~/.config/kl/config.json)
```

Examples: `kl -e dev deploy`, `kl -e local whoami`, `kl -e prod deploy`.

The flag is left visible in `kl --help`. Hiding it buys little: a fresh install
defines only the built-ins, so it is inert for normal users, and the value must
resolve to a defined name.

### Resolution

`resolveApiUrl` gains an optional `envName` and a new highest-priority branch.
Full precedence, most to least explicit:

1. `-e <name>` → resolved env (built-ins merged with config; unknown → error)
2. `KL_API_URL` env *(unchanged — ad-hoc raw-URL escape hatch)*
3. project `kl.json` `api_url`
4. global `config.json` `api_url`
5. built-in prod default (`DEFAULT_API_URL`)

```typescript
export function resolveApiUrl(cwd?: string, envName?: string): string {
  if (envName) return resolveNamedEnv(envName); // throws CLIError if undefined
  // ...existing chain unchanged...
}

function resolveNamedEnv(name: string): string {
  const envs = { ...BUILTIN_ENVIRONMENTS, ...(loadGlobalConfig().environments ?? {}) };
  const url = envs[name];
  if (!url) {
    const known = Object.keys(envs).sort().join(", ");
    throw new CLIError(
      `unknown environment '${name}'. Known: ${known}\n` +
        `  (define under "environments" in ${path.join(KL_DIR, "config.json")})`,
    );
  }
  return url;
}
```

`resolveNamedEnv` throws a `CLIError` so the top-level handler in `index.ts`
prints the message and exits with the right code. Example:

```
Error: unknown environment 'stg'. Known: dev, local, prod
  (define under "environments" in /Users/you/.config/kl/config.json)
```

### Threading the flag to call sites

`resolveApiUrl` is called at 7 sites (deploy, deploy-key ×3, logout, login,
whoami, projects). Each reads the global option via commander's
`optsWithGlobals()` (or `program.opts().env`) and passes it explicitly:
`resolveApiUrl(cwd, envName)`. Explicit argument over a hidden `process.env`
mutation.

### Credentials — no new concept

Credentials are already keyed by API URL (`auth.ts:38`, `store[apiUrl]`). So
`kl -e dev login` stores dev's tokens under dev's URL, and every later
`kl -e dev …` transparently loads them. The feature adds *only* URL resolution;
auth follows for free. Workflow: log into each env once, then `-e dev` reuses
it.

## Testing (TDD, red first)

New cases in `tests/lib/config.test.ts`:

- `-e dev` resolves to its configured URL.
- `-e prod` / `-e local` resolve from built-ins with **no** config file present.
- User `environments` entry **overrides** a built-in of the same name.
- `-e` **beats** `KL_API_URL`, project `kl.json`, and global `api_url`
  (precedence).
- Unknown `-e stg` throws `CLIError` whose message lists the known envs
  (including built-ins) and the config path.
- No `-e` → existing resolution chain behaves exactly as before (regression
  guard).

Plus one command-level test that the global `--env` flag reaches resolution
(e.g. via `whoami` or `projects`, mocking the service).

## Rollout

1. Implement per the plan (TDD).
2. `npm run check` green.
3. Populate the author's `~/.config/kl/config.json` with the `dev` environment
   (`local` and `prod` are built-in). This is an operator step, not code.

## Affected files

- `src/lib/config.ts` — `environments` on `GlobalConfig`, `BUILTIN_ENVIRONMENTS`,
  `resolveNamedEnv`, `resolveApiUrl` signature.
- `src/index.ts` — register global `-e/--env` option.
- `src/commands/*.ts` — pass resolved `envName` into `resolveApiUrl` (7 sites).
- `tests/lib/config.test.ts` — resolution/precedence/error tests.
- One command test file — flag-reaches-resolution test.
