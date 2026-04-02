/**
 * Readiness Gates — ~25 production readiness checks across 6 categories.
 *
 * Each gate uses the GateContext.fetchJson helper which proxies through
 * /api/kubernetes/. Gates are designed to be evaluated independently and
 * in parallel.
 */

import type { ReadinessGate, GateContext, GateResult, GateStatus } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely evaluate a gate, catching errors and returning 'not_started' */
async function safeEval(
  gate: Pick<ReadinessGate, 'id'>,
  fn: () => Promise<Omit<GateResult, 'gateId' | 'evaluatedAt'>>,
): Promise<GateResult> {
  try {
    const partial = await fn();
    return { gateId: gate.id, ...partial, evaluatedAt: Date.now() };
  } catch {
    return { gateId: gate.id, status: 'not_started', detail: 'Unable to evaluate — API unavailable', fixGuidance: 'Ensure API connectivity and try again.', evaluatedAt: Date.now() };
  }
}

interface K8sListResponse<T = unknown> {
  items: T[];
}

async function listItems<T = any>(ctx: GateContext, path: string): Promise<T[]> {
  const res = await ctx.fetchJson<K8sListResponse<T>>(path);
  return res?.items ?? [];
}

function isSystemNs(ns: string | undefined): boolean {
  if (!ns) return true;
  return ns.startsWith('openshift-') || ns.startsWith('kube-');
}

// ---------------------------------------------------------------------------
// Gate definitions
// ---------------------------------------------------------------------------

// ---- PREREQUISITES (gates 1-5) -------------------------------------------

const haControlPlane: ReadinessGate = {
  id: 'ha-control-plane',
  title: 'High Availability Control Plane',
  description: 'At least 3 control plane nodes for fault tolerance',
  whyItMatters: 'A single control plane node means any node failure takes down the entire cluster API. Three nodes provide quorum-based fault tolerance.',
  category: 'prerequisites',
  priority: 'blocking',
  evaluate: (ctx) => safeEval(haControlPlane, async () => {
    if (ctx.isHyperShift) {
      return { status: 'passed', detail: 'Managed externally — hosted control plane', fixGuidance: '' };
    }
    const nodes = await listItems(ctx, '/api/v1/nodes');
    const cp = nodes.filter((n: any) => {
      const labels = n.metadata?.labels || {};
      return Object.keys(labels).some((k: string) => k.includes('master') || k.includes('control-plane'));
    });
    const status: GateStatus = cp.length >= 3 ? 'passed' : cp.length > 0 ? 'needs_attention' : 'failed';
    return { status, detail: `${cp.length} control plane node${cp.length !== 1 ? 's' : ''}`, fixGuidance: 'Add control plane nodes to reach at least 3 for HA.', action: { label: 'View Nodes', path: '/compute' } };
  }),
};

const workerNodes: ReadinessGate = {
  id: 'worker-nodes',
  title: 'Dedicated Worker Nodes',
  description: 'At least 2 worker nodes for workload scheduling',
  whyItMatters: 'With a single worker, any node maintenance or failure causes workload downtime. Two or more workers enable rolling updates and pod rescheduling.',
  category: 'prerequisites',
  priority: 'blocking',
  evaluate: (ctx) => safeEval(workerNodes, async () => {
    const nodes = await listItems(ctx, '/api/v1/nodes');
    const workers = nodes.filter((n: any) => {
      const labels = n.metadata?.labels || {};
      return Object.keys(labels).some((k: string) => k.includes('worker'));
    });
    const status: GateStatus = workers.length >= 2 ? 'passed' : workers.length > 0 ? 'needs_attention' : 'failed';
    return { status, detail: `${workers.length} worker node${workers.length !== 1 ? 's' : ''}`, fixGuidance: 'Add worker nodes to reach at least 2 for workload resilience.', action: { label: 'View Nodes', path: '/compute' } };
  }),
};

const clusterAutoscaling: ReadinessGate = {
  id: 'autoscaling',
  title: 'Cluster Autoscaling',
  description: 'ClusterAutoscaler configured for automatic node scaling',
  whyItMatters: 'Without autoscaling, you must manually add nodes during traffic spikes. Autoscaling responds to demand automatically.',
  category: 'prerequisites',
  priority: 'optional',
  evaluate: (ctx) => safeEval(clusterAutoscaling, async () => {
    if (ctx.isHyperShift) return { status: 'passed', detail: 'Managed by hosting provider', fixGuidance: '' };
    const items = await listItems(ctx, '/apis/autoscaling.openshift.io/v1/clusterautoscalers');
    return { status: items.length > 0 ? 'passed' : 'needs_attention', detail: items.length > 0 ? 'Configured' : 'Not configured', fixGuidance: 'Configure a ClusterAutoscaler to enable automatic node scaling.', action: { label: 'Configure', path: '/compute' } };
  }),
};

const machineHealthChecks: ReadinessGate = {
  id: 'machine-health',
  title: 'Machine Health Checks',
  description: 'Automatic remediation of unhealthy machines',
  whyItMatters: 'Without health checks, failed nodes remain in the cluster and workloads stay in a degraded state until manual intervention.',
  category: 'prerequisites',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(machineHealthChecks, async () => {
    if (ctx.isHyperShift) return { status: 'passed', detail: 'Managed by hosting provider', fixGuidance: '' };
    const items = await listItems(ctx, '/apis/machine.openshift.io/v1beta1/machinehealthchecks');
    return { status: items.length > 0 ? 'passed' : 'needs_attention', detail: `${items.length} health check${items.length !== 1 ? 's' : ''}`, fixGuidance: 'Create MachineHealthCheck resources to auto-remediate unhealthy nodes.', action: { label: 'View', path: '/compute' } };
  }),
};

const olmOperators: ReadinessGate = {
  id: 'olm-operators',
  title: 'OLM Operators',
  description: 'Operators installed via OperatorHub',
  whyItMatters: 'OLM manages operator lifecycle including updates and compatibility. Installing operators outside OLM loses these benefits.',
  category: 'prerequisites',
  priority: 'optional',
  evaluate: (ctx) => safeEval(olmOperators, async () => {
    const subs = await listItems(ctx, '/apis/operators.coreos.com/v1alpha1/subscriptions');
    if (subs.length === 0) return { status: 'needs_attention', detail: 'No operators installed via OLM', fixGuidance: 'Install operators from OperatorHub for managed lifecycle.' };
    const names = subs.map((s: any) => (s.spec?.name || s.metadata?.name || '').toLowerCase());
    return { status: 'passed', detail: `${subs.length} operator${subs.length !== 1 ? 's' : ''}: ${names.slice(0, 5).join(', ')}${subs.length > 5 ? `, +${subs.length - 5} more` : ''}`, fixGuidance: '', action: { label: 'View', path: '/r/operators.coreos.com~v1alpha1~subscriptions' } };
  }),
};

// ---- SECURITY (gates 6-11) ------------------------------------------------

const identityProviders: ReadinessGate = {
  id: 'identity-providers',
  title: 'Identity Providers Configured',
  description: 'External authentication (LDAP, GitHub, OpenID) instead of kubeadmin',
  whyItMatters: 'kubeadmin uses a static password with full cluster-admin access. External IdPs provide proper authentication, audit trails, and account lifecycle management.',
  category: 'security',
  priority: 'blocking',
  evaluate: (ctx) => safeEval(identityProviders, async () => {
    const oauth = await ctx.fetchJson<any>('/apis/config.openshift.io/v1/oauths/cluster');
    const idps = oauth?.spec?.identityProviders || [];
    return {
      status: idps.length > 0 ? 'passed' : 'failed',
      detail: idps.length > 0 ? idps.map((p: any) => p.name).join(', ') : 'No providers — using kubeadmin only',
      fixGuidance: 'Configure at least one external identity provider (LDAP, OIDC, GitHub) via OAuth cluster config.',
      action: { label: 'Configure', path: '/admin' },
    };
  }),
};

const kubeadminRemoved: ReadinessGate = {
  id: 'kubeadmin-removed',
  title: 'Kubeadmin Secret Removed',
  description: 'Remove kubeadmin after configuring identity providers',
  whyItMatters: 'The kubeadmin account has unrestricted access with a static password. It should be removed once proper authentication is configured.',
  category: 'security',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(kubeadminRemoved, async () => {
    try {
      await ctx.fetchJson('/api/v1/namespaces/kube-system/secrets/kubeadmin');
      return { status: 'needs_attention', detail: 'Still exists — remove after configuring IdP', fixGuidance: 'Run: oc delete secret kubeadmin -n kube-system' };
    } catch {
      return { status: 'passed', detail: 'Removed', fixGuidance: '' };
    }
  }),
};

const tlsProfile: ReadinessGate = {
  id: 'tls-profile',
  title: 'TLS Security Profile',
  description: 'Intermediate or Modern TLS (not Old)',
  whyItMatters: 'The Old TLS profile allows weak ciphers and protocols vulnerable to known attacks.',
  category: 'security',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(tlsProfile, async () => {
    const apiServer = await ctx.fetchJson<any>('/apis/config.openshift.io/v1/apiservers/cluster');
    const profile = apiServer?.spec?.tlsSecurityProfile?.type || 'Intermediate';
    return { status: profile === 'Old' ? 'failed' : 'passed', detail: `${profile} profile`, fixGuidance: 'Set TLS security profile to Intermediate or Modern.', action: { label: 'Configure', path: '/admin' } };
  }),
};

const encryptionAtRest: ReadinessGate = {
  id: 'encryption',
  title: 'Encryption at Rest',
  description: 'Encrypt etcd data (secrets, configmaps)',
  whyItMatters: 'Without encryption at rest, secrets and sensitive configuration are stored as base64 in etcd, readable by anyone with disk access.',
  category: 'security',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(encryptionAtRest, async () => {
    const apiServer = await ctx.fetchJson<any>('/apis/config.openshift.io/v1/apiservers/cluster');
    const enc = apiServer?.spec?.encryption?.type;
    return {
      status: enc && enc !== 'identity' ? 'passed' : 'needs_attention',
      detail: enc ? `Type: ${enc}` : 'Not configured (data stored unencrypted)',
      fixGuidance: 'Enable etcd encryption via the API server configuration.',
      action: { label: 'Configure', path: '/admin' },
    };
  }),
};

const networkPolicies: ReadinessGate = {
  id: 'network-policies',
  title: 'Network Policies',
  description: 'Restrict pod-to-pod traffic in user namespaces',
  whyItMatters: 'Without network policies, any pod can communicate with any other pod, enabling lateral movement if a workload is compromised.',
  category: 'security',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(networkPolicies, async () => {
    const netpols = await listItems(ctx, '/apis/networking.k8s.io/v1/networkpolicies');
    const userNs = new Set(netpols.filter((np: any) => !isSystemNs(np.metadata?.namespace)).map((np: any) => np.metadata?.namespace));
    return {
      status: userNs.size > 0 ? 'passed' : 'needs_attention',
      detail: `${userNs.size} namespace${userNs.size !== 1 ? 's' : ''} with policies`,
      fixGuidance: 'Create NetworkPolicy resources in user namespaces to restrict pod traffic.',
      action: { label: 'View Networking', path: '/networking' },
    };
  }),
};

const secretsManagement: ReadinessGate = {
  id: 'secrets-mgmt',
  title: 'Secrets Management',
  description: 'External secrets operator or Sealed Secrets for GitOps-safe secret handling',
  whyItMatters: 'Storing secrets directly in Git repos exposes credentials. External secrets operators fetch secrets from vaults at runtime.',
  category: 'security',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(secretsManagement, async () => {
    const [extSecrets, sealedSecrets] = await Promise.all([
      listItems(ctx, '/apis/external-secrets.io/v1beta1/externalsecrets').catch(() => []),
      listItems(ctx, '/apis/bitnami.com/v1alpha1/sealedsecrets').catch(() => []),
    ]);
    const hasExt = extSecrets.length > 0;
    const hasSealed = sealedSecrets.length > 0;
    if (hasExt) return { status: 'passed', detail: `${extSecrets.length} ExternalSecret${extSecrets.length !== 1 ? 's' : ''}`, fixGuidance: '' };
    if (hasSealed) return { status: 'passed', detail: `${sealedSecrets.length} SealedSecret${sealedSecrets.length !== 1 ? 's' : ''}`, fixGuidance: '' };
    return { status: 'needs_attention', detail: 'No external secrets operator detected — secrets stored as base64 in etcd', fixGuidance: 'Install External Secrets Operator or Sealed Secrets for secure secret management.' };
  }),
};

// ---- OBSERVABILITY (gates 12-16) ------------------------------------------

const monitoringStack: ReadinessGate = {
  id: 'monitoring',
  title: 'Monitoring Stack',
  description: 'Prometheus and Alertmanager running',
  whyItMatters: 'Without monitoring, you have no visibility into cluster health, resource usage, or application performance.',
  category: 'observability',
  priority: 'blocking',
  evaluate: (ctx) => safeEval(monitoringStack, async () => {
    const pods = await listItems(ctx, '/api/v1/namespaces/openshift-monitoring/pods');
    const prom = pods.filter((p: any) => p.metadata?.name?.includes('prometheus'));
    return {
      status: prom.length > 0 ? 'passed' : 'failed',
      detail: `${prom.length} Prometheus pod${prom.length !== 1 ? 's' : ''}`,
      fixGuidance: 'Ensure the openshift-monitoring namespace has running Prometheus pods.',
      action: { label: 'View Alerts', path: '/alerts' },
    };
  }),
};

const logForwarding: ReadinessGate = {
  id: 'log-forwarding',
  title: 'Log Forwarding',
  description: 'Forward logs to external system (Elasticsearch, Splunk, etc.)',
  whyItMatters: 'Cluster-local logs are lost on pod restart or node failure. External log forwarding provides durable audit and debugging data.',
  category: 'observability',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(logForwarding, async () => {
    const items = await listItems(ctx, '/apis/logging.openshift.io/v1/clusterlogforwarders');
    return {
      status: items.length > 0 ? 'passed' : 'needs_attention',
      detail: items.length > 0 ? 'Configured' : 'Not configured — logs only available on cluster',
      fixGuidance: 'Configure a ClusterLogForwarder to send logs to an external system.',
    };
  }),
};

const auditLogging: ReadinessGate = {
  id: 'audit-logging',
  title: 'Audit Logging',
  description: 'API server audit logging enabled',
  whyItMatters: 'Audit logs are required for compliance and forensics. Without them, you cannot track who did what in the cluster.',
  category: 'observability',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(auditLogging, async () => {
    const apiServer = await ctx.fetchJson<any>('/apis/config.openshift.io/v1/apiservers/cluster');
    const profile = apiServer?.spec?.audit?.profile || 'Default';
    return { status: profile === 'None' ? 'failed' : 'passed', detail: `Profile: ${profile}`, fixGuidance: 'Set audit profile to Default or WriteRequestBodies.' };
  }),
};

const loggingOperator: ReadinessGate = {
  id: 'logging-operator',
  title: 'Logging Operator',
  description: 'Cluster Logging Operator (CLO) for log collection',
  whyItMatters: 'The CLO provides structured log collection, filtering, and forwarding capabilities out of the box.',
  category: 'observability',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(loggingOperator, async () => {
    const subs = await listItems(ctx, '/apis/operators.coreos.com/v1alpha1/subscriptions');
    const names = subs.map((s: any) => (s.spec?.name || s.metadata?.name || '').toLowerCase());
    const has = names.some((n: string) => n.includes('cluster-logging') || n.includes('logging'));
    return {
      status: has ? 'passed' : 'needs_attention',
      detail: has ? 'Installed' : 'Not installed — install from OperatorHub',
      fixGuidance: 'Install Cluster Logging Operator from OperatorHub.',
      action: has ? undefined : { label: 'Install CLO', path: '/create/v1~pods?tab=operators&q=cluster-logging' },
    };
  }),
};

const clusterObservabilityOperator: ReadinessGate = {
  id: 'coo',
  title: 'Cluster Observability Operator',
  description: 'COO for monitoring, distributed tracing, and dashboards',
  whyItMatters: 'The COO enables UIPlugin dashboards, distributed tracing, and advanced monitoring capabilities.',
  category: 'observability',
  priority: 'optional',
  evaluate: (ctx) => safeEval(clusterObservabilityOperator, async () => {
    const subs = await listItems(ctx, '/apis/operators.coreos.com/v1alpha1/subscriptions');
    const names = subs.map((s: any) => (s.spec?.name || s.metadata?.name || '').toLowerCase());
    const has = names.some((n: string) => n.includes('cluster-observability') || n.includes('observability-operator'));
    return {
      status: has ? 'passed' : 'needs_attention',
      detail: has ? 'Installed' : 'Not installed — enables UIPlugin, dashboards, and tracing',
      fixGuidance: 'Install Cluster Observability Operator from OperatorHub.',
      action: has ? undefined : { label: 'Install COO', path: '/create/v1~pods?tab=operators&q=observability' },
    };
  }),
};

// ---- RELIABILITY (gates 17-22) --------------------------------------------

const resourceQuotas: ReadinessGate = {
  id: 'resource-quotas',
  title: 'Resource Quotas',
  description: 'Prevent resource abuse in user namespaces',
  whyItMatters: 'Without quotas, a single namespace can consume all cluster resources, causing starvation for other workloads.',
  category: 'reliability',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(resourceQuotas, async () => {
    const quotas = await listItems(ctx, '/api/v1/resourcequotas');
    const user = quotas.filter((q: any) => !isSystemNs(q.metadata?.namespace));
    return { status: user.length > 0 ? 'passed' : 'needs_attention', detail: `${user.length} quota${user.length !== 1 ? 's' : ''} in user namespaces`, fixGuidance: 'Create ResourceQuotas in user namespaces to limit resource consumption.', action: { label: 'View Quotas', path: '/admin' } };
  }),
};

const stableUpdateChannel: ReadinessGate = {
  id: 'update-channel',
  title: 'Stable Update Channel',
  description: 'Use stable channel (not candidate or fast) for production',
  whyItMatters: 'The stable channel has the most testing. Fast and candidate channels may contain regressions.',
  category: 'reliability',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(stableUpdateChannel, async () => {
    const cv = await ctx.fetchJson<any>('/apis/config.openshift.io/v1/clusterversions/version');
    const ch = cv?.spec?.channel || '';
    const status: GateStatus = ch.startsWith('stable') ? 'passed' : ch.startsWith('fast') ? 'needs_attention' : ch ? 'failed' : 'not_started';
    return { status, detail: ch || 'No channel set', fixGuidance: 'Switch to the stable update channel for production reliability.', action: { label: 'Change Channel', path: '/admin' } };
  }),
};

const clusterUpToDate: ReadinessGate = {
  id: 'cluster-updated',
  title: 'Cluster Up to Date',
  description: 'No pending cluster updates',
  whyItMatters: 'Pending updates may include critical security fixes. Staying current reduces vulnerability exposure.',
  category: 'reliability',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(clusterUpToDate, async () => {
    const cv = await ctx.fetchJson<any>('/apis/config.openshift.io/v1/clusterversions/version');
    const avail = cv?.status?.availableUpdates || [];
    return { status: avail.length === 0 ? 'passed' : 'needs_attention', detail: avail.length === 0 ? 'Up to date' : `${avail.length} update${avail.length !== 1 ? 's' : ''} available`, fixGuidance: 'Apply available cluster updates.', action: { label: 'View Updates', path: '/admin' } };
  }),
};

const limitRanges: ReadinessGate = {
  id: 'limit-ranges',
  title: 'Default Resource Limits',
  description: 'LimitRanges set default CPU/memory for containers without explicit limits',
  whyItMatters: 'Containers without limits can consume unbounded resources, causing OOM kills and noisy-neighbor issues.',
  category: 'reliability',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(limitRanges, async () => {
    const lrs = await listItems(ctx, '/api/v1/limitranges');
    const user = lrs.filter((lr: any) => !isSystemNs(lr.metadata?.namespace));
    return { status: user.length > 0 ? 'passed' : 'needs_attention', detail: `${user.length} LimitRange${user.length !== 1 ? 's' : ''} in user namespaces`, fixGuidance: 'Create LimitRanges in user namespaces to set default resource limits.', action: { label: 'View Quotas', path: '/admin' } };
  }),
};

const podDisruptionBudgets: ReadinessGate = {
  id: 'pod-disruption-budgets',
  title: 'Pod Disruption Budgets',
  description: 'PDBs protect critical workloads during node drains and updates',
  whyItMatters: 'Without PDBs, cluster updates can simultaneously evict all pods of a service, causing downtime.',
  category: 'reliability',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(podDisruptionBudgets, async () => {
    const pdbs = await listItems(ctx, '/apis/policy/v1/poddisruptionbudgets');
    const user = pdbs.filter((p: any) => !isSystemNs(p.metadata?.namespace));
    return { status: user.length > 0 ? 'passed' : 'needs_attention', detail: `${user.length} PDB${user.length !== 1 ? 's' : ''} in user namespaces`, fixGuidance: 'Create PodDisruptionBudgets for critical workloads.', action: { label: 'Create PDB', path: '/create/policy~v1~poddisruptionbudgets' } };
  }),
};

const etcdBackup: ReadinessGate = {
  id: 'etcd-backup',
  title: 'Etcd Backup',
  description: 'Automated etcd backups configured',
  whyItMatters: 'Etcd holds all cluster state. Without backups, a data corruption or loss event is unrecoverable.',
  category: 'reliability',
  priority: 'blocking',
  evaluate: (ctx) => safeEval(etcdBackup, async () => {
    if (ctx.isHyperShift) return { status: 'passed', detail: 'Managed by hosting provider', fixGuidance: '' };
    const items = await listItems(ctx, '/apis/config.openshift.io/v1/backups').catch(() => []);
    return {
      status: items.length > 0 ? 'passed' : 'needs_attention',
      detail: items.length > 0 ? 'Backup configured' : 'No automated backup configured',
      fixGuidance: 'Configure automated etcd backups using OADP or a CronJob.',
      action: items.length > 0 ? undefined : { label: 'Setup OADP', path: '/create/v1~pods?tab=operators&q=oadp' },
    };
  }),
};

// ---- OPERATIONS (gates 23-24) ---------------------------------------------

const ingressCertificate: ReadinessGate = {
  id: 'ingress-cert',
  title: 'Custom Ingress Certificate',
  description: 'Replace self-signed default certificate with a trusted CA certificate',
  whyItMatters: 'Self-signed certificates cause browser warnings and break trust chains for external clients.',
  category: 'operations',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(ingressCertificate, async () => {
    const ingress = await ctx.fetchJson<any>('/apis/config.openshift.io/v1/ingresses/cluster');
    const hasCert = !!(ingress?.spec?.componentRoutes?.some((r: any) => r.servingCertKeyPairSecret) || ingress?.spec?.defaultCertificate);
    return { status: hasCert ? 'passed' : 'needs_attention', detail: hasCert ? 'Custom certificate configured' : 'Using default self-signed certificate', fixGuidance: 'Configure a trusted CA certificate for the default ingress controller.', action: { label: 'Configure Ingress', path: '/admin' } };
  }),
};

const customDomain: ReadinessGate = {
  id: 'custom-domain',
  title: 'Custom Ingress Domain',
  description: 'Configure a custom apps domain instead of the default',
  whyItMatters: 'Default domains are not memorable and may change. A custom domain provides stable, branded URLs for applications.',
  category: 'operations',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(customDomain, async () => {
    const ingress = await ctx.fetchJson<any>('/apis/config.openshift.io/v1/ingresses/cluster');
    const domain = ingress?.spec?.domain || '';
    const isDefault = domain.includes('.devcluster.') || domain.includes('.example.com') || !domain;
    const status: GateStatus = domain && !isDefault ? 'passed' : domain ? 'needs_attention' : 'failed';
    return { status, detail: domain || 'No domain configured', fixGuidance: 'Configure a custom apps domain in the ingress controller.', action: { label: 'Configure', path: '/admin' } };
  }),
};

const notificationRouting: ReadinessGate = {
  id: 'notification-routing',
  title: 'Alert Notification Routing',
  description: 'Alertmanager has at least one receiver configured beyond the default',
  whyItMatters: 'Without notification routing, alerts fire silently. Teams are not notified of critical issues until they discover them manually.',
  category: 'operations',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(notificationRouting, async () => {
    try {
      const receivers = await ctx.fetchJson<any[]>('/api/v1/namespaces/openshift-monitoring/services/alertmanager-main:web/proxy/api/v2/receivers');
      const nonDefault = (receivers || []).filter((r: any) => r.name !== 'Default' && r.name !== 'null' && r.name !== 'watchdog');
      return {
        status: nonDefault.length > 0 ? 'passed' : 'needs_attention',
        detail: nonDefault.length > 0 ? `${nonDefault.length} receiver${nonDefault.length !== 1 ? 's' : ''} configured` : 'Only default receiver — alerts are not routed to any team',
        fixGuidance: 'Configure Alertmanager receivers (PagerDuty, Slack, email) to route alerts to your team.',
        action: { label: 'View Alerts', path: '/alerts?tab=silences' },
      };
    } catch {
      return { status: 'not_started', detail: 'Alertmanager not reachable', fixGuidance: 'Ensure Alertmanager is running and accessible.' };
    }
  }),
};

const trustLevelConfigured: ReadinessGate = {
  id: 'trust-level-configured',
  title: 'Agent Trust Level Configured',
  description: 'OpenshiftPulse agent is reachable and trusted',
  whyItMatters: 'Without a connected agent, autonomous monitoring and remediation features are unavailable.',
  category: 'operations',
  priority: 'optional',
  evaluate: (ctx) => safeEval(trustLevelConfigured, async () => {
    try {
      const version = await ctx.fetchJson<any>('/api/agent/version');
      const v = version?.version || version?.gitVersion || 'unknown';
      return { status: 'passed', detail: `Agent reachable (${v})`, fixGuidance: '' };
    } catch {
      return { status: 'needs_attention', detail: 'Agent not reachable', fixGuidance: 'Deploy the OpenshiftPulse agent and verify connectivity.', action: { label: 'Setup Agent', path: '/readiness' } };
    }
  }),
};

const agentProtocolVersion: ReadinessGate = {
  id: 'agent-protocol-version',
  title: 'Agent Protocol Version',
  description: 'Agent supports protocol v2 for autonomous scanning',
  whyItMatters: 'Protocol v2 enables the /ws/monitor WebSocket endpoint for real-time cluster scanning, which is required for live incident detection.',
  category: 'operations',
  priority: 'optional',
  evaluate: (ctx) => safeEval(agentProtocolVersion, async () => {
    try {
      const version = await ctx.fetchJson<any>('/api/agent/version');
      const proto = version?.protocolVersion ?? version?.protocol ?? 0;
      if (proto >= 2) return { status: 'passed', detail: `Protocol v${proto}`, fixGuidance: '' };
      return { status: 'needs_attention', detail: `Protocol v${proto} — upgrade to v2 for autonomous scanning`, fixGuidance: 'Upgrade the OpenshiftPulse agent to a version that supports protocol v2.' };
    } catch {
      return { status: 'not_started', detail: 'Agent not reachable', fixGuidance: 'Deploy the OpenshiftPulse agent and verify connectivity.' };
    }
  }),
};

// ---- GITOPS (gates 25-27) ------------------------------------------------

const storageClassAvailable: ReadinessGate = {
  id: 'storage-class',
  title: 'Storage Classes Available',
  description: 'At least one StorageClass for dynamic volume provisioning',
  whyItMatters: 'Without StorageClasses, PVCs cannot be dynamically provisioned and workloads requiring persistent storage will fail.',
  category: 'gitops',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(storageClassAvailable, async () => {
    const scs = await listItems(ctx, '/apis/storage.k8s.io/v1/storageclasses');
    return { status: scs.length > 0 ? 'passed' : 'failed', detail: `${scs.length} StorageClass${scs.length !== 1 ? 'es' : ''}`, fixGuidance: 'Create at least one StorageClass for dynamic volume provisioning.', action: { label: 'View Storage', path: '/storage' } };
  }),
};

const defaultStorageClass: ReadinessGate = {
  id: 'default-storage',
  title: 'Default StorageClass Set',
  description: 'A default StorageClass so PVCs work without specifying one',
  whyItMatters: 'PVCs without a storageClassName use the default. Without one, they remain Pending indefinitely.',
  category: 'gitops',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(defaultStorageClass, async () => {
    const scs = await listItems(ctx, '/apis/storage.k8s.io/v1/storageclasses');
    const def = scs.find((sc: any) => sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true');
    return {
      status: def ? 'passed' : scs.length > 0 ? 'needs_attention' : 'failed',
      detail: def ? def.metadata.name : 'No default set',
      fixGuidance: 'Annotate a StorageClass as default: storageclass.kubernetes.io/is-default-class=true',
      action: { label: 'View Storage', path: '/storage' },
    };
  }),
};

const imageRegistry: ReadinessGate = {
  id: 'image-registry',
  title: 'Internal Image Registry',
  description: 'Image registry with persistent storage (not emptyDir)',
  whyItMatters: 'With emptyDir storage, all pushed images are lost on registry pod restart, breaking builds and deployments.',
  category: 'gitops',
  priority: 'recommended',
  evaluate: (ctx) => safeEval(imageRegistry, async () => {
    const reg = await ctx.fetchJson<any>('/apis/imageregistry.operator.openshift.io/v1/configs/cluster');
    const mgmt = reg?.spec?.managementState;
    const storage = reg?.spec?.storage;
    const hasPersistent = storage && !storage.emptyDir;
    if (mgmt === 'Removed') return { status: 'needs_attention', detail: 'Registry removed', fixGuidance: 'Re-enable the internal image registry if builds are needed.', action: { label: 'View Registry', path: '/r/imageregistry.operator.openshift.io~v1~configs/_/cluster' } };
    if (hasPersistent) return { status: 'passed', detail: `Storage: ${Object.keys(storage).filter((k: string) => k !== 'managementState')[0] || 'configured'}`, fixGuidance: '', action: { label: 'View Registry', path: '/r/imageregistry.operator.openshift.io~v1~configs/_/cluster' } };
    return { status: 'needs_attention', detail: storage?.emptyDir ? 'Using emptyDir — data lost on restart' : 'Unknown storage config', fixGuidance: 'Configure persistent storage for the image registry.', action: { label: 'View Registry', path: '/r/imageregistry.operator.openshift.io~v1~configs/_/cluster' } };
  }),
};

// ---------------------------------------------------------------------------
// Exported registry
// ---------------------------------------------------------------------------

/** All readiness gates in evaluation order */
export const ALL_GATES: ReadinessGate[] = [
  // Prerequisites
  haControlPlane,
  workerNodes,
  clusterAutoscaling,
  machineHealthChecks,
  olmOperators,
  // Security
  identityProviders,
  kubeadminRemoved,
  tlsProfile,
  encryptionAtRest,
  networkPolicies,
  secretsManagement,
  // Observability
  monitoringStack,
  logForwarding,
  auditLogging,
  loggingOperator,
  clusterObservabilityOperator,
  // Reliability
  resourceQuotas,
  stableUpdateChannel,
  clusterUpToDate,
  limitRanges,
  podDisruptionBudgets,
  etcdBackup,
  // Operations
  ingressCertificate,
  customDomain,
  notificationRouting,
  trustLevelConfigured,
  agentProtocolVersion,
  // GitOps
  storageClassAvailable,
  defaultStorageClass,
  imageRegistry,
];

/** Evaluate all gates in parallel, returning results keyed by gate ID */
export async function evaluateAllGates(ctx: GateContext): Promise<Record<string, GateResult>> {
  const results = await Promise.all(ALL_GATES.map((gate) => gate.evaluate(ctx)));
  const map: Record<string, GateResult> = {};
  for (const r of results) {
    map[r.gateId] = r;
  }
  return map;
}
