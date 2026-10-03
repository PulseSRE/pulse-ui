# Contributing

## Setup and checks

Use Node.js 24+ and pnpm 10.33.0 from `package.json`. Follow [README](README.md#local-development) for local proxy setup. Run `pnpm install --frozen-lockfile`, then `pnpm verify` before proposing a change. Verify includes type-check, lint, unit/component tests, and production build; Playwright and deployment acceptance are separate.

- `pnpm type-check`: TypeScript strict mode; test files are excluded by `tsconfig.json`.
- `pnpm lint`: ESLint; `pnpm lint:fix` applies fixes.
- `pnpm format`: Prettier settings from `.prettierrc` (single quotes, semicolons, trailing commas, 100-column target).
- `pnpm test`: Vitest once; `pnpm test:watch` for development.

## Conventions

Use shared types from `engine/types`, Zustand for client state, TanStack Query for endpoint data, `cn()` for class names, and existing primitives/icons. Update relevant API and security documentation when changing those contracts. No production mock-data fallback: render empty/error states when APIs are unavailable.

Preserve cluster and user identity in cache keys, watches, and mutation targets. Treat browser trust controls as preferences, not an authorization boundary. Echo the confirmation nonce from the backend. Review [API_CONTRACT.md](API_CONTRACT.md) and [SECURITY.md](SECURITY.md) for these boundaries.

Feature flags were removed; do not import the deleted `engine/featureFlags.ts`. Version comes from `package.json`; tools and scanners should come from backend capabilities instead of hardcoded counts.

## Tests

Add focused regressions for behavior changes, particularly failure paths and mutations. Mocked tests cannot replace OAuth/RBAC, watch protocol, or cross-cluster acceptance on a disposable test cluster. See `e2e/playwright.config.ts` for container/mock setup; avoid running mutation specs against production.

## Git hooks and CI

`bash scripts/install-hooks.sh` installs an optional pre-commit hook that runs type-check and tests. It does not install Python checks, pre-push hooks, or post-write hooks. Use `pnpm verify` even when hooks are not installed.

GitHub Actions in `.github/workflows/ci.yml` run lint/type checks, coverage/unit tests, build, and Playwright for pushes/PRs to main. Image publishing is a separate tag/manual workflow. Passing local checks does not prove remote CI passed; report the actual run status.

Backend development belongs in [pulse-agent](https://github.com/PulseSRE/pulse-agent); consult its own contributing/configuration docs. The UI does not implement a SQLite storage backend or install Pulse via Helm.
