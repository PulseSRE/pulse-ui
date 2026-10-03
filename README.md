# OpenShift Pulse UI

A React and TypeScript dashboard for OpenShift operations: resource browsing and editing, cluster health, logs and terminals, monitoring, and integration with the [Pulse Agent](https://github.com/PulseSRE/pulse-agent).

## Install

Use the [Pulse Operator installation guide](https://github.com/PulseSRE/pulse-operator#install-via-olm) to deploy the UI, agent, PostgreSQL, OAuth proxy, and supporting resources from an `OpenShiftPulse` custom resource. This repository builds the UI container consumed by `spec.ui.image`; it does not contain a Helm chart for installing Pulse.

The static UI does not require its own database. Agent features require a reachable agent and its PostgreSQL database; they are unavailable when only the UI is running.

## Local development

Requirements: Node.js 24 or later, pnpm 10.33.0 (the version in `package.json`), and `oc` authenticated to a target OpenShift cluster for live API data. Local development uses your CLI credentials; the production operator supplies OAuth authentication.

```bash
pnpm install --frozen-lockfile
oc login https://api.your-cluster:6443
oc proxy --port=8001
```

In another terminal:

```bash
pnpm dev                  # http://localhost:9000
```

`rspack.config.ts` reads environment variables from the process. Copying `.env.example` to `.env` does not load it automatically. Export the required variables before starting the server:

```bash
export K8S_API_URL=http://localhost:8001
export PULSE_AGENT_URL=http://localhost:8080
# Set PULSE_AGENT_WS_TOKEN to match the agent through your local secret mechanism.
# Set PULSE_USER_TOKEN to a real user token for admin-gated agent operations.
pnpm dev
```

Do not expose the development server or `oc proxy` to untrusted users. Its proxy credentials are the developer's credentials. Never commit tokens or include them in screenshots/logs.

| Variable | Default | Purpose |
|---|---|---|
| `K8S_API_URL` | `http://localhost:8001` | Kubernetes HTTP/WebSocket proxy target |
| `THANOS_URL` | disabled | Thanos/Prometheus proxy target |
| `ALERTMANAGER_URL` | disabled | Alertmanager proxy target |
| `CONSOLE_URL` | CLI-discovered when possible | OpenShift Console target for Helm integration |
| `OC_TOKEN` | `oc whoami -t` when available | Development proxy credential |
| `PULSE_AGENT_URL` | `http://localhost:8080` | Agent proxy target |
| `PULSE_AGENT_WS_TOKEN` | unset | Shared backend credential injected by dev proxy |
| `PULSE_USER_TOKEN` | test placeholder when shared agent token is set | Caller identity forwarded to agent; use a real token against a real agent |

## Checks

```bash
pnpm type-check
pnpm lint                 # does not rewrite files
pnpm lint:fix             # explicitly apply ESLint fixes
pnpm test                 # unit/component tests once
pnpm test:coverage
pnpm build
pnpm verify               # types + lint + tests + build
```

Test counts and timings vary with the revision and machine; use the current command output. Type-check excludes test files as configured in `tsconfig.json`.

`pnpm e2e` runs Playwright. Without `PULSE_URL`, its config starts a mock Kubernetes API, a real agent/PostgreSQL container stack, and the UI dev server. Install Chromium with `pnpm exec playwright install chromium`; a working container runtime and an agent checkout are required by `e2e/start-agent.sh`. With `PULSE_URL`, tests target an existing deployment instead. These tests can perform mutations: use a dedicated test environment and review the selected specs. Passing mock tests does not establish real cluster readiness.

## Product surfaces

- **Pulse / Workloads / Compute / Storage / Networking:** health summaries, generic Kubernetes resource tables/details, deployment revision rollback, YAML editing and server dry-run validation.
- **Inbox:** findings and episodes, task lifecycle, review proposals, and chronological activity.
- **Agent:** Mission Control with trust preferences, reported effective server policy, scanner coverage, quality results, and learning information.
- **Toolbox:** backend-discovered tools, skills, connections, components, usage, and analytics.
- **GitOps:** ArgoCD integration and Git provider workflows, when those integrations are configured.
- **Fleet:** ACM discovery and cross-cluster views. Cluster identity must be preserved through data and action flows; verify live cluster switching before production use.
- **Identity / Admin / Readiness:** user/RBAC views, cluster administration, and readiness checks. Readiness scores are a guide, not a certification.
- **Custom views:** agent-generated dashboards persisted by the agent, with version/share controls.

Available tools, scanners, component kinds, and operator catalog entries depend on the backend and cluster. Read capability endpoints and current source rather than relying on release-era counts.

## Trust and action boundaries

Browser trust is persisted per hostname in `trustStore`. Direct UI mutation controls, interactive chat confirmation, and background autonomous monitoring have different enforcement paths. The backend's reported effective trust can differ from the browser selection. Current category controls do not establish a server-side allowlist, and Bounded chat requires approval when the backend supplies no verified category; do not interpret a browser category selection as authorization enforcement. Review [Security](SECURITY.md) and [API integration](API_CONTRACT.md), and validate policy on a test cluster.

## Architecture

```text
src/kubeview/
  engine/       API helpers, discovery, watches, agent clients, component registry
  engine/types/ Kubernetes and incident types
  hooks/        TanStack Query, list/watch, capability and RBAC hooks
  store/        Zustand UI, fleet, agent, monitor, trust, inbox and view state
  components/   Resource UI, logs, metrics, YAML, agent renderers, feedback
  views/        Domain pages and generic resource CRUD pages
  routes/       Domain/resource routes and legacy redirects
```

Production request path: browser → OAuth proxy → operator-generated nginx proxy → Kubernetes/monitoring APIs or agent. The operator owns nginx configuration, OAuth settings, RBAC, images, and rollout behavior. `Dockerfile` packages already-built `dist/`; it does not build TypeScript itself.

The UI uses React 19, TypeScript 5, Rspack 2, Tailwind 4, Zustand, TanStack Query, Vitest, and Playwright. Exact versions are in `package.json` and `pnpm-lock.yaml`.

## Image development

Use an immutable tag/digest and update the operator CR to test a rebuilt UI image. Review the operator's image and rollout documentation; this repository's older S2I/manual deployment instructions are not the supported install path.

```bash
pnpm build
podman build --platform linux/amd64 -t "$PULSE_UI_IMAGE" .
podman push "$PULSE_UI_IMAGE"
# Then update spec.ui.image on the target OpenShiftPulse CR.
```

## Screenshots and project links

Screenshots in [docs/screenshots](docs/screenshots) capture earlier UI revisions and may differ from the current routes and data. [docs/index.html](docs/index.html) is the project landing page.

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [API integration](API_CONTRACT.md)
- [Changelog](CHANGELOG.md)
- [Operator](https://github.com/PulseSRE/pulse-operator)
- [Agent](https://github.com/PulseSRE/pulse-agent)

MIT license; see [LICENSE](LICENSE).
