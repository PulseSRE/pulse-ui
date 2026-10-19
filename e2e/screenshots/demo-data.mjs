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
