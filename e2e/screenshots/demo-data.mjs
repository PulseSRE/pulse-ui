/**
 * Sample data for README/Pages screenshots. Not a test fixture.
 *
 * Shapes follow the agent's real responses (API_CONTRACT.md). Titles and
 * remedies of the "degraded" findings were produced by the agent's own
 * scanner_health.explain_failure(), so the banner shows what the agent really
 * says. Everything else is an invented cluster ("shop" namespace): do not read
 * these numbers as measurements.
 */

const now = Math.floor(Date.now() / 1000);
const ms = (s) => s * 1000;

export const findings = [
  {
    id: 'f-degraded-maint',
    severity: 'warning',
    category: 'degraded',
    title:
      'Maintenance Blockers checks are off: Pulse is not allowed to list machineconfiguration.openshift.io/machineconfigpools',
    summary: 'Maintenance Blockers has failed its last 5 runs.',
    resources: [{ kind: 'Scanner', name: 'maintenance' }],
    autoFixable: false,
    confidence: 1,
    timestamp: ms(now - 900),
    remedy:
      "Grant Pulse read-only get/list on machineconfiguration.openshift.io/machineconfigpools — upgrade pulse-operator, whose agent role includes it, or add the rule to the agent's ClusterRole",
    unwatched: [
      'PodDisruptionBudget allows 0 disruptions with all pods healthy',
      'MachineConfigPool Degraded',
      'MachineConfigPool updating > 1 hour',
    ],
  },
  {
    id: 'f-crash-checkout',
    severity: 'critical',
    category: 'crashloop',
    title: 'Pod checkout-7c9d5f6b8-x2k4p crash-looping (6 restarts)',
    summary: 'Container checkout exits with code 1 seconds after start.',
    resources: [{ kind: 'Pod', name: 'checkout-7c9d5f6b8-x2k4p', namespace: 'shop' }],
    autoFixable: true,
    confidence: 0.95,
    timestamp: ms(now - 240),
  },
  {
    id: 'f-anomaly-cart',
    severity: 'warning',
    category: 'anomaly',
    title: 'Deployment cart memory working set well above its normal',
    summary: '1.9 GiB against a 7-day p95 of 610 MiB (3.1x its normal).',
    resources: [{ kind: 'Deployment', name: 'cart', namespace: 'shop' }],
    autoFixable: false,
    confidence: 0.82,
    timestamp: ms(now - 600),
  },
  {
    id: 'f-pvc',
    severity: 'warning',
    category: 'storage',
    title: 'PersistentVolumeClaim orders-db-data is not binding',
    summary: 'StorageClass gp3-encrypted has no provisioner on this cluster.',
    resources: [{ kind: 'PersistentVolumeClaim', name: 'orders-db-data', namespace: 'shop' }],
    autoFixable: false,
    confidence: 0.9,
    timestamp: ms(now - 1800),
  },
  {
    id: 'f-webhook',
    severity: 'warning',
    category: 'webhooks',
    title: 'Admission webhook policy-guard.example.io is slow',
    summary: 'p95 admission latency 2.4s; creates and updates in all namespaces wait on it.',
    resources: [{ kind: 'ValidatingWebhookConfiguration', name: 'policy-guard' }],
    autoFixable: false,
    confidence: 0.85,
    timestamp: ms(now - 1200),
  },
];

function item(id, f, extra = {}) {
  return {
    id,
    item_type: 'finding',
    status: 'new',
    title: f.title,
    summary: f.summary,
    severity: f.severity,
    priority_score: f.severity === 'critical' ? 90 : 60,
    confidence: f.confidence,
    noise_score: 0,
    namespace: f.resources[0].namespace ?? null,
    resources: f.resources.map((r) => ({ namespace: '', ...r })),
    correlation_key: `${f.category}:${f.resources[0].name}`,
    claimed_by: null,
    claimed_at: null,
    created_by: 'system:monitor',
    due_date: null,
    finding_id: f.id,
    view_id: null,
    pinned_by: [],
    metadata: {},
    created_at: Math.floor(f.timestamp / 1000),
    updated_at: Math.floor(f.timestamp / 1000),
    resolved_at: null,
    snoozed_until: null,
    ...extra,
  };
}

const queue = findings.filter((f) => !['degraded', 'crashloop'].includes(f.category));

export const inbox = {
  items: queue.map((f, i) => item(`inbox-${i}`, f)),
  groups: [],
  stats: { new: queue.length, total: queue.length, needs_attention: queue.length + 2, critical: 1 },
  total: queue.length,
  collapsedIntoEpisodes: 2,
};

export const episode = {
  id: 'ep-checkout',
  status: 'open',
  cause_category: 'workloads',
  cause_title: 'Deployment checkout rollout is failing (1/3 ready)',
  cause_finding_id: 'f-crash-checkout',
  cause_layer: 3,
  started_at: now - 300,
  cause_started_at: now - 300,
  ended_at: null,
  last_seen_at: now - 20,
  symptom_count: 2,
  namespaces: ['shop'],
  correlation_key: 'workloads:shop:checkout',
  recurrence_of: null,
};

export const episodeDetail = {
  episode,
  symptoms: [
    {
      episode_id: episode.id,
      correlation_key: 'crashloop:shop:checkout',
      category: 'crashloop',
      title: 'Pod checkout crash-looping',
      namespace: 'shop',
      attached_at: now - 240,
      detached_at: null,
      detached_by: null,
    },
    {
      episode_id: episode.id,
      correlation_key: 'slo_burn:shop:checkout-availability',
      category: 'slo_burn',
      title: 'SLO checkout-availability burning error budget 14x',
      namespace: 'shop',
      attached_at: now - 180,
      detached_at: null,
      detached_by: null,
    },
  ],
  changes: [
    {
      category: 'rollout',
      title: 'Deployment checkout rolled out revision 15 (image checkout:2.8.0)',
      namespace: 'shop',
      at: now - 540,
      seconds_before: 240,
      relevance: 'same workload',
      score: 0.95,
      kind: 'Deployment',
      name: 'checkout',
      rollback: { tool: 'rollback_deployment', namespace: 'shop', name: 'checkout', revision: 14 },
    },
    {
      category: 'config',
      title: 'ConfigMap checkout-config edited (payments.url)',
      namespace: 'shop',
      at: now - 660,
      seconds_before: 360,
      relevance: 'used by an affected workload',
      score: 0.8,
      kind: 'ConfigMap',
      name: 'checkout-config',
    },
    {
      category: 'gitops',
      title: 'Argo CD application shop-frontend synced',
      namespace: 'shop',
      at: now - 1500,
      seconds_before: 1200,
      relevance: 'same namespace',
      score: 0.4,
      kind: 'Application',
      name: 'shop-frontend',
    },
  ],
  recurrence: { occurrences: 1, recurring: false },
  investigation: {
    id: 'inv-1',
    status: 'completed',
    summary:
      'checkout 2.8.0 exits on start because PAYMENTS_URL resolves to an empty value after the checkout-config edit; revision 14 ran cleanly for 6 days.',
    suspected_cause: 'Rollout of revision 15 together with the payments.url ConfigMap change',
    recommended_fix: 'Roll checkout back to revision 14, then restore payments.url',
    confidence: 0.86,
    error: null,
    timestamp: now - 120,
    failed: false,
  },
};

const scannerNames = [
  'crashloop', 'pending', 'workloads', 'image_pull', 'daemonsets', 'anomaly', 'storage', 'ingress',
  'nodes', 'operators', 'maintenance', 'cert_expiry', 'security', 'alerts', 'slo_burn', 'oom', 'hpa',
  'audit_config', 'audit_rbac', 'audit_deployment', 'audit_events', 'audit_auth',
  'trend_memory', 'trend_disk', 'trend_hpa', 'trend_errors', 'trend_degraded',
  'stuck', 'webhooks', 'hot_loop', 'control_plane', 'degraded',
];
const counts = { crashloop: 6, anomaly: 3, storage: 2, webhooks: 1, workloads: 4, alerts: 9, degraded: 1 };

export const coverage = {
  active_scanners: scannerNames.length,
  total_scanners: scannerNames.length,
  coverage_pct: 100,
  categories: [],
  per_scanner: scannerNames.map((name) => ({
    name,
    enabled: true,
    finding_count: counts[name] ?? 0,
    actionable_count: Math.ceil((counts[name] ?? 0) / 2),
    noise_pct: 0,
  })),
};

// ---------------------------------------------------------------------------
// Checkout story for the "chat", "view" and "evidence" shots.
//
// These shots pin the browser clock (capture.mjs installs it at storyNow, UTC)
// so the times on screen match the story: revision 15 (checkout:2.8.0) rolled
// out at 14:02, 1 of 3 pods ready, new pods crash because checkout-config has
// no payments.url. Same invented cluster as above; not measurements.
// ---------------------------------------------------------------------------

const day = new Date();
const at = (h, m, s = 0) => Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, s);
export const storyNow = at(14, 21);
const rolloutAt = at(14, 2);
const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
const minutes = (from, to, stepMin = 1) => {
  const out = [];
  for (let t = from; t <= to; t += stepMin * 60_000) out.push(t);
  return out;
};
const span = minutes(at(13, 50), storyNow);

const readyPods = {
  kind: 'chart',
  chartType: 'line',
  title: 'Ready pods: checkout',
  description: `Revision 15 rolled out at ${hhmm(rolloutAt)}; desired 3`,
  yAxisLabel: 'pods',
  height: 150,
  series: [
    { label: 'ready', color: '#22c55e', data: span.map((t) => [t, t < at(14, 3) ? 3 : t < at(14, 4) ? 2 : 1]) },
    { label: 'desired', color: '#64748b', data: span.map((t) => [t, 3]) },
  ],
};

const errorRate = {
  kind: 'chart',
  chartType: 'area',
  title: 'HTTP 5xx rate: checkout',
  description: '5xx share at the route',
  yAxisLabel: '%',
  height: 150,
  thresholds: { warning: 1, critical: 5 },
  series: [{
    label: '5xx %',
    color: '#ef4444',
    data: span.map((t, i) => [t, t < at(14, 3) ? 0.3 + (i % 3) * 0.1 : 27 + ((i * 7) % 9)]),
  }],
};

// Two rev-15 pods in CrashLoopBackOff, restarts backing off: 6 + 5 = 11 by 14:21.
const backoff = [1, 1.5, 2.5, 4, 7, 12, 17];
const restartTimes = [
  ...backoff.slice(0, 6).map((m) => rolloutAt + m * 60_000),
  ...backoff.slice(0, 5).map((m) => rolloutAt + (m + 1) * 60_000),
];
const restarts = {
  kind: 'chart',
  chartType: 'line',
  title: 'Container restarts: checkout',
  description: 'Total across both revision 15 pods',
  yAxisLabel: 'restarts',
  height: 150,
  series: [{
    label: 'restarts',
    color: '#f59e0b',
    data: span.map((t) => [t, restartTimes.filter((r) => r <= t).length]),
  }],
};

const podTable = {
  kind: 'data_table',
  title: 'Pods: shop/checkout',
  resourceType: 'pods',
  gvr: 'v1~pods',
  columns: [
    { id: 'name', header: 'Name' },
    { id: 'revision', header: 'Revision' },
    { id: 'status', header: 'Status', type: 'status' },
    { id: 'ready', header: 'Ready' },
    { id: 'restarts', header: 'Restarts' },
    { id: 'age', header: 'Age' },
  ],
  rows: [
    { name: 'checkout-7c9d5f6b8-x2k4p', namespace: 'shop', revision: '15', status: 'CrashLoopBackOff', ready: '0/1', restarts: 6, age: '19m' },
    { name: 'checkout-7c9d5f6b8-p9w3n', namespace: 'shop', revision: '15', status: 'CrashLoopBackOff', ready: '0/1', restarts: 5, age: '18m' },
    { name: 'checkout-6f8b7d9c4-q7m2z', namespace: 'shop', revision: '14', status: 'Running', ready: '1/1', restarts: 0, age: '6d' },
  ],
};

const events = {
  kind: 'timeline',
  title: 'What changed around the rollout',
  timeRange: { start: at(13, 50), end: storyNow },
  lanes: [
    {
      label: 'Config',
      category: 'config',
      events: [{ timestamp: at(14, 0), label: 'checkout-config edited', severity: 'warning', detail: 'payments.url removed' }],
    },
    {
      label: 'Rollout',
      category: 'rollout',
      events: [{ timestamp: rolloutAt, endTimestamp: storyNow, label: 'Revision 15 (checkout:2.8.0)', severity: 'warning', detail: 'Progressing: 1/3 available' }],
    },
    {
      label: 'Events',
      category: 'event',
      events: [
        { timestamp: at(14, 3), label: 'BackOff x2', severity: 'critical', detail: 'Back-off restarting failed container checkout' },
        { timestamp: at(14, 9), label: 'BackOff x7', severity: 'critical', detail: 'Back-off restarting failed container checkout' },
      ],
    },
    {
      label: 'Alerts',
      category: 'alert',
      events: [{ timestamp: at(14, 5), endTimestamp: storyNow, label: 'SLO checkout-availability burning 14x', severity: 'critical' }],
    },
  ],
  correlations: [{ from: rolloutAt, to: at(14, 3), label: 'crashes start 1 min after rollout' }],
};

export const chatQuestion = 'Show me how checkout has been doing since the 14:02 rollout';

export const generatedView = {
  id: 'cv-checkout-since-rollout',
  title: 'Checkout since the rollout',
  description: `shop/checkout since revision 15 (checkout:2.8.0) rolled out at ${hhmm(rolloutAt)}`,
  // Full-width or half-width cells only, so the 6-column grid beside the open
  // chat stacks them in order instead of staggering them.
  layout: [readyPods, errorRate, restarts, podTable, events],
  positions: {
    0: { x: 0, y: 0, w: 6, h: 7 },
    1: { x: 6, y: 0, w: 6, h: 7 },
    2: { x: 0, y: 7, w: 6, h: 7 },
    3: { x: 6, y: 7, w: 6, h: 7 },
    4: { x: 0, y: 14, w: 12, h: 7 },
  },
  generatedAt: storyNow,
  view_type: 'custom',
  status: 'active',
  trigger_source: 'user',
  visibility: 'private',
};

const reply = [
  `Since revision 15 (\`checkout:2.8.0\`) rolled out at **${hhmm(rolloutAt)}**, checkout has been running on **1 of 3** pods.`,
  '',
  '- **Ready pods** fell from 3 to 1 within two minutes. Both new pods are in `CrashLoopBackOff` (11 restarts between them); the one still serving is on revision 14.',
  '- **5xx rate** went from 0.3% to about 31%, and the `checkout-availability` SLO is burning error budget at 14x.',
  '- **Two minutes before** the rollout, `checkout-config` was edited and `payments.url` removed.',
  '',
  'I opened **Checkout since the rollout** with these signals, the pods, and a timeline of what changed.',
].join('\n');

/**
 * What the agent sends on /ws/agent for chatQuestion, in order. Mirrors
 * agent_ws.py: tool results stream as `component` events, create_dashboard's
 * signal becomes `view_spec` + `view_updated` after the loop, then `done`.
 */
export const chatTurn = [
  { type: 'tool_use', tool: 'get_prometheus_query' },
  { type: 'component', tool: 'get_prometheus_query', spec: readyPods },
  { type: 'tool_use', tool: 'get_prometheus_query' },
  { type: 'component', tool: 'get_prometheus_query', spec: errorRate },
  { type: 'tool_use', tool: 'list_pods' },
  { type: 'component', tool: 'list_pods', spec: podTable },
  { type: 'tool_use', tool: 'get_prometheus_query' },
  { type: 'component', tool: 'get_prometheus_query', spec: restarts },
  { type: 'tool_use', tool: 'get_events' },
  { type: 'component', tool: 'get_events', spec: events },
  { type: 'tool_use', tool: 'create_dashboard' },
  ...reply.match(/[^\n]{1,40}\n?|\n/g).map((text) => ({ type: 'text_delta', text })),
  { type: 'view_spec', spec: generatedView },
  { type: 'view_updated', viewId: generatedView.id },
  {
    type: 'done',
    full_response: reply,
    skill_name: 'view_designer',
    tool_count: 6,
    duration_ms: 14_200,
    input_tokens: 21_400,
    output_tokens: 1_900,
  },
];

// Investigation view the inbox generates when someone claims the checkout
// item (inbox._generate_view_for_item: "Investigation: <item title>").
export const investigationView = {
  id: 'cv-inv-checkout',
  title: 'Investigation: Deployment checkout rollout is failing',
  description: 'checkout 2.8.0 exits on start: payments.url is not set in checkout-config',
  layout: [
    {
      kind: 'resolution_tracker',
      title: 'Investigation steps',
      steps: [
        { title: 'Correlate changes', status: 'done', timestamp: '14:05', detail: 'Rollout of revision 15 at 14:02, 2 min after checkout-config was edited', output: null },
        { title: 'Read crash logs', status: 'done', timestamp: '14:06', detail: 'Both revision 15 pods exit 1 with the same config error', output: 'FATAL config: payments.url is not set' },
        { title: 'Rule out the cluster', status: 'done', timestamp: '14:06', detail: 'Nodes healthy, no OOMKilled, image pulled fine: the failure follows the revision', output: null },
        { title: 'Compare to revision 14', status: 'done', timestamp: '14:07', detail: 'Revision 14 reads PAYMENTS_URL with a default and ran cleanly for 6 days', output: null },
        { title: 'Propose fix', status: 'running', timestamp: '14:07', detail: 'Roll back to revision 14 (needs approval), then restore payments.url', output: null },
      ],
    },
    { ...readyPods, height: 200 },
    {
      kind: 'log_viewer',
      title: 'Crash evidence: checkout-7c9d5f6b8-x2k4p',
      source: 'shop/checkout-7c9d5f6b8-x2k4p (checkout)',
      lines: [
        { timestamp: '14:05:41', level: 'info', message: 'checkout 2.8.0 starting (rev 15)' },
        { timestamp: '14:05:41', level: 'info', message: 'loading config from /etc/checkout/config.yaml' },
        { timestamp: '14:05:42', level: 'error', message: 'FATAL config: payments.url is not set' },
        { timestamp: '14:05:42', level: 'error', message: 'exit status 1' },
      ],
    },
    {
      kind: 'key_value',
      title: 'Suspected cause',
      pairs: [
        { key: 'Change', value: 'Deployment shop/checkout revision 15 (checkout:2.8.0), 14:02' },
        { key: 'Config', value: 'checkout-config has no payments.url (edited 14:00)' },
        { key: 'Ruled out', value: 'Node or image problem: revision 14 pod on the same node is healthy' },
        { key: 'Recommended fix', value: 'Roll back to revision 14, then restore payments.url' },
      ],
    },
    { kind: 'confidence_badge', title: 'Confidence in root cause', score: 0.86, label: 'root cause' },
  ],
  positions: {
    0: { x: 0, y: 0, w: 5, h: 12 },
    1: { x: 5, y: 0, w: 7, h: 7 },
    2: { x: 5, y: 7, w: 7, h: 5 },
    3: { x: 0, y: 12, w: 8, h: 6 },
    4: { x: 8, y: 12, w: 4, h: 4 },
  },
  generatedAt: storyNow - 14 * 60_000,
  view_type: 'incident',
  status: 'active',
  trigger_source: 'agent',
  visibility: 'team',
};

// GET /views row shape (customViewStore.loadViews reads created_at, not generatedAt).
export const viewRow = (v) => ({ ...v, owner: 'sre-oncall', created_at: new Date(v.generatedAt).toISOString() });
