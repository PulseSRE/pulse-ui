# Changelog

Release entries are historical records. Counts, timings, security scans, and feature claims describe their release context; consult current source/check output for present behavior.

## Unreleased

### Upgrade notes
- **Helm previews need a helm-runner image with `awk` and `sha256sum`.** The preview hides Secret values with them before anything reaches the pod log. Release builds of the runner image include both and are checked for them (see CI below). Clusters keep the runner image they were configured with until it is replaced by such a build: pin it with the operator's `spec.ui.helmRunnerImage` (or `RELATED_IMAGE_HELM_RUNNER`), available from pulse-operator v0.14.0. Until then, Preview reports "The Helm runner image is too old for previews; update Pulse" and offers installing or upgrading without a preview. Nothing is rendered unredacted.

### CI
- **Release builds the Helm runner image.** `build-push.yml` builds `Dockerfile.helm-runner` on `v*` tags and manual runs and checks it before the registry login: `helm`, `awk` and `sha256sum` must each be present, awk and sha256sum must give the expected output on a fixed input, and `helm version` must run, so a failed check publishes no image at all. It then pushes `quay.io/amobrem/openshiftpulse-helm-runner:<tag>` and `:latest` (linux/amd64) after the UI and render images, recording the digest in the run summary. `Dockerfile.helm-runner` installs `gawk` and `coreutils-single` (the preview from #192 needs them). The image tag (manual input or git tag) is passed through env and must match `^[A-Za-z0-9._-]{1,128}$`, and the job's token is read-only. The UI accepts the runner only digest-pinned; clusters run a new build once it is pinned with the operator's `spec.ui.helmRunnerImage` / `RELATED_IMAGE_HELM_RUNNER`, available from pulse-operator v0.14.0. New `.github/CODEOWNERS` assigns `/.github/workflows/` to `@alimobrem`; it is enforced only when code owner review is required on main.

### Fixed
- **Inbox episode card at phone width.** Below `sm` the episode card's actions (Ask Pulse to fix, What else changed, Dismiss) move under the title instead of squeezing it, so "Cause" no longer sits under "Ask Pulse to fix"; the cause title truncates with its full text on hover. Desktop is unchanged.
- **Readable muted text and one status palette (consistency 8/12).** Muted text used `text-slate-500/600/700`, which is 1.9–3.7:1 on the dark surfaces; it now uses two tokens, `text-muted` (#94a3b8) and `text-faint` (#8693a9), both at least 4.5:1 (WCAG AA) on slate-950, slate-900 and slate-800. Icons, separator glyphs and disabled controls keep their shade. Warning is amber everywhere: Inbox severity, deployment and pod summaries, certificates, quotas and the rest no longer use yellow. The Inbox, the node hex map, the topology pod grid and graph, the scanner drawer, Argo Rollouts and the agent's blast radius take their colours from `engine/statusColors`. Pods everywhere (Pods list, node map, pod grid) use one `podPhaseTone()`: Pending is amber (warning), ContainerCreating/PodInitializing blue (progress), crash/pull/config errors red; on the node map and pod grid Succeeded is neutral so completed pods stand apart from Running (it was blue on the node map and indigo in the grid). New lint rules `pulse/no-yellow` and `pulse/no-low-contrast-text` keep it that way; `scripts/codemods/text-tokens.mjs` fixes what they report.
- **The shell works at phone width (consistency 11/12).** Below 640px the command bar keeps the logo, search and Create and folds Ask Pulse, cluster, namespace, Pulse health, Inbox and the user menu into a "More" panel (aria-expanded; arrow keys, Home/End, Escape back to the trigger; it closes on navigation, an outside click or focus leaving), and the trigger names the Inbox count. The 48px AI rail is gone on phones; Pulse AI opens as a bottom sheet (modal, focus trapped, Escape, backdrop and a visible Close, safe-area padding) and no longer pops open by itself there. The status bar stays on one line at any width, truncating instead of wrapping. The resource detail header wraps its actions and truncates a long name (full name on hover). Resource lists show Name, Status (or Ready) and Age on phones, the rest one click away in the column picker; the actions column stops being sticky there and the table scrolls inside itself, never the page. New `max-w-content` token (72rem) for the domain pages' content width. Desktop layout is unchanged.
- **One date format, labelled forms, Inbox presets in the Inbox tab, and `/agent` opens on Overview (consistency 12/12).** The 83 raw `toLocale*String()` calls (dates, times and counts) go through `engine/format`: an absolute time is one format ("Oct 30, 2026, 2:05:09 PM", fixed en-US locale, the browser's time zone), counts are grouped the same in every browser language (`formatCount`), chart axes and near times use `formatClock` ("2:05 PM"), and a new `RelativeTime` shows "5m ago" with the full timestamp on hover. Pod "Last exit" no longer shows a bare clock time for an exit days ago; the container's last termination, condition, event, silence, snapshot and Helm revision times include the date. The deprecated `engine/formatters` and `engine/dateUtils` shims and `formatting`'s `formatBytes` re-export are removed. `FormField` already tied its label to its input with `useId` (now covered by a test); `SearchInput` takes a required `label`, and about 95 inputs, selects and textareas that were named only by a placeholder or an unlinked `<label>` now have an accessible name (searches, the silence form, chart editors, Argo CD and plan wizards, SLO and MCP dialogs, the terminal, chat boxes). The Inbox quick filters (Needs Attention, Agent Cleared, …) moved from above the tab list into the Inbox tab, which is the only one they filter. A bare `/agent` link opens Overview for everyone; the tab last used in the session is offered as a "Resume <tab>" chip instead of being reopened silently.
- **The namespace scope is in the URL (consistency 10/12).** `useNamespaceScope()` reads and writes `?ns=`, and the command-bar picker writes it. Reloading, sharing a link and Back/Forward all restore the scope: each history entry a scoped page settles on is recorded with its cluster and namespace. A page opened without `?ns=` inherits the current scope and writes it into its URL. Topology and Create read `?ns=` like every other page; their old `?namespace=` links still work and are rewritten to `?ns=`. Security, Compute, Admin, GitOps, the Inbox and Approvals tabs, and cluster-scoped lists show every namespace: there the picker reads "All namespaces on this page" (focusable, `aria-disabled`, with a description saying the choice is kept) instead of being silently ignored. A scope never crosses clusters. It is resolved during render, so no render after a switch shows the old cluster's namespace, and Create's YAML and Helm forms never prefill it. A switch drops `?ns=` from the URL and from every shell tab. Back to an entry from another cluster, or a reload onto the local cluster, ignores that entry's `?ns=`. A saved scope from another cluster is dropped on load. Topology fetches the whole cluster once (its query keys include the cluster) and, unscoped with more than 300 nodes, asks for a namespace instead of drawing them all. Changing the scope in place retitles the current shell tab; a link to another namespace's list still opens its own tab.
- **Resource subpages have a header, and there is one not-found page (consistency 6/12).** Logs, Metrics, YAML, Create and Node logs had no `<h1>`, and "back" worked four ways (`go()` with no name, `navigate()` with no accessible name, `history.back()`, or nothing on Logs). `SubpageHeader`, built on `PageHeader`, gives each one `<h1>`, a breadcrumb (domain › kinds › name › subpage) and a back link named for its destination ("Back to pod web-1"). Crumbs and back are real links: a plain click opens the page in the app, and a modified or middle click is left to the browser. When more than one cluster is connected, the header names the cluster. One `NotFound` says what was not found and where Pulse looked (which cluster and namespace, or which store), and offers real ways out. CustomView, ClaimView, Topology's "focused resource is not in the graph" state, and a 404 on the YAML editor or pod logs all use it. `ReadFailure` shows `NotFound` only for a 404 or 410. A 403, a 5xx or a network error stays `LoadError` with Retry. A share-link claim now rejects with the server's status, so an expired link (410) and a server outage are no longer both "invalid or has expired".
- **One "Ask Pulse" entry point; violet means Pulse AI (consistency PR 9).** Eight labels for asking the AI ("Ask AI", "Analyze with AI", "Investigate with AI", "Investigate with Pulse", "Fix with AI", "Ask the Agent", "Ask the Security Agent", "Ask Agent"/"Deep Dive"/"Ask in chat"/"How do I fix this?") are now one `AskPulseButton`: label "Ask Pulse", with a suffix only where the action differs ("why", "to fix", "to investigate", "about this …"), the AI icon and one violet style. It passes the resource and namespace as context, and on a remote cluster it is disabled with "Pulse AI answers about the local cluster only." (the agent dock and the update panel now use the same sentence). Prompt chips on the detail page, Security and the Pulse report (built from the active cluster's failing pods, which used to reach the local agent from a remote cluster) use the same heading and gate; entries built only from local or agent data (Inbox items and steps, episodes, the fleet analysis) keep working with a remote cluster selected. The assistant is "Pulse AI" in the palette, onboarding and answers. Violet no longer marks non-AI selection: Identity's selected stat card and tab, the Memory tabs, the trust-level picker, outcome filters, the view time range, the Inbox presets and "new" badge, the Readiness wizard and toggles, GitOps buttons and provider choice, filter chips and focus rings are blue; neutral chips are slate, and kind/category colours that were purple are indigo. A guard test fails when a violet class appears outside the AI surfaces or an old label comes back.
- **The last one-off error and empty states, and a bulk delete that lists what it deletes (consistency 7/12).** Inbox, Topology (graph and Downstream), Argo AppProjects, the admin Overview banner, Cluster Config sections, the namespace picker and the Pulse Agent auto-fix switch now show "Checking…" while reading, `LoadError` with the reason and Retry when a read fails (403 says permission denied), and an empty state only after a successful empty read: a failed inbox read no longer sits next to "All clear", the namespace picker no longer says "0 total", a Cluster Config resource missing on the cluster (404) is said plainly instead of a blank panel, and the kill switch is no longer a red button while its state is unknown. Alertmanager reads (silences, the readiness receiver gate) go through one helper that rejects non-JSON answers and raises the session prompt on 401; the gate says "Could not check: <reason>" instead of "Alertmanager not reachable". Silence saves and expiry use the shared writers (a 403 names the role needed). On Pulse, API latency and etcd leader changes show "Could not check" (reason on hover) on a failed read instead of a green "—" or "N/A", "No data" on an empty one, and a failed volume-usage read is flagged instead of hiding full volumes; Compute's etcd leader cell does the same. Bulk delete on resource lists confirms the exact list it will delete; rows selected before a search hid them are named ("N selected rows are hidden by your search") and deleted only if "Also delete the N hidden rows" is ticked.
- **Resource lists line up and are a real table (consistency PR 4).** On every `/r/*` list, the header was an auto-layout `<table>` over flex rows, so a value could sit under the wrong header (on Pods, the status sat under READY). The header, the filter row and the virtualized rows now share one CSS grid template, with `role="table"`/`rowgroup`/`row`/`columnheader`/`cell`. Fixed widths stay fixed, but never narrower than the header. Name grows from a 200px floor, and a narrow window scrolls the table instead of squeezing it. Sortable headers are buttons, and the sorted column carries `aria-sort`. Row checkboxes are labelled "Select <name>" and the header checkbox "Select all" (it shows mixed when part of the page is selected). The search, the column filters and the page size are labelled. j/k move focus to the row, and Enter or Space on a focused button or link is left to that control. The e2e mock K8s API now returns the object (or a 404 Status) for single-object GETs and filters namespaced lists, so detail pages render in e2e. A new smoke spec checks pixel alignment on Pods and renders the Pod and Deployment pages.
- **Page tabs follow the URL; one shell tab per page, at most 12 (consistency 1/12).** Workloads, Compute, Alerts, Identity and GitOps keep their tab in `?tab=` through the router (`useTabParam`), so a link to another tab of the same page, Back/Forward and deep links switch the tab, and an unknown `?tab=` opens the default and is removed from the URL. Alerts' severity and group-by filters, Timeline's range and categories, and resource lists' search, sort and page are written through the router too, so a tab click no longer drops them. The shell keeps one tab per page: `/workloads?tab=builds` reuses the Workloads tab, which returns to the page's last URL and takes its title from it. A list opened for a namespace (`?ns=`) and a workload's logs per kind (`?kind=`) are separate tabs. Opening a 13th unpinned tab closes the least recently used one (never the active or a pinned tab). In the command palette an exact page name ranks first, so "Builds" opens Builds, not Workloads.
- **One page header on every domain page (consistency 5/12).** `SectionHeader` is renamed `PageHeader` and gains an optional status/meta line, breadcrumbs and a named back button ("Back to …") that are real links (a plain click navigates in the app; Ctrl/Cmd/middle click opens a new tab); title and actions wrap instead of overflowing on a phone. Workloads, Networking, Compute, Storage, Security, Identity & Access and its subject pages, Administration, Alerts, GitOps, all six Fleet pages, Inbox, Readiness, About, Views, Pulse Agent, Service Levels, Topology, the Operator Catalog and an operator's page, Project, Timeline, Software and Cluster Pulse each have exactly one `<h1>` at the same size, with their actions on the right. Pulse, Pulse Agent, About and Inbox no longer use a smaller title; Inbox has an icon and subtitle. Builds, shown inside Workloads, is a section heading, no longer a second `<h1>`. Loading, empty and not-available states keep the header too: Fleet Workloads (loading, no clusters), Fleet Compliance, Fleet resource and Fleet Alerts with no clusters (with the fleet sub-nav), Alerts on a remote cluster, GitOps while detecting Argo CD, and Topology's load error. The SLO page no longer repeats its subtitle, and "Add SLO" is a header action. Logs, Metrics, YAML, Create and Node logs follow in 6/12.
- **A failed Prometheus read says so, in plain words (consistency 2).** `promFetch`/`promJson` and the query helpers throw a typed `PrometheusReadError` for a non-2xx status (keeping Prometheus's own `error`; `errorType: timeout` is a timeout), an HTML page ("Prometheus returned an HTML page (status 502) — the metrics backend may be down or behind a login"), 403, 401, a timeout (30s, including reading the body) and a network failure, instead of handing `res.json()` an HTML page; React Query's signal is passed through. `safeQuery` no longer turns a Prometheus 404 into empty data (Compute node usage, capacity cards, etcd leader, Pulse report). Workloads, Networking, Compute, Storage, Project, Pulse, Admin control plane and incident context show one "Metrics could not be read — cards below are unknown" banner with the reason and Retry, and their cards a quiet "—"; widgets show "Checking…" while reading and "No data for this period" only after a successful empty query, and a failed refresh no longer leaves the last value on screen. Clickable metric cards hold no controls and open with the keyboard. Metrics, Project and Pod memory charts use the same wording. The Admin and alert-feed readers parse through `promJson` and clear "Monitoring unavailable" only after a good parse. `LoadError` maps known errors (an HTML page parsed as JSON, 401/404/5xx, network, timeout, cancel) to a sentence with the raw text behind "Details", and keeps the server's text on a 403. About no longer shows "undefined skills" when the agent omits a count.

### Added
- **One write-confirm for every approval (consistency 3/12).** Approving an agent write now opens the same `WriteConfirmDialog` everywhere: Inbox › Approve (was one click with no dialog), a durable run's waiting phase (was `window.confirm`), the plan-run panel (was 10px buttons with no confirm and no observe-mode check), and agent-authored write buttons on views (was a plain confirm with no parameters, cluster or observe-mode gate). It says what will change (an exact diff, or the tool and its parameters), where and as whom ("namespace · cluster · acting as Pulse's service account" for agent approvals, "with your own credentials" or the impersonated user for direct writes), the dry run or "No dry run available for this action", impact and undo. Observe mode disables Approve in the dialog and says why; the cluster active when it opened is pinned, and a refused approval (403/409) is shown with the agent's words. Denying a durable phase asks with an in-app dialog. The pod/deployment guided-fix confirm is now built on it. The chat confirmation card shows the same where/what/impact/dry-run sections inline, and checks the person's permission for writes the agent runs with their forwarded token (scale, restart, delete pod, cordon/uncordon); it still echoes the backend nonce unchanged. A silence's preview is shown as its dry run, and the card's Y/N/Escape keys are ignored while another dialog has focus. The unused monitor-socket approve/reject path is removed.
- **Subject access pages, "Remove access" and "Who can" (Wave 16).** Users, groups and service accounts now open a page (`/identity/users/:name`, `/identity/groups/:name`, `/identity/serviceaccounts/:namespace/:name`) listing every binding that grants them access, directly or through a group, as subject → group → binding → role, and their effective permissions per namespace computed by impersonating them with a read-only SelfSubjectRulesReview (once as the user and once per group, combined; an incomplete review is "Could not check"; without impersonate permission it says so). "Remove access…" lists every RoleBinding, ClusterRoleBinding and Group membership plus the User, Identity and OAuth tokens; per binding you choose "remove this subject only" (a JSON patch that `test`s the exact subject at its index before removing it, so a concurrent change is refused) or "delete binding"; each object is permission-checked, everything is dry-run first, the cluster is pinned, results are per object, previous versions can be downloaded, a reason is required and each write is recorded in the agent's write ledger with the resourceVersion it produced (skipped, with a note, on an agent without the ledger), deletes of Users, Identities and tokens are conditional on their uid, removing your own last admin path (cluster-admin or any `*`/`*`/`*` ClusterRole, directly or through a group) needs a typed phrase, and deleting your own OAuth tokens warns that it signs you out and needs its own phrase. "Who can" on Access review lists every subject from OpenShift's ResourceAccessReview with the binding → role chain behind it (CSV export, ask in chat with the namespace attached); on a cluster that does not serve that API it says "not available" instead of guessing.
- **Identity & Access › Sign-in (Wave 16).** The identity provider editor moved here from Admin › Cluster Config, next to the IdP audit and the users it signs in; the old Cluster Config section shows the providers and links to Sign-in, and the IdP links from Security, Readiness, the Identity audit and Admin › Overview open it. Saves no longer merge-patch the whole provider list from cached data: every change carries the `resourceVersion` the editor read (a change made meanwhile is refused with 409), is confirmed with the provider list before and after (and the provider JSON when adding), and is dry-run first. The authentication operator's state (Available / Rolling out / Degraded) is shown. Removing a provider checks for lock-out first — no provider left, no kubeadmin login (metadata-only read; could-not-check counts as a risk), or the provider you signed in through — and then shows the risks in red and needs the provider name typed, plus "I have another way to sign in" when no provider and no kubeadmin would remain. Passwords over 72 bytes are refused (bcrypt would cut them) and the password field is cleared as soon as the confirmation opens; comment and malformed htpasswd lines are kept untouched. HTPasswd users no longer need the CLI: "Add or reset user" on an HTPasswd provider reads its Secret, hashes the password in the browser with bcrypt and writes only the hash (conditional on the Secret's version, other users unchanged), and a new HTPasswd provider can create its Secret with a first user. Hashing uses **bcryptjs** (new dependency: pure JavaScript, no native code), written as `$2y$` like `htpasswd -B`.
- **RBAC change history with "Restore previous" (Wave 16, Identity › Access review).** With pulse-agent#235 the RBAC changes panel lists edits, creations and deletions of Roles, ClusterRoles, bindings, SCCs and admission webhooks from the agent's observed history, each with a line diff against the version before it, the client that wrote it, and the signed-in user when the change was made through Pulse. "Restore previous…" reads the live object, shows the exact change (live → restored), requires a reason, dry-runs, then writes as you conditional on the live resourceVersion (or re-creates a deleted object without ownerReferences) and records the restore in the agent's write ledger; the button is disabled without update/create permission and a refused dry run (including RBAC escalation) changes nothing. A restore that would add wildcards, escalate/bind/impersonate, Secret reads or a cluster-admin binding lists exactly what it adds and needs the object name typed; the update path keeps the live ownerReferences and, for webhook configurations, the live `caBundle`. A change is attributed to a Pulse user only when the agent matched the write's resourceVersion (an identity the agent could not verify is labelled). The panel says "Not observed yet" or "Could not check" before ever saying "No changes observed". The panel says what the history cannot know (who made changes outside Pulse, edits between two observations, anything before the first one, kinds the agent cannot list, objects you cannot read). SCC and admission-webhook history needs pulse-operator v0.14.0, which grants the agent read access to those kinds (pulse-operator#128); with an older operator they show as unwatched. On an older agent it falls back to the creation-time list, now labelled "New bindings (by creation time)" with a note that edits are not shown; on a remote cluster it says the history is kept for the local cluster only.
- **Alerts triage and Pulse-proposed silences (Wave 12).** Needs pulse-agent with `POST /inbox/by-alert` and the silence tools (PulseSRE/pulse-agent#236); on an older agent the Triage chips are hidden with a sentence saying why and the chat confirm shows the tool input without a preview. Each firing row has a Triage chip that opens its Inbox item (the investigated item for the same resource first, then the episode cause, then the alert's own item; "Could not check · Retry" when the Inbox does not answer in 5 s). A namespace-only alert opens that namespace's unhealthy pods in place instead of the whole pod list. For a cordoned node with firing node alerts, "Pulse suggests a silence" opens a confirm dialog with the exact matchers (editable, the preview follows), what it hides and what stays visible, duration options covering the Inbox item's due time, owner, a required comment, who it is created as, and undo (expire, also offered in the toast). It writes through the same Alertmanager proxy and RBAC as the Silences form, is disabled without `monitoring-alertmanager-edit` (SelfSubjectAccessReview on `alertmanagers/api` "main" in openshift-monitoring), applies the agent's matcher rules (an exact match on `alertname`, a resource label or an application namespace; never Watchdog's label set or a firing Watchdog; at most 10, or 25% once it hides 3 or more, of the alerts firing now), refuses to create anything when the signed-in user cannot be confirmed (no typed creator), and keeps a 403/400 in the dialog. Undo from the toast asks before expiring. Triage lookups go in batches of at most 200, so one bad batch only marks its own rows. Tabs and filters use the router's search params, and the Firing tile's "N critical" / "N warning" open Firing filtered to that severity from any tab; an unreachable alerting backend is one "Could not reach the alerting backend: <reason>" message. The chat confirmation card for `create_silence`/`expire_silence` shows the agent's preview (matchers, end time, creator, what it hides) cannot approve one the agent says it will refuse, and is never auto-approved at any trust level.
- **Home › What needs attention, from the monitor (Wave 12).** One worst-first list of the monitor's open findings replaces Home's own failed-pod filter and the separate Pending pods and Top restarting pods cards: each row has the problem, its cause (the investigation's suspected cause, else the diagnosis engine's reading of the live object, else the scanner summary), the change just before it (GET /changes, local cluster only; "No change found in 24h", "Could not check", or "Not available on this agent"), confidence (investigated or scanner, or "Not investigated yet"), age, Inbox owner and one action (Review fix / Open in Inbox / Investigate). A firing alert about a resource that already has a row is folded into it ("Also in: alert …"); owners read "Checking…"/"Unknown" until the Inbox answers, and the owner filters wait for it; a change lookup names what it could not read, a truncated list, or a deleted resource. System namespaces are collapsed, noisy findings are hidden with a count and "Show them", blind or failed scanners are listed under "Could not check" with their fix, and "Pulse suggests starting with…" names the worst diagnosed problem. When the monitor is unreachable, or on a remote cluster, the list is computed in the browser (now including Job pods, OOM, not-ready pods, system namespaces and degraded operators) and labelled as such, and "All clear" and the Zen screen are only shown from the monitor's answer. Certificates under 7 days move into the Zone 1 certificate list. *Timeline:* the config lane adds the selected namespace's workload and ConfigMap changes with who made them (GET /changes), with a note when no namespace is selected, the cluster is remote or the agent is older.
- **Who started an update, and why (Wave 14).** The start-update confirmation lists the open readiness blockers with a required "I understand and want to update anyway", asks for a required reason, shows the worker pools' state, whether the update can be undone, and an estimate from the last completed updates; it sends a dry run first. The same merge patch that sets `spec.desiredUpdate` appends `{version, startedAt, by, reason}` to the `pulse.openshift.io/update-log` annotation on ClusterVersion `version` (last 50 kept). Update history is a paged table of every entry with "Started by" and "Reason" ("not recorded" for older ones). During an update, a stuck ClusterOperator opens its related namespaces, their pods and each pod's logs, and drain blockers name the pod that can't be evicted. Inbox items for a cluster update open Admin › Updates (from the item's `metadata.ui_link` when it is an in-app path, else from its generator), as does a ClusterVersion `version` resource.
- **Helm ownership, and delete with related objects (Wave 13 B).** Objects labelled `app.kubernetes.io/managed-by: Helm` with a `meta.helm.sh/release-name` annotation show a "Helm · <release> rev N" badge that opens the release. The YAML editor on such an object says which release owns it and that hand edits are overwritten on the next upgrade; it stays read-only with Save disabled until "Edit here anyway" (which warns about drift), and offers "Edit release values" and "Roll back the release…", which open the Helm releases list on that release with its dialog. A workload rollback (menu or rollout history) on a Helm-owned workload offers the release rollback first. Deleting a Deployment, StatefulSet or DaemonSet lists the Services selecting its pods, their Routes, its HPA, PDBs and NetworkPolicies, the ConfigMaps/Secrets its template reads and its PVCs, each with keep/delete: objects another workload or a ServiceAccount also uses, objects with an owner or a controller, and objects of another Helm release are kept with the reason; ConfigMaps/Secrets are read metadata-only and Secrets are never chosen by default; a StatefulSet's retention policy is honoured, PVCs are unchecked with the data lost and reclaim policy stated, and a kind that cannot be listed is "Could not check". The name must be typed; every chosen object is dry-run first, then the workload is deleted before the rest, with a result per object. A Helm-owned workload (checked against the release's manifest; a copied label is said, not obeyed) first points to the release uninstall. The table's row and bulk delete use the same dialog for these kinds (a bulk selection goes one workload at a time; Cancel stops it, with a summary at the end). No delete is sent without a uid precondition: an object whose list was forbidden has its uid read on its own first, or cannot be chosen.
- **ConfigMap and Secret "Used by" and "Restart consumers" (Wave 13 A).** ConfigMap and Secret pages list every Deployment, StatefulSet, DaemonSet, DeploymentConfig (when served), CronJob and Job in the namespace whose pod template reads the object, how (env keys, envFrom, volume or projected volume with its mount path, image pull secret directly or through its ServiceAccount, volume driver credentials such as CSI nodePublishSecretRef) and when running pods see a change: env/envFrom and subPath mounts only after a restart; a mounted file in about 60s, with "Could not check if the app reloads it"; CronJobs on the next run. Running pods started before the last edit are counted as on old values. A kind that cannot be listed is "Could not check", never "no consumers"; Secrets show names and key names only. "Restart consumers…" (also offered after a save from the data editor or the YAML editor) opens one confirmation with the exact patch (the `kubectl.kubernetes.io/restartedAt` annotation `oc rollout restart` writes), order (workloads behind a Service last), each workload's strategy and PodDisruptionBudget, the quota for surge pods and a dry run of every patch; it restarts one workload at a time, waits for each rollout, stops at the first failure, and shows progress with "Stop after current". OnDelete StatefulSets/DaemonSets, paused Deployments and workloads you cannot patch are named and left out; a quota or PDB the rollout can break needs an explicit acknowledgement; closing the dialog stops the run.
- **Pod and Deployment pages: the cause, a guided fix, and whether it held (Wave 11, part B).**
  - "Pulse found the cause" shows the open monitor finding for the pod, its owner or (on a Deployment) one of its pods. It includes the investigation's cause, evidence with sources, the alternatives it ruled out, confidence and times. A finding that has not been investigated is shown as "a problem", not a cause. Without a finding, Diagnose reuses an open inbox item for the resource (only an unclaimed one, or one that already has an investigation, shown with how long ago it was made) or creates one, then asks the agent to investigate. It shows queued and running and the report in the same card, or the agent's reason for refusing (budget, cooldown, concurrency), a failed investigation, no report after 10 minutes, or the agent being unreachable. A disconnected monitor is said, not shown as "nothing found".
  - "Proposed fix" renders `engine/diagnosis` (computed before but never shown on these pages). It turns the diagnosis into guided fixes that patch the owner (Deployment/StatefulSet/DaemonSet), or the ServiceAccount for a pull secret:
    - raise the memory limit (p95 + 25% or 1.5× the limit, rounded up; requests raised to p95), with namespace ResourceQuota headroom ("unknown" if quotas cannot be read);
    - raise the CPU limit when p95 is at the limit;
    - add or loosen a startupProbe only when liveness killed the container while it was starting (a run of a few liveness budgets at most), with the start budget capped at 10 minutes;
    - attach a registry secret on an unauthorized pull: to the ServiceAccount, or to the template when the template already lists imagePullSecrets (the ServiceAccount's are then not applied). Secrets are listed metadata-only, both dockerconfigjson and dockercfg;
    - roll back to the previous revision.
  - Review and apply re-reads the owner and builds the fix from it, then opens a confirm with the exact diff, a `dryRun=All` result (Apply stays disabled until it passes), impact (rolling restart, maxUnavailable/maxSurge, or downtime for Recreate), undo, and an optional note recorded as the change cause. It is RBAC-gated, pinned to the cluster it was opened on, and every patch tests the resourceVersion the page read. After applying, the rollout and the new pods' restarts are watched for 10 minutes on the owner's page (and the pod page until it is replaced); a watch can be dismissed, an OnDelete StatefulSet fix is not watched (its pods must be deleted), and a workload selected by matchExpressions ends "Unknown". The result is "Held", "Did not hold" (a restart, a stalled rollout, or not finished) or "Unknown" when the rollout could not be read. "Ask Pulse why" and "Other fixes" are beside it.
  - Right column: "What changed before this" from `GET /api/agent/changes` (local cluster only; the pod page asks about the Pod and the agent walks the owner chain):
    - an older agent (404), a resource that no longer exists, `available: false` and sources the user cannot read are muted notes;
    - 401 uses the session-expired prompt, and `truncated` says "showing the latest 500";
    - 400/403/5xx show LoadError.
  - Also in the right column: memory over 6h against the limit with the Deployment's revisions in that window, and "Log of the last crash" (the previous instance; none is said in words, 403/500 show LoadError).
- **Helm preview before apply (Wave 15).** Installing a chart, upgrading a release and editing its values now show the chart's default values.yaml (searchable, overridden lines marked) beside the overrides, with hints from values.schema.json when the chart has one; upgrades and value edits choose between resetting to the chart defaults plus overrides (--reset-values) and reusing the release's values (--reuse-values). "Preview" runs `helm template` with the digest-pinned runner image in its own Job, as the namespace's default ServiceAccount with no token and no Role or RoleBinding (rendering makes no API calls). The Job prints a Secret only through an allow-list (apiVersion, kind, metadata, type, immutable, and data/stringData with every value replaced by a salted hash). It withholds any document it cannot redact safely: a Secret inside a List, a nested kind that is tagged, folded or in a flow mapping, an unknown kind, any other or quoted top-level key, a flow collection that spans lines, or YAML anchors, aliases or merge keys. Pulse reads the redacted result from the Job's log, deletes the Job, then diffs it object by object against the release's current manifest and dry-runs every added or changed object (dryRun=All, as you) and checks each object and hook against the runner's Role: added / changed / removed / would fail / could not check, per-object manifest or diff, the hooks that will run and test hooks. Install stays off until a clean preview ("Install without a preview" only when the preview cannot run, and the confirm says so). The upgrade confirmation lists what changes, hooks, which workloads restart, --atomic, and the undo (roll back to the running revision). Rollback shows the diff between the running and target revisions from the release records. Ask Pulse about a preview (local cluster only).

### Changed
- The RBAC tab is labelled Access review (`?tab=rbac` still works) and starts with "Who can"; the single-subject SubjectAccessReview check is now "Check one subject". User, group, service-account and cluster-admin names open the subject page.
- **Deploy an app replaces Quick Deploy (Wave 15).** One form with optional sections: Source (container image with a pull secret, or a Git repository built by a BuildConfig into an ImageStream with a Deployment image trigger, offered only when the cluster serves build.openshift.io and image.openshift.io, otherwise disabled with the reason), Config (environment from ConfigMaps and Secrets by name, all keys or one key; Secrets are read as metadata only, so their values never reach the browser), Storage (new PVC with storage class and access mode, or an existing PVC), Health checks (startup, readiness, liveness), Resources with the namespace's ResourceQuota headroom after deploy and during the next rollout ("Could not check" when quota cannot be read; a quota on a resource the form leaves unset is called out), and Expose (Service, Route with edge/re-encrypt/passthrough TLS; a PodDisruptionBudget above one replica). "Dry run" sends every object with dryRun=All and lists the result in create order, plus what the dry run cannot see (referenced ConfigMaps/Secrets/PVC exist, the Route hostname is not claimed elsewhere, NetworkPolicies, WaitForFirstConsumer binding); Create turns on only when everything passes and RBAC allows each kind. Create runs in dependency order on the cluster the dialog was opened on, stops at the first failure with a one-click delete of what was created (PVC kept unless chosen), then shows the rollout and whether the router admitted the Route; whether the Route answers is reported as not checked. Ask Pulse about the deploy sends the form as context (local cluster only).

## v2.37.0 (2026-11-03)

Paired with pulse-agent v2.37.0; runs with pulse-operator v0.13.0. Pull requests #159–#187. Needs pulse-agent v2.37.0 for the readiness gate waivers (`GET`/`PUT`/`DELETE /readiness/waivers`, agent migration 042), the update graph and rollout history components (`get_cluster_updates`, `get_rollout_history`), the removed-API go/no-go (`check_upgrade_api_removals`) and the Pod page's "what changed?" (`GET /changes`). On an older agent the readiness view falls back to browser storage and the rest degrade to their previous behaviour.

### Added
- **Update readiness on Admin › Updates (Wave 14).** One readiness panel above the update action replaces the pre-update checklist and the separate Removed APIs panel: an overall verdict (Ready / Not ready / Could not check) with counts, when it was checked, Recheck and Ask Pulse (the result goes to chat as context), and Blocker / Unknown / Passed rows with their fix: removed APIs still called ("See callers" opens the caller table), admin acknowledgement (Acknowledge), Upgradeable=False, PodDisruptionBudgets with 0 disruptions covering a pod on a node that will drain (paused pools excluded; Edit PDB), critical alerts (link to Alerts filtered to critical), pending CSRs, the earliest control-plane certificate expiry, etcd operator and member pod health, the latest EtcdBackup (Take backup now creates an EtcdBackup when that API is served and a PVC exists in openshift-etcd), nodes ready, platform operators healthy and the channel. A failed read is Unknown with its reason, never a pass, and passed rows collapse into one line. Below it, the update action has the target picker, "Pause worker pools first" and "Start update…", which stays enabled with blockers, says what is likely to go wrong, and lists the open blockers in its confirmation.

### Changed
- **One entry point per thing.** Software › Operators (it only redirected to /operators) is gone; old `/software?tab=operators&q=…` and `/create/v1~pods?tab=operators…` links still land on /operators with their search. Identity & Access › Impersonation is gone: Impersonate stays on each user and service-account row, the Shell banner shows who is impersonated with Stop, and an old `?tab=impersonation` link opens Users (the per-browser "Recently impersonated" list is dropped; the user menu's "Impersonate User" and "Stop impersonating" entries are unchanged). Security no longer lists cluster-admin holders a second time; its audit row stays and links, with a "Cluster-admin holders → Identity & Access" line, to Identity › RBAC, which lists them with Revoke. Admin › Operators (ClusterOperators) is now "Platform operators" on its tab, the Overview card and the links to it, so it is not confused with OLM's /operators catalog; `/admin?tab=operators` still opens it.

### Fixed
- Safety fixes (Wave 10): the default-deny NetworkPolicy template now creates an allow-from-router policy first (ingress and HostNetwork routers), then the deny, so Routes keep working and a separate default-deny egress template keeps DNS; cordon/uncordon from the node map and node table confirm with the same words as the node page; node Debug confirms what it creates (privileged hostPID/hostNetwork pod, namespace, image) and the pod really ends (activeDeadlineSeconds; End session deletes it, and closing the terminal asks whether to); pod Debug confirms the ephemeral container and its image, which can be changed; Debug is gated by RBAC; the etcd backup gate and OADP card no longer say OADP backs up etcd; the node "Audit Logs" tab is relabelled "Host audit (auditd)"; changing the update channel confirms old → new and which offered targets stay or drop out; the command palette's ":Scale", ":Restart" and ":Delete resource" entries, which only opened a list, are removed.

- Pulse home, Security, Fleet, Inbox/approvals, Pulse Agent, Identity & Access, Topology, Timeline and agent stat cards no longer show a failed or unreadable read as healthy or empty (Wave 9a). Zen needs a clear posture bar and no warning alerts; the risk ring is Unknown when alerts can't be read; Security lists unprotected namespaces only from two successful reads; Fleet Alerts rows open their detail on the fleet page; failed approvals, activity, fix-history, episode and Identity reads show LoadError and unknown counts/checks; Topology, Dependencies and the Timeline's alerts say they are local-cluster only.

- Admin and Software pages no longer show a failed or forbidden read as zero, "none configured" or a pass (Wave 9a). Quotas, the Operators tab, the Overview (Ingress default certificate, identity providers, warning events, certificate expiry), the pre-update PDB and etcd-backup checks, the operator catalog's Installed count, Software › Installed and Helm repositories/indexes now show the error or "—"/"Could not check". The readiness "Cluster Up to Date" gate is unknown when the cluster could not retrieve updates and counts conditional updates. The Certificates tab uses the same expiry parser as the Overview, and "View certificates" opens it showing exactly the certificates the Overview counted. `safeQuery` now recognises the 404 that `k8sList`/`k8sGet` throw.

- **Infrastructure pages no longer show a failed read as healthy or empty (Wave 9a).** Workloads, Builds, Networking, Compute (machines, MachineSets, MachineHealthChecks, autoscaling, capacity projections), Storage (CSI drivers, VolumeSnapshots) and the workload logs pod list now show the error with Retry and "—" counts when a list is forbidden or fails, instead of "No StatefulSets", green "healthy" dots, "0/0" nodes, "No network policies configured", "No health checks configured" or "Autoscaling is not configured". The shared health-audit panel gains `unknown` and `notApplicable` check states: a check whose read failed shows "Could not check" and a check with nothing to check shows "Not applicable"; neither counts as a pass. `safeQuery` now recognises the 404 the k8s helpers throw (`statusCode`), so an API the cluster does not have is "none", not an error. The workload Resource Usage card is scoped to the workload's own pods (it showed the whole namespace), and /metrics and project charts keep their time window in state, so hovering a chart no longer refetches and flickers every chart.
- A resource list's Create button opens that kind's editor again. Pods sent `/create/v1~pods?tab=yaml`, which the new Software redirect turned into Import YAML. Moving between two `/create/…` pages now starts a fresh editor instead of keeping the previous kind's YAML.

- **CI actions on Node 24.** GitHub has deprecated Node.js 20 for actions and was forcing these onto Node 24 with a warning on every run. Bumped to the current majors, the same ones pulse-operator already uses: `actions/checkout@v7`, `actions/setup-python@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `docker/build-push-action@v7`, `docker/login-action@v4`, `pnpm/action-setup@v6` (each only where the repo uses it).

### CI
- `ci.yml` also runs on `merge_group`, so the required checks (`Lint & Type Check`, `Unit Tests`, `Build`, `E2E Tests`, `UI Release Acceptance (isolated)`) report in the merge queue that now guards `main`.

### Added
- **Pod page: what owns it, how it last ended, and its containers at a glance (Wave 11, part A).** Under the pod's name: the owning workload with the revision the pod runs (a Deployment's, read from its ReplicaSet; "revision unknown" with the reason when that read fails) and the node; tiles for Last exit (reason and exit code from `lastState.terminated`, or the terminated instance itself when it never restarted, e.g. a failed `restartPolicy: Never` pod; init containers included, so an Init:CrashLoopBackOff pod shows its init container), Restarts since the pod started (init containers included), and Memory p95 / limit (both in the same units; decimal limits like 500M read correctly) over 6h from Prometheus ("—" with the reason when metrics are remote-only, the query fails or there are no samples). One card per container, init containers first and marked "init": state now, last termination (reason, exit, time, how long it ran), image, limits/requests, ports, mounts, probe timing (delay, period, timeout, failure threshold, with Kubernetes defaults shown), and links to its pull secrets, PVCs, ConfigMaps and Secrets. Pod and Deployment pages have an "Ask Pulse about this …" box, and a question typed straight into the Pulse AI dock on a Pod, Deployment or other workload page is sent with that resource as context (the dock says which). On a remote cluster no context is attached and the box is disabled: Pulse AI answers about the local cluster only. Owner links are built from the owner's apiVersion and scope, so a static pod links to its Node and a custom-resource owner (VirtualMachineInstance, TaskRun) to its own group. Jobs and CronJobs are workloads: their pods, logs and events show on their pages; a Job lists its attempts and a CronJob its runs, newest first, with the failed pod's log inline (a retried attempt that is running again shows "Running · retried after exit N", and its log is the previous instance's) (a forbidden log or Jobs read shows the error, not an empty list). The Workload Audit (replicas, strategy) no longer runs on Jobs.
- **Removed APIs go/no-go on Admin › Updates.** Before a minor update, a "Removed APIs" panel shows Go / No-go / Could not check for the next minor (or a minor picked from available and conditional updates): which APIs the target Kubernetes removes were still called in the last 24h (APIRequestCount), with request counts and top callers by user and user agent (`system:` callers tagged Platform, never hidden), a collapsed list of removed-but-unused APIs, and the admin gates for the target. Unacknowledged gates get an Acknowledge action that merge-patches `openshift-config/admin-acks` with the user's own credentials on the cluster the panel was opened on, after a confirm quoting the gate (RBAC-gated; the acknowledged state comes from a re-read). The update button stays enabled on No-go but warns, and the pre-update checklist gains a "Removed APIs" row. ClusterVersion Upgradeable=False makes it No-go with the CVO reason and message. A 403/500 on APIRequestCount or the ConfigMaps, or a 404 on APIRequestCount or admin-gates, is "Could not check", never Go. A missing admin-acks means nothing is acknowledged, and only the exact value "true" counts. When the channel offers no newer minor, the check runs for current minor + 1, labelled "next minor (not yet offered on your channel)". The Upgradeable=False banner offers the same Acknowledge action instead of "run oc adm upgrade" when the gate key is known.
- Workload, node and storage actions (functionality review, Wave 7a). Every state-changing action asks first, saying what will happen; is disabled with the reason when RBAC does not allow it; is pinned to the cluster that was active when its dialog opened; and shows a failed write in the dialog
  - One actions menu for Deployments (set replicas, rollout restart, pause/resume, roll back, delete), StatefulSets (set replicas, restart, delete), DaemonSets (restart, delete), CronJobs (trigger now, as `oc create job --from=cronjob/…`; suspend/resume), Jobs (re-run, without the old selector and controller labels; delete), ReplicaSets (scale) and Pods (restart/delete saying whether a controller replaces it, logs, exec), on the Workloads lists, resource tables and detail pages. The header's ±1 scale and unconfirmed Restart are replaced by it
  - The Workloads page lists StatefulSets, DaemonSets, CronJobs and Jobs, and each issue banner opens the list it counts, filtered
  - Node pages: Cordon/Uncordon (confirmed) and Drain, and a visible Node logs button
  - Storage: Create PVC; expand a PVC (only when its StorageClass allows expansion, otherwise disabled with the reason) and see which pods mount it; delete a Released PV (warning that the backing volume is destroyed when its reclaim policy is Delete); set the default StorageClass (this class is marked first, then the GA and beta default annotations are cleared on the others); CSI driver and VolumeSnapshot rows open their pages
  - Labels and annotations sections are always shown and can be added, edited and removed with a JSON patch that applies only to the version on screen
  - HPA min/max editing, a Route "Open URL" (https when TLS), and a Service endpoints section
  - Networking: create Service/Route/Ingress in the selected namespace, and "Services with no ready endpoints" (skipped when Endpoints cannot be read)
  - Compute: scale a MachineSet, delete a Machine (says the node goes and what replaces it; control-plane machines warn about etcd quorum and, without a ControlPlaneMachineSet, need the name typed), pause/unpause a MachineConfigPool
  - Project dashboard: summary cards open the filtered lists; Routes, PVCs and quota usage sections; "Create in <ns>". It opens from the namespace picker and from a Namespace's page
- Update graph, rollout history and live charts (Wave 8; pairs with pulse-agent's `get_cluster_updates`/`get_rollout_history`):
  - **Admin › Updates is an update graph.**
    - It draws the installed path, the current version and every target, one column per minor version. Edges are coloured by what ClusterVersion says: recommended (`availableUpdates`), conditional (`conditionalUpdates`, with the risk count) or blocked (a minor target while Upgradeable=False). During an update the release being installed sits between current and the targets, because CVO computes targets from it.
    - Selecting a target shows its risks with names and links, the Recommended message and an estimated duration taken from the last completed update's duration (labelled as such). The update action patches `spec.desiredUpdate` {version, image} on the cluster the page showed.
    - A conditional target needs an explicit "accept risks" confirmation that lists each risk. The patch then adds the risk names to `spec.desiredUpdate.acceptRisks` and keeps any already accepted. That field is recorded only where the ClusterUpdateAcceptRisks feature gate is on, and the toast says whether this cluster kept it. Every focusable control in the confirm dialog's focus trap (not only buttons) can be reached with Tab, so the required checkbox is reachable while confirm is disabled.
    - While an update runs:
      - an overall bar parsed from CVO's "x of y done (z%)";
      - ClusterOperators at the target version, N of M, with degraded ones linked;
      - a rollout bar per MachineConfigPool, linked;
      - blockers;
      - the time remaining, estimated from the last update.
    - History is a timeline with real durations: no "0" artefact, and no spinner on historical Partial entries.
    - ClusterVersion and MachineConfigPools are watched (`useK8sListWatch`), so progress moves without a reload.
    - The channel picker offers the next minor (needed for a minor update) and eus only for even minors, and uses `status.desired.channels` when the release lists them.
    - Nodes in rollout and drain-blocking PDBs link to their objects. The duplicate in-progress banner, the separate conditional-risks panel and the unused SnapshotsTab import are gone.
  - **Rollout history for Deployments, StatefulSets and DaemonSets** replaces RollbackPanel.
    - A horizontal revision timeline built from ReplicaSets or ControllerRevisions, watched live. It shows the image changes between revisions, the change-cause, the current revision, and a rollout-in-progress bar.
    - Rollback to any revision is RBAC-gated (`patch`), confirmed with a diff and pinned to the cluster. It replaces `spec.template` exactly: JSON Patch `test` on the shown resourceVersion plus `replace`. For a StatefulSet or DaemonSet it restores the ControllerRevision template. As with `kubectl rollout undo`, a paused Deployment is refused (with the reason) and the revision's change-cause is copied onto the Deployment. From chat, rollback is offered only while the agent's cluster is the active one.
  - Agent components:
    - `upgrade_graph` renders the same graph, read-only, linking to Admin › Updates to act.
    - `rollout_history` renders the live history (with rollback) on the agent's cluster, or the agent's snapshot, labelled, when the workload cannot be read.
    - `chart` honours `refreshInterval` (seconds), `live` (a 15m sliding window refreshed every 10s), `step` and `annotations` (rollout/alert/config markers on the time axis, listed under the chart). The old `time_range` field is read as `timeRange`.
    - `stat_card` re-queries its PromQL `query` every `refreshInterval` seconds.
  - **Timeline:**
    - a density chart per category over the selected range;
    - events listed for the selected namespace without the cluster-wide `limit=500`, and capped at 1000 cluster-wide with a note when the cap is hit;
    - alerts that fired and resolved within the range, from `max_over_time(ALERTS{…}[step])` so short alerts are not missed between samples;
    - an error with retry, not an empty timeline, when no source could be read; a partial failure also offers retry.
- Admin and operations actions (functionality review, Wave 7b). Every one confirms with exactly what will happen, is disabled without the RBAC permission (SelfSubjectAccessReview), is pinned to the cluster it was opened on (refused with a reason if the active cluster changed), and shows failures in its dialog:
  - Certificate signing requests: Admin › Certificate requests lists CSRs (requester, signer, usages, age, status) with Approve / Deny on the approval subresource and bulk approval of kubelet-serving CSRs from an explicit list; Compute shows a banner when any are pending
  - Certificates: links to the owning cert-manager Certificate, service-ca Service and Routes; Rotate for service-ca serving certificates (deletes the secret so service-ca re-issues it); the load error has Retry
  - Operators: install reuses the namespace's OperatorGroup (no more TooManyOperatorGroups), takes the install mode from the CSV's installModes and refuses incompatible groups with a reason; Automatic/Manual approval at install; installed operators show "upgrade available", can change channel, switch approval and approve a pending InstallPlan; the operator detail is in the URL (`?pkg=`) so Back works; Admin ClusterOperators and the OLM catalog link to each other
  - Helm: one releases list (Helm Charts tab; Installed links to it) with "rev N", chart version, values view, upgrade (chart version + values), rollback to a revision and uninstall — all run by the existing digest-pinned helm runner Job, values passed in a mounted Secret. Helm install takes a chart version and values; Helm install and Quick Deploy require a namespace in all-namespaces mode instead of using `default`
  - Alerts: silences are listed by state (active, pending, expired) with edit (replace) / recreate and expire; Pending and Silenced stats filter the list to what they count; rules open a detail drawer (expression, `for`, labels, annotations, defining PrometheusRule with Edit YAML, Silence, Investigate with Pulse); "Create alert rule" opens a PrometheusRule template
  - Identity: users, groups, service accounts and cluster-admin subjects open their detail pages; create/delete groups and add/remove members (with resourceVersion, so concurrent edits are refused); grant a RoleBinding or ClusterRoleBinding (role, subject, namespace) and revoke (delete) bindings, listing every subject that loses access; a "Who can…?" SubjectAccessReview check
  - One definition of "too many cluster-admins" (more than 3 non-system subjects on non-system bindings) shared by Security and Identity; a failing check is a warning
  - Security: "+ default-deny" on namespaces without a NetworkPolicy opens a prefilled policy; cluster-admin bindings can be removed
  - Quotas: inline edit of ResourceQuota hard limits (merge patch with resourceVersion); unprotected namespaces open prefilled ResourceQuota / LimitRange creates
  - SLO: the service is picked from the cluster's Deployments, with a note when the name exists in several namespaces (the agent matches `deployment=` without a namespace); SLOs can be edited
  - `/create/<gvr>?template=<id>&namespace=<ns>` opens reviewed templates (default-deny NetworkPolicy, ResourceQuota, LimitRange, PrometheusRule)
- Gaps from the functionality review:
  - Helm: **Edit values** works for every release, with or without a configured chart repository. Helm keeps the release's chart in its release Secret, so Pulse rebuilds that chart as an archive, mounts it into the runner Job from a Secret and runs `helm upgrade --reset-values` with the edited values and the chart version that is deployed (after a failed upgrade, the last deployed revision's chart and values, and the dialog says so). A release that rendered any subchart, declared or vendored in `charts/` (Helm does not store subcharts), says so instead. Edit values needs permission to create Secrets as well as Jobs. Repository upgrades also pass `--reset-values`, so empty values mean the chart's defaults as the dialog says **Upgrade to X** is offered only when a configured repository has the chart, and says why it is unavailable otherwise. Secrets made for a Job that could not be created are removed
  - Rollout history marks the alerts and findings of each revision on the timeline and lists them in the revision details, linking where a link exists: the agent's `rollout_history.correlations`, and on the agent's own cluster the monitor findings and inbox items the UI already holds for the workload or its pods (by the finding's onset; by time only while revision start times follow revision numbers, so after a rollback only exact pod/ReplicaSet names place a finding)
  - Admin › Updates: pause or resume a MachineConfigPool from its row (during an update in the progress rows, otherwise in a pool list), with a confirmation that explains the effect; RBAC-gated, pinned to the cluster, conditional on the pool's resourceVersion. Compute uses the same action, now also conditional on resourceVersion
  - The Software hub has its own route, `/software`, in the sidebar and palette. `/create/v1~pods?tab=…` redirects there; `/create/<gvr>` opens that kind's editor (only a template of that kind is used as the starting point, matched by plural so it works before the resource registry has loaded). "Blank YAML" opens an empty editor instead of a Pod
  - Pulse Agent tab groups (Operate / Configure / Insights) come from the Tabs primitive's `TabsGroup`, which names each tab's group to assistive tech; every `?tab=` value, the session's last tab and the `?drawer=` rule are unchanged
  - Identity: Impersonate appears once per subject, on user rows (Users) and service-account rows (Groups & Service Accounts). The Impersonation tab shows who is being impersonated and recent targets instead of repeating both lists

### Changed
- Readiness gate waivers are kept on the cluster by the agent (`/readiness/waivers`, pulse-agent migration 042) instead of in one browser, so everyone on the cluster sees the same waivers and the same score. Each waived gate shows who waived it, when, and its expiry; the waiver dialog takes an optional expiry date and a waived gate has "Remove waiver". Waiving or removing requires Pulse administrator access when `PULSE_AGENT_ADMIN_USERS` is configured: a 403 says so and keeps the dialog open; any other error (including a failed list, which the dialog names) is shown, and nothing falls back to the browser silently. A waiver on a gate that now passes is shown as no longer needed, with Remove waiver, since it would apply again if the gate failed; browser copies of waivers the cluster already has are cleared so a lifted waiver is never re-offered. On an agent without the endpoint (404) waivers stay in this browser, and the page and dialog say so. Browser-only waivers for gates the cluster has none for are offered, not moved: "Save these N browser-only waivers to the cluster". The score is still counted once, by `summariseReadiness`.
- Shared building blocks (functionality review, Wave 5a):
  - One status colour map (`engine/statusColors`): warning is amber everywhere (StatusBadge, inbox-style yellow is gone), pending/progressing is blue and unknown is slate in agent tables (they were amber), info is sky. StatusBadge, Badge and the agent data, visualization and relationship renderers use it
  - One formatter module (`engine/format`) for age, relative time, durations, bytes and timestamps, with a fixed `en-US` locale; the old `formatters`/`formatting`/`dateUtils` names still work. Table ages read like `kubectl get` everywhere (`45s`, `12m`, `3h`, `65d`, `1y`), relative times say `2mo ago`, "… ago" is never doubled, and a clock-skewed timestamp reads "just now"
  - Tabs are one accessible primitive (arrow keys, tab/tabpanel roles) on Pulse Agent, Software, resource details, logs, node logs and the operator catalog; Pulse Agent, Software and resource details keep the open tab in `?tab=`. Pulse Agent tabs are grouped Operate / Configure / Insights and "SkillPlan" is "Plans"
  - One StatCard (icon, subtitle, usage bar, explanation, issue count); clickable cards are real buttons. Toolbox, Compute, Security and project dashboard cards use it
  - One Dialog primitive (focus trap, Escape, aria-modal, focus returned): New Task, Waive Gate, GitOps Save, chart editor, GitOps setup wizard and ConfirmDialog use it. Version history, incident lifecycle, skill, tool and outcome drawers use DrawerShell. Escape closes only the innermost dialog
  - Cancelling a durable run and forgetting a memory ask in a dialog instead of a browser `confirm()`
  - Permission checks (`useCanI`) go through the same request path as every other cluster call, and are cached per impersonated user, so starting to impersonate someone re-asks instead of reusing the admin's answer for five minutes. Read checks still fail open when the review itself errors (the API server enforces the read); write checks fail closed
  - ESLint fails on new private StatCard/StatusDot/StatPill/SummaryCard components, private status colour maps (any casing, module or function scope) and `window`/`globalThis` `confirm` (existing copies are allowlisted with the wave that owns them)

### Fixed
- Inbox actions and one approvals queue (functionality review, Wave 7c; needs pulse-agent #220):
  - Inbox → **Approvals** (`/inbox?tab=approvals`) lists everything waiting for a person: proposed fixes and durable runs stopped at an approval gate, approved or rejected in place. A one-line banner above the inbox links to it; Pulse Agent → Runs links to it instead of keeping a second copy. The "Approval waiting" chip on a row now reflects a real pending proposal or run.
  - Proposed fixes can be **rejected with a reason** (`POST /fix-history/{id}/reject`), and show what the fix would do (strategy, cause, description, linked resources) and a link to the inbox item. When the agent refuses an approval, its reason stays on screen.
  - Inbox rows gain **Escalate** (with confirmation) and **Unclaim**; Claim uses a user-plus icon. The item drawer has **Approve/Reject** for a pending fix, resources link to their detail pages, and suspected prompt injection (`security_notes`) is shown as a warning beside the investigation.
  - New task: due date and a namespace picker (falls back to typing when namespaces cannot be listed). Episode symptoms open their inbox item (or the resource), and "What else changed" navigates in the app instead of reloading it.
  - Readiness waivers are kept with their reason and author (this browser; the agent has no waiver endpoint), and the score is counted one way on every recount, so re-verifying a gate no longer drops it. Retry re-runs the evaluation instead of reloading the page.
  - Views: Clone, a type filter and search, and a toast when sharing fails (the link is shown if the clipboard refuses it). The views list keeps each view's type.

### Fixed
- Links and routes (functionality review, Wave 1):
  - An unknown address shows a "Page not found" page naming the path, with Back and Go to Pulse, instead of silently redirecting to /pulse. Restored tabs for pages that no longer exist (`/welcome`, `/incidents`) are dropped
  - Resource links get the group, version, plural and scope from the cluster's discovered API resources: warning events, alerts, the timeline, fix history and the dependency graph no longer link Deployments to the core group, build `ingresss`/`hpas`, or put cluster-scoped objects (Nodes) under a namespace. Alerts no longer treat the Prometheus `job` label as a batch Job
  - `/r/<gvr>?ns=` opens the list for that namespace, and `/create/<gvr>?namespace=` drafts in that namespace
  - The logo, "Getting Started" and "Go Home" open real pages; "Session expired — click to log in again" signs out through oauth-proxy; Admin tabs follow `?tab=`; IngressController, ServiceAccount and NodePool audit items open their own pages; operator links open `/operators?q=`; GitOps "configure Git" points at the setup wizard's Git step
  - Links from the agent open in-app without a full reload, external links open in a new tab, and links to pages Pulse doesn't have are shown as text with a tooltip. Activity links to the old `/incidents` page open the Inbox activity tab
- Failures no longer look like "all clear", and no invented numbers (functionality review, Wave 2):
  - Fleet: cards show connection status instead of a made-up score of 100 "All systems go"; ACM CPU cores are no longer reported as nodes; Alerts, Workloads, Compliance, Compare and Drift name the clusters they could not read and leave them out of totals and matches. Compliance keeps pass / fail / unknown (a 403 on kube-system/kubeadmin is no longer "removed"); an unset scheduler profile is LowNodeUtilization, not HighNodeUtilization. Drift says "N of M clusters compared" and lists clusters where the resource is absent as drift
  - GitOps: a failed Applications read shows an error instead of "No ArgoCD Applications found"; Rollouts load after detection and the tab appears when it does; the wizard says "Setup Complete" only when the operator, repository and an Application are there; no claim that the agent validates the Git connection; the never-filled "Committed files" panel is gone; Bitbucket App Passwords (`username:app-password`) use Basic auth
  - Alerts: an Alertmanager outage no longer hides the firing list; the silence author is not filled in as "admin"; a filtered-empty list no longer says the cluster is healthy
  - Security and Identity: kubeadmin is checked through the kube-system/kubeadmin secret on both pages, and a failed read is unknown; a failed APIServer read is unknown, not Intermediate; the always-passing "Privileged SCCs tracked" and "TLS certificates managed" checks are gone; failed ClusterRoleBinding, NetworkPolicy, SCC and Secret reads show "—" or a load error instead of 0/none; checks say "Checking…" while their reads are in flight; removing kubeadmin refreshes its check
  - Admin: Overview certificate expiry and the router certificate use the certificate's own notAfter (no creation + 780 days); "Recommended" is gone (updates are sorted, the newest is "Latest"); update status is Unknown when ClusterVersion is unreadable or CVO could not retrieve updates; "Cluster Health %" is replaced by operator counts (an operator both degraded and progressing is counted once); Snapshots count fields that were unreadable at capture as "not compared" and no longer show "0 nodes" for them; certificates with unknown expiry have their own card; a failed operator catalog read shows an error
  - Pulse: no "N auto-fixed overnight"; the report says Unknown instead of "Up to date" when ClusterVersion is missing, and picks up Argo drift when it loads; the agent overview and Outcomes card say "fix actions" / "fixes", not "issues detected" / "findings", and unknown when its reads fail; auto-fix categories ("not reported" when the agent sends none), scanner interval and Inbox wording come from the agent; Toolbox Usage and Components show load errors; Ask Pulse no longer calls its prompt a "sample response"
  - The user menu says "Unknown user" when the lookup fails and takes the role from a SelfSubjectAccessReview, sent with impersonation
  - Storage, Compute and Topology: no StorageClass banners while loading or after a failed read; unread PVC/PV lists show "—" and skip their audit checks; the default-StorageClass, HA control plane and dedicated-workers checks fail when there is nothing to list; capacity cards say "No data" instead of "Stable"; a failed blast-radius lookup is an error, not "None (leaf node)"; the map lists places with no region label under "Unknown location" instead of pinning them to real cities, labels cluster pins by connectivity (no health %), and counts only Warning events, linking to Events
  - Timeline and Activity name sources they could not read; the project dashboard counts CrashLoopBackOff pods as failing and initializing pods as pending, counts every warning event (newest shown first), and shows "—" with a load error for lists it could not read; Metrics and project charts show Prometheus errors instead of "No data available"; agent stat cards show "no data" instead of 0 and prefer the live value; CRDs, node logs and the Events dock show load errors with retry
  - Builds show one success rate over finished builds, with cancelled builds reported beside it
- Cluster identity (functionality review, Wave 4): nothing is read from one cluster and written to another
  - The YAML editor pins the cluster it loaded from; if the active cluster changes, Save is disabled and a save (including Ctrl+S and the GitOps dialog) is refused with a message naming both clusters. Load, save and dry-run go to the pinned cluster with impersonation
  - Pod, build, node and merged ("All pods"/"All containers") logs, and the dependency graph, read the active cluster with impersonation; incident-context logs say why they failed. Merged logs show each pod or container that failed and why (403, 500) instead of "No logs found", and have Refresh
  - Every query that reads Kubernetes or Prometheus data keys on the cluster it reads (Admin, Compute, Security, Storage, Networking, Operators, Argo CD projects and diffs, incident logs, capacity and report metrics)
  - Prometheus and Alertmanager are reachable for the local cluster only. While a remote cluster is active, Metrics, namespace charts, metric cards, Compute, Capacity Planning, control plane metrics and the Alerts page say so instead of showing the local cluster's numbers or blanks; the Pulse posture bar and report give no all-clear while a remote cluster's alerts cannot be read; failed metric queries say they failed instead of "No data"
  - Pending actions carry the cluster they were created on and refuse to run against another: cluster update and channel change, cluster configuration edits, kubeadmin removal, operator install/uninstall, Argo CD sync and application creation, build cancel/trigger, and agent write approvals (which name their target, the agent's own cluster, and are declined after a switch)
  - Pulse's own objects (OpenShiftPulse CR, its deployments, GitOps config Secret, production readiness, agent-generated widgets) are read from the cluster Pulse runs on, explicitly
  - Argo CD sync badges, GitOps cards and resource history detect Argo CD themselves, and again after a cluster switch

- Every button does what it says, or is gone (functionality review, Wave 3):
  - Drain is a real drain: cordon, then evict each non-DaemonSet, non-mirror pod through the Eviction API, with per-pod progress and a summary, and report "drained" only once the evicted pods are gone (otherwise "evictions accepted, N still terminating"). Pods no controller owns and pods with emptyDir data are named and left in place unless opted in (like `--force` / `--delete-emptydir-data`). Pods a PodDisruptionBudget blocks are reported with the budget's name and can be retried. The cluster is fixed when the dialog opens. Shared by the Nodes table and the Compute node map; the toast never says a drain started when nothing moved
  - Compute node map: Cordon/Uncordon, Drain, Open Terminal (the node's debug pod), and pod View Logs, Exec and Delete (confirmed) all work; each node and pod row has a visible actions button; items the user's RBAC doesn't allow are not offered
  - Table row actions are hidden without permission; scale to 0 and rollout restart ask first; read-only users can open YAML, which opens read-only. In the YAML editor, Cmd+S and the diff preview go through the same GitOps check as Save, and there is one Save
  - Argo CD "Sync" starts a sync (target revision from the app, optional prune); a separate "Refresh" re-reads Git and applies nothing
  - Import YAML keeps unquoted dates and yes/no/on/off as strings, and creates each document at its own path (cluster-scoped kinds without a namespace, namespace from `metadata.namespace`), reports each result, validates each document at its path, and the header names the real kind
  - Removing a ConfigMap or Secret key removes it. A save sends only the keys that changed, so other Secret values (non-ASCII text, binary) are never re-encoded; binary values are shown read-only. The save carries the resourceVersion, and a concurrent change asks you to reload instead of overwriting. The editor writes to the cluster on screen and is read-only without update permission
  - Delete progress follows the deleted object (cluster-scoped too) and shows pod teardown only for workloads; only a 404 counts as deleted
  - Logs: "Previous instance" works on the incident card and the Logs page; ephemeral debug containers are listed
  - Software tabs follow `?tab=`; Installed Helm releases list every namespace in all-namespaces mode, one row per release at its latest revision
  - "Monitoring On/Off" on Pulse is "Live updates" (this browser's stream), with a tooltip pointing at the server pause; Trust policy shows the server's auto-fix categories read-only instead of toggles that were not applied; "Try in chat" works and "Enable scanner" is hidden until it can
  - Smaller fixes: Workloads "View logs" is its own button and uses the Deployment's selector; Start build, Rollback and "Ask AI" are visible without hover (Start build and Rollback only with permission); Quick Deploy reports a failed Service or Route; the inbox dismiss dialog names the item's severity; a failed episode detach, shared-view claim or skill routing test is shown; the collapsed AI rail always expands, with the findings count as its own Inbox link
- Each fact once, where you look for it (functionality review, Wave 6):
  - One count per page: Workloads problem counts live in clickable banners (no stat-card badges, CrashLoopBackOff sparkline, Pod Status rows or Unhealthy Deployments panel repeating them); Alerts counts live in the stat row ("Firing" counts firing only, with its critical/warning split; tabs carry no counts); Admin Overview counts operators on one card (which opens the Operators tab) and nodes in one panel; Pulse shows node, pod, CPU and memory once (the report; the map header shows them only in fleet mode) and labels which cluster the posture bar and map describe; Networking has one network-policy banner and counts not-admitted routes once; Storage counts pending PVCs once and drops "Capacity by Storage Class" (the classes panel has it); Compute's Capacity tab no longer repeats the Overview charts and pod density has one formula; Builds count from every build and a running build is not an issue; Security, Identity, Inbox, ArgoCD, Agent analytics (one fix-outcome card with its window, cost once in "conversations", prompt tokens once, Tools stats once, Recent Activity as a 3-item summary), Fleet ("N of M clusters reachable"; "Fleet Risk Score" is "Fleet reachability"), Argo conditions, Pod sparklines, Deployment limits/probes, resource metadata (a key/value summary, not a JSON dump) and project pod counts each show once
  - Merged pages: `/deps/…` opens `/topology` focused on the resource (the second graph engine is gone, and the blast-radius highlight is the agent's list); Fleet Compare, Compliance "Configuration Drift" and the Drift Detector are one Compare & Drift page with a cluster-configuration preset and a one-resource mode (cluster-scoped kinds, required namespace, cluster subset), and `/fleet/drift` redirects there; every fleet page has a fleet tab bar with a way back; Inbox › Activity shows agent actions only and links to `/timeline`; Create › Operators and old `?tab=operators&q=` links open `/operators`; Analytics opens the Overview scanner drawer and the Memory tab instead of copies
  - Navigation: Alerts sits with Inbox and Timeline, Security with Identity; Topology is called Topology; the palette finds Builds, Events, Helm, CRDs, Certificates and project dashboards (and the namespace picker opens one); the resource browser search filters the page list too; the tour describes the Inbox and has "Show me" links; the status bar says "Create"; one inbox bell, from the inbox store, named "need attention" everywhere
  - One platform-namespace rule (`openshift`, `openshift-*`, `kube-*`) for the Routes TLS, NodePort, NetworkPolicy, Workloads and Security audits
  - Storage's Reclaim Policy check is informational; Admin's Namespaces card opens the namespace list and "Manage providers" opens Cluster Config with OAuth expanded (and an OAuth save refreshes the Overview list); the report's "All clear" is not a /readiness link and stays silent while the posture bar counts open issues; "Recent Changes" is "Rollouts & config changes" from the watched events; the agent's "Readiness" is "Install health"; the GitOps wizard resumes at the first unfinished step; CRDs has no second page header; ClusterOperators link to OperatorHub operators

### Tests
- `cluster-identity-guardrail.test.ts` parses all of `src/` outside `engine/` and fails on a query (including `useInfiniteQuery`/`useQueries`) that reads cluster data without a cluster id in its key, and on any Kubernetes/Prometheus proxy-path literal. `cluster-identity.behaviour.test.tsx` switches clusters between load and save, and checks the requests logs, metrics, alerts and Argo detection send
- `routeLinks.test.ts` checks every literal link in the source, and the links pulse-agent emits (`__tests__/fixtures/agentLinks.json`), against the route table that the router mounts
- `__tests__/helpers/honestStates.tsx`: `renderWithFailedRequests` renders a page with its reads failing and `expectNoAllClear` asserts that no all-clear copy is shown and an error or unknown state is. `QueryState` / `loadStatus` (components/primitives) and `readK8s` / `listK8s` (engine/readResult) are the shared three-state read pattern

## v2.36.0 (2026-10-30)

Paired with pulse-agent v2.36.0; runs with pulse-operator v0.11.0. Pull requests #156–#157. Needs pulse-agent v2.36.0 for the call citations (`call_ref`, `call_input`); earlier agents' reports render as before.

- Investigation evidence names the tool call it came from, with that call's arguments (`get_pod_logs(namespace=shop, pod_name=api-7f)`), in the activity feed, the inbox drawer and the evidence view. Needs pulse-agent with call citations (`call_ref`, `call_input`); older reports render as before.
- The inbox drawer shows each evidence item's stance and marks a cited source the investigation did not read (#156). The e2e compose stack includes the agent stack, and the docs check fails on a version mismatch.

## v2.35.0 (2026-10-27)

Paired with pulse-agent v2.35.0; runs with pulse-operator v0.11.0. Pull requests #151–#153. Needs pulse-agent v2.35.0 for live inbox updates, memory `enabled` flags, `no_data` SLOs and the structured investigation evidence.

### Fixed
- Failures and "switched off" are shown as such, never as an empty or successful state (functionality review, Batch F):
  - Memory import reported the counts the agent actually returns (it always said 0), and memory switched off shows a banner instead of a successful empty import
  - Memory lists, Cluster Knowledge, SLOs, plan templates, durable-run approvals, Toolbox Skills/MCP and view history show load and save errors with a reason, and forms stay open on a refused save
  - Learned runbooks, patterns and incidents can be forgotten (admin-gated on the agent)
  - SLOs without data show as NO DATA instead of disappearing; status comes from the agent's alert level, with hours of budget left at the current rate
  - Archived inbox items can be restored; `?preset=needs_approval` links map to `needs_attention`
  - `view_validation_warning` is shown as a warning toast
- Investigation cards show each piece of evidence with its stance and source; contradicting evidence was listed with a "+" as if it supported the cause. A 0% confidence ("nothing supports this") is shown instead of hidden
- Logs: no dropped or duplicated lines while following, previous-container logs are marked, and a stream the server closed offers Reconnect
- Watches relist after a 410 instead of keeping deleted objects, and replayed `ADDED` events update stale copies
- The terminal opens the app container with a picker for regular and debug containers, attaches node terminals to the node's debug pod, and stays pinned to the pod's cluster
- States that read as healthy before anything was checked now say so: alerts say "Checking alerts…", the Pulse report names lists it couldn't read, and an unchecked fleet no longer scores 100 "Healthy"

### Tests
- `agentEvidenceContract.test.tsx` renders the investigation payloads pulse-agent generates from its own code (`src/kubeview/__fixtures__/agent-contract/investigation.json`)

## v2.34.0 (2026-10-22)

Paired with pulse-agent v2.34.0 and pulse-operator v0.11.0. Pull requests #140–#142.

### Added
- Durable approvals can be answered where they show up. Runs waiting on an approval gate are listed at the top of Pulse Agent → Runs with Approve and Deny, and the agent's new inbox item for a waiting run carries the same buttons. Before, the only place to answer was the plan panel that started the run, while it stayed open; otherwise the run timed out to needs_escalation with nobody asked. Approving asks first, naming the phase and target, because an approved phase may change the cluster (pulse-agent #172)
- Start a durable run from an inbox item: a finding whose kind has a plan offers "Run … durably", which runs that plan against that finding and says which phases will stop for approval (pulse-agent #172)
- "Run durably" in the plan panel takes a target (what to investigate, namespace, kind, name). It used to start the plan with an empty incident

### Fixed
- **Create, Quick Deploy and Helm wrote to the local cluster while another was shown.** They built URLs from the local API base, so with a remote cluster active the screen showed one cluster and the Deployment, Service, Route, Helm install job or chart repository went to another; these calls also skipped impersonation. They now go to the cluster on screen, with impersonation, and deploy/install progress stays on the cluster the resource was created in. Helm queries are keyed by cluster
- **"Restart" on a pod deleted it in one click**, and for a pod no controller owns, nothing recreates it. It now asks first: for a managed pod it names the controller that will replace it; for an unmanaged one it says the pod will be gone for good and the button reads "Delete pod". The delete is pinned to that pod's uid and resourceVersion
- **Scaling wrote a count computed from cached replicas.** Two quick clicks, or an HPA, could produce a count nobody chose. The patch now carries the resourceVersion it was computed from, so a stale scale gets a conflict instead of applying
- **A failed delete in agent tables looked like success**: errors were caught and the dialog closed. Failures are now shown and the dialog stays open. Rows listed from the active cluster are deleted only if still the same object; rows the agent sent (from its own cluster) are refused while another cluster is active

## v2.33.0 (2026-10-18)

Paired with pulse-agent v2.33.0 and pulse-operator v0.10.0.

### Added
- Episode cards lead with what changed. The change nearest to what broke (the same workload's rollout, or a ConfigMap it mounts) shows on the card without expanding it, with how long before the cause began. Expanded, the change list comes first, most relevant first, tagged with how each change relates. A rollout offers "Roll back", which asks Pulse to do it through the usual confirmation (pulse-agent #164)
- The scanner list describes the agent's new scanners: unusual-for-this-workload, storage, routes & DNS, admission webhooks and maintenance blockers (pulse-agent #163, #165)
- The "Pulse is not seeing everything" banner says how to fix each blind scanner ("To fix: set spec.agent.allowSecretAccess: true …"), from the agent's new `remedy` field (pulse-agent #162)

### Fixed
- A finding that arrives with an id already on screen updates it in place instead of adding a duplicate and an unread count. The agent now replays standing findings on connect, so a reload no longer drops them

## v2.32.0 (2026-10-17)

Paired with pulse-agent v2.32.0 (migration 037 moves saved dashboards to the 12-column grid) and pulse-operator v0.9.0. Upgrade agent and UI together.

### Dashboards
- Dashboards render on a 12-column grid: thirds, halves, quarters and sixths. Exported views carry `gridColumns`; files exported before this release are rescaled when imported (#133)
- Metric cards with a query say "2× usual" when today is well off that query's median over the last day. The comparison is colored by threshold direction, and the usual value shows on hover. Charts that are zero for their whole range collapse to one line ("0 throughout the last 1h") and expand when a value appears (#134)
- A live "Needs attention" strip at the top of each dashboard lists widgets past their thresholds (#130)
- After the agent edits a dashboard, a banner says what changed, with undo (#131)
- Cells fit their content, each widget is framed once, and instant data charts as categories (#128). Lower-is-worse thresholds are colored correctly, and counts show as counts (#129). Agent node maps and chart series render, and the grid sizes to its container (#126, #127)

### Render service
- `render/` and `Dockerfile.render` add a service that screenshots a draft dashboard through the new `/preview` route, with the requesting user's token, so the agent's view designer can see a page before saving it. It holds no cluster credentials. pulse-operator deploys it with `spec.render` (#132)

### Fixed
- A chart with a query but no seeded series showed "Fetch error" and never drew (#134)
- Add agent installation diagnostics to the readiness page, with explicit unknown/failed checks, service-account scope, remediation, authenticated retries and previous-report labeling after refresh failures.
- Incident lifecycle separates action execution from recovery, joins verification to its exact action and postmortems to their incident, and presents hypotheses, reported evidence, context fetch failures and refresh explicitly.
- Cluster switching separates query caches/view lifetimes, binds generic resource actions and core YAML/log/terminal requests to the displayed cluster, clears retained resource/Argo contexts, and rejects unknown targets.
- Deletion no longer scales workloads to zero before a potentially failing DELETE; generic deletion passes object identity preconditions and bulk failure rows remain visible.
- Chat retries survive socket replacement; disconnect cancels retries and late version errors.
- Bounded chat requires approval without a verified category. Monitor controls report server policy and pause state, including visible failures; unsupported remote resource-context chat fails closed.

### Documentation
- Refresh living setup, security, API and component documentation; label historical designs/releases and remove stale counts, nonexistent APIs, and unsupported security guarantees.

## v2.31.0 (2026-09-01)

### The plan dialog speaks the whole graph
- Each phase row gains `depends_on` (phases with no unmet dependencies run together as one wave on the durable path), `branch_on` with a "value: skill" branches editor that appears once a branch key is set, and `subplan`, which runs a whole other plan as the phase under its own approvals and history
- Empty graph fields are dropped from the payload rather than stored as empty strings; malformed branch lines are skipped rather than corrupting the mapping. Paired with agent v2.31.0, where creating plans on the cluster also stops returning 500 (the create endpoint wrote into a read-only directory)

## v2.30.3 (2026-09-01)

### Paired release
- No UI changes. Tracks pulse-agent v2.30.3 — an API docs gate that can fail, and the seven endpoints it had been missing

## v2.30.2 (2026-09-01)

### Paired release
- No UI changes. Tracks pulse-agent v2.30.2 — Temporal tests that can run where CI runs

## v2.30.1 (2026-09-01)

### Paired release
- No UI changes. The agent and UI ship under one version number, so this tracks pulse-agent v2.30.1 — routing no longer makes a Prometheus call whose result it discarded, which was failing the selector latency gate

## v2.30.0 (2026-09-01)

### Durable runs you can see and stop
- A new Runs tab lists every durable workflow run, from Temporal's own visibility store rather than a second Pulse table that would drift out of sync with what actually ran. Pulse had been executing fixes on Temporal with nothing in the console to show for it: a run that survives an agent restart is only worth something if someone can see that it survived, and a run wedged waiting on an approval nobody knew about had no stop button at all
- Rows are labelled from the memo the agent attaches — "restart_controller on web-1 in payments" rather than "incident-f-3a9c". Runs predating memo still list, unlabelled, because a missing label beats a missing row
- Cancel is confirmed with what it actually does. Cancelling an incident run is not "stop watching": the workflow rolls the fix back from its snapshot and records a `cancelled` verdict. A button that mutates a production cluster should say so before the click, so the confirmation names the rollback and a test holds that wording in place

### Releases are now a consequence of tagging
- `release.yml` creates the GitHub Release from the tag's own CHANGELOG section on tag push. Doing it by hand meant it was skipped: v2.28.0 was tagged and shipped with neither a Release nor a changelog section. pulse-agent's `version-sync.yml` compares the two repos' latest *releases* to catch agent/UI skew, so it was comparing stale numbers and reporting green about a pair it no longer measured

## v2.28.0 (2026-09-01)

### A downgraded verdict that the UI hid
- The agent retroactively downgrades a `verified` fix when the same condition returns inside the recurrence window, emitting `verification_status: verified_then_recurred` and a separate `recurred` count in the fix success rate. The UI had no rendering for either value — the lifecycle drawer's action path dropped the unknown status into "pending", so a fix that came back looked like one still waiting to be checked
- Verification status unions extended across `monitorClient`, `fixHistory` and `analyticsApi`, with `verification.recurred` optional on `FixHistorySummary` so an older agent that never sends it still renders
- `verificationStatusLabel()` renders the raw token as "verified, then recurred" — truncating it to "verified" would flip its meaning (#118)
- Recorded retroactively: this shipped under tag v2.28.0 with no changelog section, which is the gap `release.yml` now closes

## v2.27.0 (2026-08-25)

### Plans can be created here, not just edited
- The Plans tab could edit and delete investigation plans but never create one, so a new incident type meant editing repo YAML and waiting for a release. `CreatePlanDialog` adds a create form with repeatable phase rows, mirroring the server's `incident_type` validation client-side so the error arrives while typing rather than as a 400 from `POST /plan-templates`
- Plan writes are versioned server-side, so the plan drawer gains a History toggle backed by `GET /plan-templates/{type}/versions` — a plan edit is reversible for the first time

### Why a phase went partial, not just that it did
- The Plans tab could render "3 partial" and never answer *why*. The agent computes exactly which declared `produces` fields a phase failed to return; the UI now renders `contract_missing` beneath the phase breakdown, next to the `Produces:` declaration it is the counterpart to

## v2.26.1 (2026-08-25)

Version-parity release with pulse-agent v2.26.1 (harness deny policy). No UI
changes — agent and UI ship one version number, and CI now fails a release
where the two diverge.

## v2.26.0 (2026-08-25)

Version-parity release with pulse-agent v2.26.0. No UI changes.

## v2.24.0 (2026-08-24)

### A watch storm that retried the same expired resourceVersion twice a second
- Measured live on the dev cluster: the pods, deployments and PVC watches reconnected every ~0.5s for hours — each upgrade succeeded (HTTP 101 in the nginx log) and died immediately, always resending the same expired `resourceVersion`
- Two bugs compounded. The API server reports an expired version as an ERROR *event* — a `Status` object with `code: 410` — followed by a normal close, but `onclose` only cleared the stored version on close code 1008 or a reason containing "410", so the stale version was resent forever. And `onopen` reset the backoff counter, so the always-successful upgrade pinned the retry delay at 1s — the storm was the backoff working as written
- `onmessage` now handles `type: 'ERROR'`: a 410 (or "too old"/"Expired" message) clears the stored version so the next connect starts fresh, and the `Status` object is not forwarded to resource callbacks, which expect resources
- The backoff counter now resets only when a genuine event arrives — an upgrade that dies eventless proves nothing about health, so repeated failures back off to the 30s cap instead of hammering the proxy

### The detail page had its own chat too
- `GenericDetailLayout` embedded an `InlineAgent`, so opening any resource detail page while the Pulse AI sidebar was open showed **two message boxes about the same resource**, each with its own connection state. Same fault as the episode card, one screen over
- The three suggested questions were the useful part; the second input was not. They are now buttons that open the sidebar and ask there, carrying the resource kind, name, namespace and GVR
- `AmbientInsight` stays. It is a generated insight panel, not a conversation — content rather than a second place to type
- Both call sites now go through one `askPulse(prompt, context)` helper, so the "open the sidebar, connect, send" sequence cannot drift apart between them
- `InlineAgent` itself is gone — 278 lines whose only remaining importer was its own test. Nothing embeds a chat any more, and keeping a component whose whole purpose is to embed one invites the duplication straight back

### Two places to have the same conversation
- An episode card embedded its own **"Ask about this Episode"** chat while the Pulse AI sidebar sat open beside it with its own input. Two inputs, two conversations, two connection states — and nothing on screen to say which one to use. The previous change made it worse by putting an inline chat on *every* episode rather than only investigated ones
- **"How do I fix this?"** now opens the sidebar in chat mode and sends the question there. The card no longer renders a chat of its own, investigated or not
- The sidebar wins because it persists across navigation: an answer about this cause is still there after you follow it to the Timeline or a pod. An inline panel dies with the card that owns it
- It sends through `connectAndSend`, not `sendMessage` — if the sidebar was collapsed the socket may not be up, and `sendMessage` sets "Agent not connected" and discards the text rather than waiting

### An episode card with nothing to do
- The card said what was wrong — cause, symptom count, blast radius, recurrence — and then offered **"What else changed"** and **"Dismiss"**. Look at history, or make it go away. Neither fixes anything, while the symptoms underneath it carried Approve buttons. Actions on the symptoms and none on the cause is exactly backwards, and it is why the causal model never reached the operator's hands
- Two gates kept the agent out of reach. It rendered *inside* the investigation block, so it existed only once an investigation had already run; and the expand chevron was gated on `symptoms.length > 0`, so an episode explaining nothing had no chevron at all and therefore no route to anything. `ControlPlaneNodeMemoryHigh` on the reference cluster was exactly that: two links, neither of which acts
- Every episode now carries **"How do I fix this?"**, which opens the agent with what the card already knows — cause, symptom count, namespaces, recurrence, and what changed just before — so it is not paid to re-derive any of it before answering the one question the deterministic layer cannot
- The chevron is available whenever there is something to collapse, so an agent opened on a symptomless episode can be closed again

### Removed the legacy dock adapter, two dead components, and a stale redirect
- `uiStore` carried a "Legacy adapter — DEPRECATED" block: seven members (`dockPanel`, `dockWidth`, `dockFullscreen`, `openDock`, `closeDock`, `setDockWidth`, `toggleDockFullscreen`) with a comment listing seven files still to migrate. **All seven had zero callsites** — the migration was finished and only the adapter was left. Gone, along with the now-unused `DockPanel` type
- Two components nothing imported: `PredictionCard.tsx` (145 lines) and `NodeTable.tsx` (132 lines)
- The `toolbox → /agent` redirect. The other nine `Navigate` uses stay: seven are parameter-validation guards in `resourceRoutes` (`if (!gvr) …`), one is the `/` landing, one is `path="*"`. Deleting those would render broken components on malformed URLs, not tidy anything
- Two tests covered the removed adapter. The `logs` path was already covered by `openBottomDock`, but the **agent** path was not — deleting outright would have quietly dropped the only coverage of "opening the agent sidebar puts it in chat mode", so that is now asserted against the modern API instead

### An episode says what else changed
- `/timeline` correlates alerts, events, rollouts and config changes — 2,472 entries and 84 correlated incidents on the reference cluster — and it is the page that answers "what else happened when this started". It had **one inbound link in the whole app**, so the question every finding leads to was a URL you had to know to type
- Episode cards now link to it, scoped to a range that actually covers the cause's onset. The Timeline's own 6h default would silently exclude a cause that began fourteen hours ago, which is the case that most needs the surrounding context
- A `Math.max(0, …)` guarding against clock skew came back out: it passed its own mutation test, because negative hours already fall through the first branch. Second time this exact dead guard has appeared in this codebase

### "ACM not detected", before ever looking
- `detectACM` was wired only to a button. Nothing ran it on mount, so Fleet rendered **"ACM not detected — show installation instructions"** purely from the store's initial `acmAvailable: false`
- The reference cluster is an ACM hub: `MultiClusterHub` Running for 354 days, v2.17.0, *"All hub components ready"*, one `ManagedCluster` registered, 62 ACM CRDs, and the endpoint the detector calls returning 200. Fleet told the operator ACM was absent and offered YAML to create a hub that already existed — applying it would have been a genuinely bad outcome
- Detection now runs on mount, and the page does not claim absence until it has actually looked. `acmAvailable: false` alone cannot tell "we looked and it is not there" from "we have not looked", so the store tracks `acmChecked` as a separate fact
- Same family as the rest of this UI's confident empty states — a default rendered as a finding — and the fourth instance found this session

### "Firing 0" while it could not see the alerting backend
- The Alerts page rendered `Firing 0 · Pending 0 · Silenced 0 · Alert Rules 0` in bold numerals directly above its own message, *"Backend unavailable"*. A count is a claim, and zero at the moment we have no data tells an operator the cluster is quiet precisely when we cannot see whether it is
- The same failure the posture bar had on the front door, and the opposite of what the Compute page already does — it renders `Unknown` and `No data` rather than inventing numbers. This follows that in-house precedent: every tile reads `—` in muted slate when the backend is unreachable
- A real zero is still reported as zero. Turning genuine quiet into "unknown" would be the same lie pointing the other way
- An explicit guard stopping the alarm border lighting on an unknown came back out: a mutation test passed with it removed, because the failed query leaves the alert list empty and the count is already zero. The assertion stays, guarding a different mistake — making the border react to the error state itself

### "No alerts firing", sourced from a failed request
- Administration rendered a green **"No alerts firing"** badge on a cluster whose alert backend it could not reach. The query swallowed its own failure — `if (!res.ok) return []` — so an unreachable Prometheus produced an empty list and the Overview read it as good news
- Third instance of the same failure in this UI: the posture bar said "All clear", the Alerts tiles said "Firing 0", Administration said "No alerts firing" in emerald. Absence of data presented as absence of problems, on the page an operator opens to ask whether the cluster is healthy
- The query now throws so the failure exists to be read, and the badge only appears when the request actually succeeded. Otherwise: *"Alert status unavailable — could not reach Prometheus"*
- A real quiet cluster still gets its all-clear. Turning genuine quiet into a permanent unknown would be the same lie pointing the other way
- The presentation fix alone was not enough: restoring `return []` passed every prop-driven test in the file, because `alertsUnavailable` is a prop and the swallowing happens in `AdminView`. Two source-level assertions now cover the seam

### The trust page showed your preference as the agent's state
- With the agent reporting `effective_trust_level: 2`, the Pulse Agent page rendered **level 1's** summary — because `TrustPolicy` reads `useTrustStore`, this browser's localStorage preference, while taking only `maxTrustLevel` from the server. The front-door badge was fixed to read the agent's real level; the page that *configures* trust was not
- The summary now describes the level the agent is actually running at, and says so plainly when this browser has a different one selected. Hovering another level still previews that level — that is the point of hovering
- The level-1 sentence was also still wrong in its own right: *"suggests fixes with dry-run previews. It never acts without your approval."* Level 1 never enters `auto_fix`, so it suggests nothing and there is nothing to approve. The same falsehood as the old "Confirm" label, surviving in a second copy of the ladder that the relabel missed — now *"reports findings. You act on them; it never remediates on its own."*

### A cause that explains nothing led the queue
- Two control-plane memory episodes opened in the same second on the reference cluster: `HighOverallControlPlaneMemory` with **8 symptoms** and `ControlPlaneNodeMemoryHigh` with **none**. Neither can explain the other — equal causal layers — so symptom ownership went entirely to whichever claimed them first, and the loser still rendered as a full-width red cause card *above* the one doing the explaining
- Episodes are now ordered by how much they explain, and one explaining nothing drops the red alarm styling for neutral slate. An episode is a claim that one thing explains others; until it explains something it has made no claim, and dressing it identically spends the operator's attention on the wrong card
- It also reads **"explains nothing yet"** rather than "0 symptoms" — a bare zero reads like a count that failed to load
- The first version of this keyed off the asynchronously-loaded symptom list, so *every* card flashed grey "explains nothing yet" before flipping to red on each load. It now reads `symptom_count` from the list payload until the detail fetch answers. Caught by its own test failing only in the full suite run, then pinned deterministically with a detail fetch that never resolves

### Approve buttons for symptoms of a cause we had already named
- The Inbox showed **"4 fixes waiting on you"**, each with an Approve button, targeting exactly the four pods the same screen labelled *"Explained by the cause above — not separate problems"* under an open `HighOverallControlPlaneMemory` episode. Same pods, same restart counts, one screen
- Approving any of them restarts a pod whose cause is control-plane memory pressure; it crashloops again while the memory stays high. The agent's causal model knew that, and the panel with the buttons did not say
- A proposal that the agent marks `explainedBy` now reads **"Symptom of *&lt;cause&gt;* — fixing this treats the symptom, not the cause"**, beside the button rather than buried in the reasoning text
- The Approve button stays. A stopgap restart is sometimes the right call and it is the operator's to make — it is only wrong to ask them to make it blind

### The map took most of the first screen, and then moved it
- `WorldMap` hardcoded a 520px container. Measured against the reference cluster on a 1440x900 desktop: **57.8% of the viewport**, for a drawing of seven nodes — and it pushed Heartbeat, Healthy and the utilisation metrics below the fold. The front door led with a picture and hid the numbers an operator opens it for
- Now `clamp(280px, 42vh, 520px)`. On that same 1440x900 screen the map is 378px and all three readouts sit above the fold; on a 1280x720 laptop it is 302px; on anything shorter the 280px floor keeps it legible. The 520px ceiling means nothing changes on a large display
- Separately, PulseView's Suspense skeleton reserved `h-[420px]` for a map that renders at 520, so the whole page below it **jumped 100px** the moment the lazy chunk landed. Both now read one exported constant, and a test fails if the skeleton drifts back to a literal

### The trust ladder described a different agent than the one that ships
- Level 1 read **"Confirm — every action requires your explicit approval"**. The agent never enters `auto_fix` below level 2, so level 1 proposes nothing and there is nothing to approve. An operator who wanted supervised remediation read that, chose 1, and got an agent that did nothing at all — the `total_actions: 0` symptom, named right there on the control
- Level 2 read "Batch — low-risk auto-approved" and is in fact the level that asks: it proposes every fix and waits for you. The two were the wrong way round
- Levels 3 and 4 promised LOW/MEDIUM/HIGH risk tiers. Nothing implements them — `risk_level` exists only in investigation output and the fix path never reads it. What separates 3 from 4 is category filtering
- The ladder now reads: **0 Observe** (watches only, writes blocked), **1 Manual** (you act, the agent does not), **2 Propose** (proposes fixes, you approve), **3 Bounded** (fixes allowed categories itself), **4 Autonomous** (fixes anything it can). Behaviour is unchanged — the names were wrong, not the ladder
- `PulseView` kept its own copy of the level names, which is how the badge tooltip and Mission Control came to describe different agents. Both now render from one exported map, and a test fails if a screen starts restating the ladder again

### The trust badge on the front door reported a browser preference
- `Agent · Trust 1` came from `useTrustStore` — zustand `persist` on localStorage, keyed per hostname. It is sent to the agent when the monitor socket connects and **never read back**. So the badge showed what this tab had asked for, not what the agent was doing
- Two operators on one cluster could read two different trust levels off the same agent. Since the server-side floor is now `settings.monitor.max_trust_level`, both of them could be wrong about what it would do with nobody watching — on a badge whose entire job is to answer that question
- It now reads `effective_trust_level` from `/monitor/capabilities`, on the same query key Mission Control already uses, so the two screens cannot disagree. Falls back to the local value while the query is in flight, or against an agent too old to send the field
- `??` rather than `||`: trust 0 is Observe, the most restrictive setting there is, and it is falsy. An agent that dropped to 0 is exactly the case an operator most needs told
- Where the tab's request and the agent's reality diverge, the tooltip names the gap instead of leaving the operator to assume the badge is broken

### "All clear" was the loading state
- Before the first scan lands every count is zero, and the posture bar read zero criticals as health — on the landing page, as the first thing an operator sees. It rendered "All clear — 0 critical, 0 warnings | No scan yet" in one sentence, holding the evidence against its own claim
- There is now an `unknown` posture: **"Checking the cluster…"**, in neutral slate rather than green, with the reason still shown beside it. `unknown` is not a shade of green
- A real finding outranks not having scanned. Findings can arrive before `lastScanTime` is set, and reporting "checking" over a known problem would be the same lie pointing the other way
- Same failure the capability banner was built to prevent, one screen earlier: absence of data presented as absence of problems

### Relative times said "ago" twice, and sometimes counted backwards
- The status bar rendered `synced {formatRelativeTime(t)} ago` while the function already ends in "ago" — **"synced 26s ago ago"**, in the status bar of every page
- `formatRelativeTime` subtracted an agent timestamp from the browser's clock without a floor. Two machines, two clocks: a beat of skew rendered **"Last scan: -1s ago"** on the landing page. Anything under five seconds now reads "just now", which absorbs the skew and reads better besides
- The first fix added a `Math.max(0, …)` as well. A mutation test passed with it removed, proving it was dead code — the "just now" branch already covered the case — so it came back out

### A list says where each item is, not the whole ladder
- Every inbox row rendered all five lifecycle stages inline — `New › Triaged › Claimed › In Progress › Resolved`. Read down a real inbox that is the same five words on every row, taking more width than the finding's own title. Measured on the reference cluster at 32 open items, the phrase dominating the screen was identical on all of them
- The row now shows five dots filled to the current stage, and names only that stage. Position stays legible, the full ladder is on hover, and the stepper in the detail drawer — where one item's whole progression is the point — is unchanged

### The My Items pill printed an identity hash at you
- When the agent cannot resolve a real username it falls back to `user-<16 hex>` — stable, unforgeable, and exactly the right thing to key data on. It is not a thing to show a person. Observed live: the filter pill read **"My Items (user-5451b787f74974ba)"**, telling the reader nothing they did not know and spending half the pill's width to say it
- A real name is still shown. An opaque fallback, or no user at all, now reads simply "My Items"

### The session-expired modal could be raised but never lowered
- `session_expired` was added from seven call sites and removed from none outside the test suite, while every other degraded reason already cleared itself — `observability_unavailable` in the incident hooks, `polling_fallback` and `agent_unreachable` in agent notifications. So a single transient 401 pinned the modal for the life of the page
- Not a theoretical window: on a cluster whose API server is restarting and dropping TLS handshakes, a one-off 401 is routine. The operator is told their session expired while every request behind the modal succeeds. Reported from real use, twice
- A 2xx from behind the OAuth proxy is proof the session is good — the proxy would have answered 401 itself — so a success now retracts the claim. A 500 or a 403 does not: neither says anything about the session, and clearing on them would hide a genuinely expired one behind an unrelated fault

## [2.16.2] - 2026-08-21

### A long fix-failure message could blow out the "Fixes applied" row
- The failed-fix line in the Inbox's Fixes-applied banner rendered `Failed: ${error}` with no truncation. pulse-agent already cleans up Kubernetes API failures before they reach the UI, but nothing stopped an unexpectedly long message from wrapping past the row -- as a safety net, it is now clamped to a single line with the full text available on hover

## [2.16.1] - 2026-08-21

### "Started" now means when the condition began, not when Pulse noticed it again
- The episode banner and the inbox's cause card both measured "started"/"running" from `started_at` -- the moment Pulse opened *this* episode row, not the moment the condition itself began. Observed live: two alerts that had been firing for two days and two-and-a-half hours respectively both read "started 7s ago," because each had just reopened a fresh episode after a gap. A cause that has been happening for two days looked brand new
- Both now read `cause_started_at` when the agent reports it (from Prometheus, for firing alerts) and fall back to `started_at` for causes that don't -- matching the fallback the agent's own "what changed before this started" panel has used since v2.15.0

## [2.16.0] - 2026-08-21

### Being unreachable is not the same as being blind
- The capability banner said "Pulse is not seeing everything" for every degraded capability. That is right for a scanner that has stopped reporting and wrong for a missing notification channel, where the picture is complete and nobody will ever be shown it — an operator reading the old wording would go hunting a broken scanner. It now says **"Pulse cannot reach anyone"**, or names both when both are true

## [2.15.0] - 2026-08-21

### Approve a fix the agent proposed while you were asleep
- A **fixes waiting on you** strip above the inbox, listing what the agent proposed and nobody has answered. Trust level 2 means ask first, and the question used to be asked over a WebSocket with 120 seconds to reply — at 03:00 it was never answered, and the agent took no action at all. Proposals now outlive the moment, which only helps if there is somewhere to see them
- Above the inbox rather than inside it: an unanswered proposal is the one thing on the screen waiting on a *person*, and everything below it is waiting on the cluster
- Each row says what would be done and to what, then gets out of the way once answered. A fix that ran and failed says so rather than reading as success
- A refusal is shown as the agent worded it — the condition cleared, somebody else approved it first, no automated fix applies any more. Those are answers, not errors, and it re-reads the list rather than trusting what it had

## [2.14.0] - 2026-08-20

### Tracks pulse-agent v2.14.0
- No UI code changes. The episode panel, the front-door banner and the inbox's symptom collapsing were all built already and have had nothing to show: every finding on a real cluster arrived as an alert, and alerts could not head an episode. The agent fix makes episodes form, so these surfaces light up without touching them

## [2.13.0] - 2026-08-20

### Reset the inbox: count from now, keep the history
- A **Reset** control in the inbox header. It archives everything open, re-baselines every counting scanner and rescans, so what comes back is what is happening rather than what has ever happened. Nothing is deleted — archived items keep their rows and their history
- The confirmation names what it is about to take — "Archive 33 open items and count from now" — including pinned and claimed work, rather than asking a generic "are you sure?"
- Afterwards it says what it did: items archived, episodes closed, and whether the rescan ran. A reset whose rescan failed says so instead of handing back a blank page that reads as data loss

## [2.12.0] - 2026-08-20

### The episode card shows the work already done, and can be cleared
- The card now shows the investigation the agent already ran against the cause — suspected cause and recommended fix, or the error if it failed. A failed attempt is shown rather than hidden: an empty panel reads as "nothing worth investigating", which is the opposite of what happened
- Ask a follow-up without re-explaining anything. The prompt carries the cause, blast radius, recurrence and what changed just before, so the agent answers the one question the deterministic layer cannot — what to do about it — rather than re-deriving what the card already says
- A **Dismiss** control, because until now the only way an episode ended was its cause resolving. If the cause returns it opens a new episode, so dismissing cannot hide a problem that comes back

## [2.11.0] - 2026-08-20

### Episodes show what changed and how often
- An episode now lists the config, RBAC and deployment activity from the half hour before it started, each marked with how long before — `−2m cluster-admin granted to svc/deployer`. Labelled *not necessarily the cause*, because it reports what happened nearby and leaves the inference to the reader
- The bare `recurring` badge is now the sentence that matters: `6 times in 11h · every 2h`. A cadence is only shown when the returns are regular enough to be one; irregular recurrence says how often but invents no pattern
- Both fields are optional, so an agent that sends neither still renders the episode

### One front door
- An open episode now appears at the top of Cluster Pulse, above every tile, with one click through to it. The episode panel lived only inside the Inbox tab, so at 03:00 you still landed on the dashboard and had to know to go looking — which was the audit item, not what had been built
- Archived items say why. Anything expired for inactivity carries the reason in a tooltip, and the archived view explains the 48-hour rule. Work that moves on its own has to account for itself
- The scanner drawer describes all 27 scanners; `trend_memory`, `trend_disk`, `trend_hpa`, `trend_errors` and `slo_burn` had none and rendered as bare toggles

## [2.10.0] - 2026-08-20

### Episodes in the inbox
- Open episodes now sit above the queue: a cause with the findings it explains folded underneath, labelled as not separate problems. During a real control-plane outage the monitor produced fourteen findings in one second — nine `Deployment degraded` rated critical and one etcd warning that caused the other thirteen, which did not make the top thirteen by priority
- Every symptom carries a **Not related** control. It records that the correlation was wrong and never re-attaches — an operator correcting it is the only ground truth the agent gets about its own causal model
- Symptoms are collapsed out of the list below, with a count of how many were folded away. Items vanishing from a work queue with no explanation is its own way of losing trust
- New capability banner: when a scanner or the AI backend has been failing, it says so above the queue rather than as another row, and states that anything the broken scanner covers is unknown rather than clear
- Scanner drawer describes `control_plane` and `degraded`

## [2.4.1] - 2026-04-18

Scrollbar and ResourceBrowser fixes.

### Fixed
- **Scrollbar CSS rewrite** — removed `scrollbar-color` property that caused Chrome 121+ to ignore `::-webkit-scrollbar` pseudo-elements, resulting in gray 15px default scrollbars instead of 6px violet
- **`.openshiftpulse` class missing from DOM** — all custom scrollbar CSS was scoped to this class but it was never applied to the Shell root element
- **ResourceBrowser scroll** — added `flex flex-col` to sidebar container and wrapped views + dashboards + resource groups in a single scrollable body so users can scroll through all content
- **ResourceBrowser `min-h-0`** — prevents flexbox from refusing to shrink below content height

### Stats
- **1,942 tests** across 162 test files
- Selector routing: 55/55 (100%)
- Release gate: all 15 scenarios PASS

---

## [6.2.0] - 2026-04-14

ORCA UI Surfaces release matching Agent v2.3.0.

### Added
- **Postmortems tab** in Incident Center — auto-generated postmortem reports with timeline, root cause, blast radius, and prevention recommendations
- **Impact Analysis** (`/topology`) — dependency graph visualization with blast radius overlays and change risk scores
- **Plans tab** in Toolbox Skills — view, edit, and delete investigation plan templates
- **SLOs tab** in Toolbox — CRUD for SLO definitions with live Prometheus burn-rate queries
- **Agent Intelligence section** in Analytics — unified view with routing decisions, fix strategies, and learning feed
- **Investigation progress** — real-time phase updates during multi-phase investigations
- **Deploy risk badges** — findings display change risk scores from recent deployments
- **Skill badges** — tools in the catalog show which skill(s) they belong to

### Stats
- **1,934 tests** across 163 test files, **53 E2E scenarios**
- **122 tools** (86 native + 36 MCP), **7 skills**, **18 scanners**
- **0 package CVEs**, all Red Hat UBI images

---

## [6.0.0] - 2026-04-10

Major release matching Agent v2.0.0.

### Added
- **Toolbox page** (`/toolbox`) — 6 tabs replacing `/tools` + `/extensions`: Catalog, Skills, Connections, Components, Usage, Analytics
- **Skill attribution footer** on chat responses — shows which skill handled each query
- **Follow-up suggestion pills** — context-aware follow-up prompts after each agent response
- **Welcome message** with dynamic capability counts on first connect
- **Capability change toast notifications** when agent capabilities change (new tools, skills, MCP connections)
- **Skill detail drawer** — inline editor, version history, diff viewer, clone, delete
- **MCP toolset toggles** with checkboxes in Connections tab
- **Prompt Audit section** in Analytics tab — token cost breakdown per prompt section
- **Source badges** (native/mcp) throughout Catalog, Usage, and Analytics
- **Arrow key tab navigation** and ARIA improvements across Toolbox and Agent Settings

### Fixed
- **UX review blockers** — 5 blockers resolved (tab focus, drawer keyboard trap, empty states, badge contrast, scroll restoration)

### Stats
- **1,934 tests** across 162 test files
- **111 tools** (75 native + 36 MCP), **4 skills**, **19 component types**
- **0 package CVEs**, all Red Hat UBI images

---

## [5.21.0] - 2026-04-10

### Added
- **Toolbox page** (`/toolbox`) — consolidated hub replacing `/tools` with 6 tabs: Catalog (all 111 tools with native/MCP source badges and search), Skills (4 skill packages with inline editor, version history, diff viewer, routing tester), Connections (MCP server management with 11 toolset toggles), Components (19 component kinds by category with mutation support), Usage (tool invocation audit log with source column), Analytics (merged tool + skill + handoff stats)
- **Skills system** — 4 skill packages (sre, security, view_designer, capacity_planner) with hot reload, intent-based routing, version history, clone, and REST API (`GET /skills`, `GET /skills/{name}`, `PUT /admin/skills/{name}`, `DELETE /admin/skills/{name}`, `POST /admin/skills/{name}/clone`, `POST /admin/skills/test`, `GET /admin/skills/{name}/versions`, `GET /admin/skills/{name}/diff`)
- **MCP integration** — OpenShift MCP server with 11 toolsets, 36 tools including Prometheus queries and Helm management; `POST /admin/mcp/toolsets` for toggling toolsets on/off
- **Component registry** — `GET /components` endpoint listing all 19 component kinds with schemas; Components tab in Toolbox for browsing and editing
- **Follow-up suggestions** — agent provides contextual follow-up suggestions after each response
- **Welcome message** — agent sends a welcome message on first connect with capability overview
- **Capability change toasts** — toast notifications when agent capabilities change (new tools, skills, or MCP connections)
- **Agent Settings tabs** — expanded to 5 tabs: Settings, Scanners, Memory, Views, Evals

### Changed
- **Tool count** — 111 tools total (75 native + 36 MCP), up from 102
- **`/tools` route** redirects to `/toolbox`; `/extensions` redirects to `/toolbox?tab=skills`

### Stats
- **1,934 tests** across 162 test files (+52 new tests)
- **0 package CVEs**, all Red Hat UBI images

---

## [5.8.0] - 2026-03-26

### Fixed
- **Silent catch blocks** — replaced 8 empty `catch {}` blocks with proper error surfacing via toasts or console warnings; OperatorCatalog now only swallows 409 Conflict
- **Clipboard copy feedback** — PromQL copy in AlertsView no longer shows success toast on failure; all clipboard operations use shared `copyToClipboard()` helper
- **window.prompt replaced** — Add Label dialog uses styled modal with separate key/value inputs instead of native `window.prompt()`
- **RBAC dead ends** — disabled buttons now show tooltips explaining missing permissions instead of being hidden
- **ErrorBoundary contextual messages** — categorizes errors as network/chunk/render with contextual recovery suggestions

### Added
- **WelcomeView error recovery** — cluster connection errors now show Retry button, proxy hint, and Administration link
- **WelcomeView capabilities** — all 13 capabilities visible by default, all clickable (no more dead-end rows)
- **TableView empty states** — enriched with EmptyState component, RBAC-gated Create button, namespace hints
- **TableView filtered empty state** — shows "0 of N match" with active filter summary
- **LogsView empty state** — troubleshooting guidance when no pods match selector
- **AlertsView + FleetView empty states** — contextual guidance for each tab
- **DetailView breadcrumbs** — `Kind / namespace / name` navigation replacing lone back button
- **Tab titles with context** — tabs show `nginx (Deployment)` instead of just `nginx`
- **Unsaved changes warning** — `useUnsavedChanges` hook with `useBlocker` + `beforeunload` for YAML editors
- **Lazy component error boundaries** — NLFilterBar, AmbientInsight, InlineAgent wrapped in individual ErrorBoundary + skeleton fallbacks

### Stats
- **1687 tests** across 125 test files (+81 new tests)
- **0 package CVEs**, all Red Hat UBI images

---

## [5.3.0] - 2026-03-25

### Added
- **Claude Harness** — optimizations for getting the most out of the agent:
  - Dynamic Tool Selection: 8 categories (diagnostics, workloads, networking, security, storage, monitoring, operations, gitops), reduces 54→15-25 tools per query
  - Prompt Caching: system prompt + runbooks cached via `cache_control: ephemeral` (~90% cost reduction)
  - Cluster Context Injection: pre-fetches node count, namespaces, OCP version, failing pods, firing alerts (saves 2-3 tool calls)
  - Component Rendering Hints: guides Claude to focus on analysis, not data formatting
- **Version Contract** — `/version` endpoint returns protocol version, tool count, features; UI warns on mismatch
- **Deploy Script** (`deploy/deploy.sh`) — single command deploys both Pulse UI + Agent with matching auth tokens
- **Integration Test** (`deploy/integration-test.sh`) — 13-check verification: pods, health, version, tools, WS auth, nginx proxy, OAuth, Vertex AI, NetworkPolicy
- **HTML Dashboard Rendering** — agent-generated HTML renders in sandboxed iframe with expand/minimize
- **Build Cancel Button** — stop icon on running/pending builds, patches `status.cancelled: true`

### Fixed
- **WebSocket auth** — nginx injects WS token at proxy level (not via JS sub_filter)
- **nginx resolver** — static proxy_pass for WS locations (no variable-based routing)
- **Build logs** — uses OpenShift Build API instead of Pod API
- **Browser performance** — streaming deltas batched via requestAnimationFrame, MessageBubble memoized
- **SSRF IPv6** — dev proxy blocks IPv6 loopback, mapped, unique local, link-local

### Stats
- **1472 tests** across 97 test files
- **17 views**, 45+ routes
- **54 agent tools** with dynamic selection harness
- **0 package CVEs**, all Red Hat UBI images
- **13-check integration test** for deployment verification

---

## [5.2.0] - 2026-03-24

### Added
- **Dynamic UI Generation** — Agent tools render rich interactive components inline in chat:
  - `ComponentSpec` protocol: data_table, info_card_grid, badge_list, status_list, key_value, chart
  - `AgentComponentRenderer` maps specs to existing primitives (DataTable, InfoCard, Badge, MetricsChart)
  - `MarkdownRenderer` for text responses (headers, bold, code blocks, lists) — no external dependency
  - 4 tools enhanced: `list_pods`, `list_deployments`, `get_events`, `top_pods_by_restarts` return structured tables
  - Auto-colored status/severity columns in rendered tables
  - New WebSocket event type: `component` with tool-emitted specs
- **Cancel/Stop button** — Red square button (or Escape key) aborts running agent queries, saves partial response
- **Edit last message** — Pencil button loads last user message back into input for re-submission
- **Build logs** — Uses OpenShift Build API (`/apis/build.openshift.io/v1/.../builds/{name}/log`) instead of Pod API

### Fixed
- **Browser memory/performance** — Streaming deltas batched via `requestAnimationFrame` instead of per-token re-renders; `MessageBubble` wrapped in `React.memo`; message history capped at 100 in memory / 50 persisted
- **SSRF IPv6 bypass** — Dev proxy helmrepo endpoint now blocks IPv6 loopback, IPv4-mapped, unique local, and link-local addresses
- **Helm values** — Added `agent.serviceName` default to prevent template rendering error
- **Build log 404s** — Build view was fetching pod logs for build names; now uses correct Build API endpoint

### Stats
- **1472 tests** across 97 test files
- **17 views**, 45+ routes
- **54 agent tools** with 4 returning rich UI component specs
- **0 package CVEs**, all Red Hat UBI images

---

## [5.1.0] - 2026-03-24

### Added
- **AI Agent Integration** — Claude-powered SRE diagnostics and security scanning embedded in the Pulse UI:
  - Chat interface at `/agent` with SRE and Security modes
  - WebSocket streaming with thinking indicators, tool execution badges
  - Confirmation gates for write operations with plain English descriptions, risk levels, keyboard shortcuts (Y/N)
  - Context-aware "Ask Agent" action on every resource detail page
  - Namespace-aware quick prompts that adapt to selected namespace
  - Chat persistence across navigation (localStorage via zustand persist)
  - Copy button and timestamps on all messages
  - Full ARIA accessibility (role="log", role="article", role="alertdialog", aria-live)
- **Pulse Agent backend** ([pulse-agent](https://github.com/alimobrem/pulse-agent)) — 54 tools:
  - 39 read diagnostics: pods, nodes, deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Ingresses, Routes, HPAs, PDBs, LimitRanges, ReplicaSets, services (with endpoints), TLS certificates, operator subscriptions
  - Prometheus/PromQL queries via Thanos, Alertmanager alert triage
  - `top_pods_by_restarts`, `get_recent_changes` convenience tools
  - 9 write operations: scale, restart, cordon, uncordon, delete pod, rollback deployment, drain node, apply YAML (server-side apply with dry-run), create network policy (with dry-run)
  - Cluster ConfigMap audit trail with retry-on-409
  - 10 built-in runbooks (CrashLoopBackOff, ImagePullBackOff, OOMKilled, Node NotReady, PVC Pending, DNS failures, etc.)

### Security (from architecture + sysadmin review)
- Replaced wildcard RBAC `patch */*` with scoped rules (apps, batch, autoscaling only)
- Fixed event loop threading in WebSocket API (captured loop before thread)
- Added context field sanitization to prevent prompt injection
- Added 1MB message size limit on WebSocket receive
- Removed `force:true` from server-side apply
- Added dry-run validation to network policy creation
- Fixed NetworkPolicy to allow ingress on port 8080
- Added audit retry-on-409 with microsecond key precision
- Sanitized error messages (no internal details to client)
- Added reconnect jitter to prevent thundering herd
- Fixed handler memory leak in agentStore

### Changed
- Production nginx config proxies `/api/agent/` to pulse-agent service
- rspack dev server proxies `/api/agent` to `PULSE_AGENT_URL` (default localhost:8080)
- CommandPalette and WelcomeView include Agent entry
- README updated with AI Agent comparison row, 17 views, 54 tools

### Stats
- **1472 tests** across 97 test files
- **17 views**, 45+ routes
- **54 agent tools** (39 read + 9 write + 6 audit)
- **0 package CVEs**, all Red Hat UBI images

---

## [5.0.0] - 2026-03-24

### Added
- **Multi-Cluster Fleet Management** — 6-phase implementation:
  - Phase 1: Cluster-aware engine layer (query, watch, discovery, snapshot all gain `clusterId`)
  - Phase 2: Fleet Dashboard at `/fleet` with cluster cards, health scores, setup guide
  - Phase 3: Cluster Switcher in CommandBar with `Cmd+Shift+C`, StatusBar active cluster
  - Phase 4: Cross-cluster search in Command Palette, CompareView, FleetSnapshotView
  - Phase 5: FleetResourceView, FleetWorkloadsView, FleetAlertsView with correlation badges
  - Phase 6: ComplianceView with security matrix, certificate heat map, RBAC baseline, config drift
- **Health Score Engine** — composite 0-100 score from nodes, operators, alerts, pods
- **Fleet Engine** — `fleetList`, `fleetSearch`, `fleetCount`, `fleetAlertCorrelation` with Promise.allSettled resilience
- **Cluster Connection Manager** — `getClusterBase(clusterId?)` replacing hardcoded K8S_BASE, supports local/ACM-proxy/direct-proxy
- **Fleet Store** — ACM auto-detection, health polling (60s), cluster registration/switching
- **Enhanced ArgoCD** — sync failure details, external URLs, deployed images, pruning warnings, condition timeline, resource history panel, live state diff, Argo Rollouts (canary/blue-green), AppProjects
- **17 ArgoCD security fixes** from 5-agent review (SSRF validation, ARIA, sanitization, impersonation)

### Changed
- All engine functions (`k8sList`, `k8sGet`, `k8sPatch`, etc.) now accept optional `clusterId` — fully backward compatible
- WebSocket watch keys include cluster ID for multi-cluster isolation
- API discovery cached per-cluster instead of globally
- Snapshot capture supports `clusterId`, cross-cluster comparison
- Progressive disclosure: multi-cluster UI only appears when 2+ clusters connected

### Stats
- **1438 tests** across 94 test files
- **16+ views**, 40+ routes
- **0 package CVEs**, all Red Hat UBI images
- **6 custom agents**, 4 automated hooks

---

## [4.4.0] - 2026-03-24

### Added
- **Capacity Planning** — predict_linear() projections for CPU, memory, disk, and pods with days-until-exhaustion cards, trend sparklines, and configurable lookback (7d/30d/90d). New "Capacity Planning" tab in Compute view.
- **NodePool visibility for HyperShift** — Real NodePool panel with instance type, autoscaling, auto-repair, conditions. NodePool Health audit check. Instance type fallback via node label.
- **GitOps Repository readiness check** — Production Readiness now checks if ArgoCD is installed AND Git repo is connected in Pulse. Links to Admin → GitOps for setup.
- **ControlPlaneMetrics** in Admin Overview — API server latency (p99), error rate, etcd leader, WAL fsync sparklines.
- **ArgoCD in Pulse daily briefing** — Out-of-sync applications surface as attention items.
- **GitOps config tab** in Admin view (10th tab) for Git provider setup.
- **MetricGrid primitive** adopted across 16 files (18 replacements).
- **Full test coverage** — all views and components now have tests (DependencyView, LogsView, MetricsView, NodeLogsView, PodTerminal added).
- **6 custom agents** — deploy-validator, changelog-writer, api-compatibility, performance-auditor, screenshot-updater, migration-guide.
- **Automated hooks** — pre-commit/push tests, post-write lint, async deploy validation, screenshot capture on release.

### Changed
- **Welcome page** — Added GitOps and Timeline tiles, GitOps/ArgoCD and Incident Timeline capability rows, fixed security check count (9→10).
- **Command Palette** — Added GitOps entry, updated Admin subtitle with all 10 tabs.
- **Logo** — Replaced "P" letter with pulse/heartbeat line design (blue-violet gradient).
- **Compute view** — Refactored to tabbed layout (Overview + Capacity Planning).

### Fixed
- **Timeline TypeError** — guarded against undefined entries/correlationGroups on initial render.
- CHANGELOG.md updated with v4.3.0 entry (was missing).

### Stats
- **1347 tests** across 83 test files
- **77 health checks** (31 cluster + 46 domain)
- **15 views**, 35 routes
- **6 custom agents**, **4 automated hooks**

---

## [4.3.0] - 2026-03-24

### Added
- **ArgoCD deep integration** — 5-phase implementation: auto-detection, sync badges on every resource, `/gitops` view (Applications, Sync History, Drift Detection), Git provider abstraction (GitHub/GitLab/Bitbucket), three-option save dialog (Apply+PR / PR Only / Apply Only)
- **NodePool visibility for HyperShift** — Real NodePool panel replaces static info card, shows instance type, autoscaling, auto-repair, conditions. NodePool Health audit check.
- **Incident Correlation Timeline** — Unified timeline merging Prometheus alerts, K8s events, deployment rollouts, and ClusterVersion/Operator config changes with correlation groups
- **Admin Overview redesign** — Firing alerts banner, named degraded operators, recent Warning events, certificate expiry warnings, quota hot spots, cluster health score, loading/error states
- **Control Plane Metrics** — API server latency (p99), error rate, etcd leader status, WAL fsync duration sparklines
- **Helm chart** — One-command deployment with auto-generated OAuth secrets (`deploy/helm/openshiftpulse/`)
- **SECURITY.md** — Comprehensive security documentation (model, audit, RBAC, hardening, checklist)
- **GitOps config tab** in Admin view for configuring Git provider, repo, and token

### Changed
- **Typed K8s interfaces** — 50+ interfaces in `engine/types/`, reduced `as any` from 179 to 5 (97%)
- **AdminView split** — 1412→488 lines, extracted OverviewTab, OperatorsTab, UpdatesTab, SnapshotsTab
- **CSS cleanup** — Removed dead PatternFly deps (4 packages), centralized chart colors (`engine/colors.ts`), Card primitive adopted (89 replacements), terminal theme extracted to CSS variables
- **Container images** — All Red Hat UBI (replaced Docker Hub nginx), pinned tags (ose-oauth-proxy:v4.17, nginx:1.26-ubi9)
- **Dependencies** — Replaced deprecated `xterm` with `@xterm/xterm`, resolved 6 high-severity CVEs, pnpm audit: 0 vulnerabilities
- **Logo** — Replaced "P" letter with pulse/heartbeat line design
- **README** — Professional redesign with comparison table, collapsible sections, for-the-badge badges

### Fixed
- Back button uses browser history instead of hardcoded list path
- Quota parsing uses `parseResourceValue` for correct K8s quantity units (was showing 30000%)
- SecurityView adapted for HyperShift (skips TLS/encryption checks managed externally)
- Cluster-admin threshold now a named constant (was hardcoded 3)
- Alert filter state persisted in URL search params
- Deployments sorted unhealthy-first in WorkloadsView
- Multiple audit checks expandable simultaneously (Set instead of string)
- Channel selector uses dropdown instead of free-text input
- `parseQuantity` handles Ei, Pi, and decimal SI units
- CPU metrics use `kube_node_info` join for reliable node name matching

### Stats
- **1308 tests** across 76 test files (up from 1162/63 in v4.1.0)
- **77 health checks** (31 cluster + 46 domain)
- **15 views**, 35 routes
- **0 package CVEs**

---

## [4.1.0] - 2026-03-19

### Added
- **HyperShift / Hosted Control Plane support** — Auto-detects hosted clusters via Infrastructure resource (`controlPlaneTopology: External`). Adapts health checks, production readiness, and compute view for hosted control plane model.
- **Persistent topology badge** — "Hosted" pill in CommandBar visible on every view when running on a HyperShift cluster.
- **"Hosted Control Plane" badge** on Pulse daily briefing with tooltip explaining the hosting model.
- **Control Plane InfoCard** in Admin overview showing topology type (Hosted/Self-managed) and API server URL.
- **Snapshot topology tracking** — `controlPlaneTopology` captured in cluster snapshots and included in diff comparisons.
- **Prerequisites section** in README with OCP, Node.js, oc CLI, and browser requirements.

### Changed
- **Health checks adapted for HyperShift** — HA Control Plane, MachineHealthChecks, and Cluster Autoscaling checks skip on hosted clusters (irrelevant when CP is external). Production Readiness shows "Hosted Control Plane: Managed externally" as auto-pass.
- **Etcd backup check** auto-passes on HyperShift with "Managed by hosting provider" instead of SSH backup instructions.
- **Worker Nodes check** threshold adjusted to 1+ on HyperShift (vs 2+ on traditional) since all nodes are workers.
- **Machine Management section** hidden on HyperShift ComputeView with info block explaining NodePool model.
- **Machine API queries gated** — Machines, MachineSets, MachineHealthChecks, MachineAutoscalers, and ClusterAutoscaler queries disabled on HyperShift clusters (`enabled: !isHyperShift`) to avoid unnecessary API calls.
- **AdminView** unified to read `isHyperShift` from `useClusterStore` instead of deriving locally, matching all other views.
- **Create button hidden** for Nodes in resource browser (nodes are provisioned via MachineSet/NodePool, not created directly).
- **README rewritten** — Added 10 previously undocumented features, fixed stale test/health check counts, added all keyboard shortcuts, added prerequisites section.

### Fixed
- Control plane operator list on Pulse no longer shows missing operators as broken on HyperShift — only shows operators that actually exist in the cluster.
- Health check count corrected from 67 to 76 (Security view's 9 checks were previously uncounted).

### Stats
- **1162 tests** across 63 test files (up from 1128/61 in v4.0.0)
- **76 health checks** (31 cluster + 45 domain)
- **13 views**, 35 routes
- Build time: ~1s (Rspack)

---

## [4.0.0] - 2026-03-15

### Added
- **Project renamed** from ShiftOps to **OpenShift Pulse**
- **New logo** — Blue gradient P with sparkles (`docs/logo.svg`)
- **Favicon** — Inline SVG P letter in `public/index.html`
- **Welcome view** — Hero, cluster status, Pulse CTA, quick nav, start-here cards, all views grid, key capabilities showcase, keyboard shortcuts
- **Pulse view** — 4-tab cluster health: Daily Briefing (risk score ring, CP status, certs, attention items), Issues, Runbooks, Namespace Health
- **Security view** — 9-check security audit, policy status, vulnerability context
- **Admin view** — 9 tabs: Overview, Readiness (31 checks), Operators, Cluster Config (10 editable sections), Updates, Snapshots, Quotas, Certificates, Timeline
- **Cluster Snapshots** — Capture and compare cluster state (ClusterVersion, nodes, operators, CRDs, storage classes, RBAC, config)
- **Cluster Timeline** — Event timeline with 1h/6h/24h ranges, severity filters, namespace filtering
- **Production Readiness** — 31-check automated score across infrastructure, security, observability, reliability
- **Deployment Rollback** — Revision history with container image diffs, one-click rollback
- **Pod/Node Terminal** — WebSocket exec with GitHub-dark theme, command history, suggestions
- **Dry-Run Validation** — Server-side dry-run before applying YAML changes
- **Dock Panel** — Resizable bottom panel for terminal and log sessions
- **Resource Creation** — 5 modes: Quick Deploy, Templates, Helm, Import YAML, Installed operators
- **Operator Catalog** — Browse 500+ operators, one-click install with 4-step progress tracking
- **Smart Diagnosis** — 10 error patterns detected from pod logs with fix suggestions
- **User Impersonation** — `Impersonate-User` headers on all API calls, CRLF-sanitized
- **WebSocket watches** — Real-time resource updates with 60s polling fallback
- **OAuth proxy deployment** — 2 replicas, PDB, topology spread, zero-downtime, security hardened

### Security
- Passed 15-finding security audit (1 critical, 4 high, 7 medium, 3 low — all resolved)
- Helm command injection, SSRF, CRLF injection, path traversal, RegExp DoS — all fixed
- CSP, HSTS, X-Frame-Options, TLS verification, readOnlyRootFilesystem
