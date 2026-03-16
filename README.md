# kl — King's Landing CLI

Deploy static sites to [King's Landing](https://kingslanding.io) from any terminal or CI/CD pipeline.

## Install

```bash
npm install -g @kingslanding/cli
```

Or run without installing:

```bash
npx @kingslanding/cli deploy ./dist
```

Or with Docker (no Node.js required):

```bash
docker run --rm -v $(pwd):/app -w /app ghcr.io/boxshopio/kl deploy ./dist
```

**Requirements:** Node.js >= 18 (npm install), or Docker.

## Quick start

```bash
# Authenticate
kl login

# Initialize a project config
kl init

# Deploy
kl deploy ./dist
```

## Commands

| Command | Description |
|---------|-------------|
| `kl login` | Authenticate via browser |
| `kl logout` | Clear credentials |
| `kl init` | Create `kl.json` project config |
| `kl deploy [dir]` | Deploy a directory (default: `.`) |
| `kl projects` | List your projects |
| `kl whoami` | Show current user |
| `kl deploy-key create` | Generate a deploy key for CI/CD |
| `kl deploy-key status` | Check if a deploy key exists |
| `kl deploy-key revoke` | Revoke a deploy key |

## Deploy

```bash
# Deploy current directory
kl deploy

# Deploy a specific directory
kl deploy ./dist

# Deploy with a project name (skips kl.json)
kl deploy ./dist --project my-site

# Auto-create project if it doesn't exist (for CI)
kl deploy ./dist --project my-site --create

# Detailed output
kl deploy ./dist --verbose
```

## Project config

Run `kl init` to create a `kl.json` in your project root:

```json
{
  "project": "my-site",
  "directory": "dist",
  "team": null
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `project` | Project name on King's Landing | *required* |
| `directory` | Directory to deploy | `.` |
| `team` | Team slug (for team-owned projects) | `null` |

## CI/CD

### GitHub Actions

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @kingslanding/cli deploy ./dist --project my-site --create
        env:
          KL_DEPLOY_KEY: ${{ secrets.KL_DEPLOY_KEY }}
```

### Generate a deploy key

```bash
kl deploy-key create --project my-site
```

The key is shown once. Add it as `KL_DEPLOY_KEY` in your CI secrets.

### Any CI provider

The CLI detects `KL_DEPLOY_KEY` automatically. No `kl login` needed.

```bash
export KL_DEPLOY_KEY=kl_your_key_here
npx @kingslanding/cli deploy ./dist --project my-site --create
```

## File filtering

Create a `.klignore` file (gitignore syntax) to control which files are deployed:

```
node_modules
.git
.env*
.DS_Store
```

If no `.klignore` exists, these defaults apply automatically.

## Docker usage

For environments without Node.js:

```bash
# Deploy
docker run --rm -v $(pwd):/app -w /app ghcr.io/boxshopio/kl deploy ./dist --project my-site --create

# With deploy key
docker run --rm -e KL_DEPLOY_KEY=$KL_DEPLOY_KEY -v $(pwd):/app -w /app ghcr.io/boxshopio/kl deploy ./dist

# Shell alias for convenience
alias kl='docker run --rm -e KL_DEPLOY_KEY -v $(pwd):/app -w /app ghcr.io/boxshopio/kl'
kl deploy ./dist
```

## License

Proprietary. See [kingslanding.io](https://kingslanding.io) for terms.
