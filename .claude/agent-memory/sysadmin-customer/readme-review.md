# README Review Notes (2026-03-19)

## Undocumented Features Found in Codebase
- **HyperShift/Hosted Control Plane detection** (8 files, clusterStore, adapted checks)
- **Cluster Snapshot comparison** (snapshot.ts: capture, diff, localStorage, topology tracking)
- **Cluster Timeline** (TimelineView.tsx: event timeline with time range + type filters)
- **Pod Terminal** (PodTerminal.tsx: WebSocket exec, command history, node debug)
- **Deployment Rollback** (RollbackPanel.tsx: revision history, diff, rollback with confirm)
- **Production Readiness Score** (ProductionReadiness.tsx: 31 checks, HyperShift-aware)
- **Dock panel** (Dock.tsx: resizable bottom panel for terminal/logs)
- **CreateView** (5 tabs: Quick Deploy, Templates, Helm, Import YAML, Installed)
- **Morning Report / Daily Briefing** (ReportTab: 4-zone risk score ring)
- **Multi-container/Multi-pod logs** (LogsView with selector-based workload logs)
- **Workload-level logs** (deployment/workload-level log aggregation)
- **DryRunPanel** (server-side dry-run before apply)
- **Cmd+B resource browser, Cmd+J dock toggle** (only Cmd+K documented)

## README Gaps
- No prerequisites section (OCP version, Node.js version, oc CLI version)
- No architecture diagram (only text tree)
- No upgrade/migration guide
- No changelog or release notes link
- No API reference or extension points
- No performance/browser requirements
- No accessibility statement
- Security model is strong but missing threat model context
- No comparison to OpenShift Console (what it replaces vs complements)
- Screenshots exist but no GIF/video demo
