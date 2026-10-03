# UI release acceptance

Run `pnpm install --frozen-lockfile`, then `pnpm run test:acceptance` with Node 24 and the package-pinned pnpm version. CI runs the same command in the **UI Release Acceptance (isolated)** job and uploads `test-results/ui-acceptance.xml`. A failure or missing tests fails the command.

This lane uses React Testing Library, real UI components/stores/request helpers, and controlled HTTP/WebSocket responses in jsdom. It starts no UI server, Pulse agent, database, container, or Kubernetes cluster. Do not use the default Playwright runner as a substitute: its default configuration starts a local stack.

| Release invariant | Executed evidence |
| --- | --- |
| Incident recovery is tied to its action and evidence | Real lifecycle hook/drawer: wrong-action verdict, recurrence, missing evidence, rolled-back/proposed actions and exact incident postmortem |
| Same-name A/B resources cannot share displayed state or pending dialogs | App query-provider transition integration test |
| Old callbacks retain their original target | Actual table scale callback invoked after unmount and A→B switch |
| Watches change target and ignore stale events | Actual list/watch hook, A unsubscribe, B request and late A modified event |
| Retained terminal/GitOps contexts cannot move across clusters | Store integration tests for tagged contexts, stale Argo results, unknown target |
| Denied deletion does not first stop a workload or remove its cached row | Real table bulk delete, real request helper, HTTP 403; asserts DELETE only, UID precondition, unchanged replicas/production-shaped cache, retained failed selection and error progress |
| Observe cannot approve | Real confirmation card plus real persisted trust policy; button and keyboard checks |
| Bounded requests without verified categories require approval | Real confirmation card/trust policy; no callback until explicit click |
| Initial failed socket handshakes retry with a bound | Real AgentClient and controlled sockets/timers; five retries and stop |
| Explicit disconnect prevents retry or stale errors | AgentClient tests including delayed version failure |
| Pause uses server state and reports denied changes | Real TrustPolicy UI, authoritative paused prop, resume request/refetch, failed pause alert |

## Real-cluster release gate

Passing this isolated lane proves UI behavior under controlled responses. It does not prove Kubernetes RBAC, actual network recovery, server approval nonce enforcement, or monitor pause persistence. Before accepting a release against a cluster, use an authorized disposable namespace and test:

1. Create distinguishable same-name workloads in clusters A and B. Switch clusters during reads and with an open action dialog. Verify reads, scale, YAML, logs and terminal reach only their displayed target, including delayed responses.
2. Give a caller patch permission but deny delete. Attempt deletion; verify the workload's replicas/resource version remain unchanged and the UI reports failure.
3. Exercise Observe and Bounded approvals with the deployed agent, including denied permissions, nonce replay and expired requests. Verify the backend audit and actual workload state.
4. Interrupt the agent connection before its first successful handshake, recover it, and explicitly disconnect. Verify retry/recovery and absence of reconnect after explicit disconnect.
5. Pause the monitor, reload and open a second browser; verify both show the server pause state. Resume as an authorized administrator; verify denied callers receive visible errors and cannot change the state.

Record UI/agent/operator image digests, caller permissions, cluster identities, commands, observed changes and audit records with the release. These cluster steps require separate authorized infrastructure and are not automatically executed by the isolated job.
