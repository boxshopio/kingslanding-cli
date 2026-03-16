# CLAUDE.md — kingslanding-cli

## Overview

TypeScript CLI (`kl`) for deploying static sites to King's Landing. Published as `@kingslanding/cli` on npm.

## Commands

```bash
npm run check          # lint + typecheck + test
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm run test:watch     # vitest (watch mode)
npm run build          # tsc -> dist/
```

## Architecture

Commands -> Services -> Lib. See `docs/superpowers/specs/2026-03-15-deployment-cli-design.md` in the kingslanding repo for the full design spec.

## Testing

Vitest. TDD (red/green/refactor). Mock fetch at the API level for service tests, mock services for command tests.
