/**
 * Prefilled manifests for the YAML create flow (`/create/<gvr>?template=<id>&namespace=<ns>`).
 *
 * Screens that find a gap — a namespace with no NetworkPolicy, no quota, an
 * alert rule to write — link here so the user starts from a reviewed,
 * working manifest in the right namespace instead of a blank Pod.
 */
export interface CreateTemplate {
  id: string;
  /** GVR key of what the template creates, e.g. networking.k8s.io/v1/networkpolicies. */
  gvr: string;
  label: string;
  yaml: (namespace: string) => string;
}

export const CREATE_TEMPLATES: Record<string, CreateTemplate> = {
  'default-deny': {
    id: 'default-deny',
    gvr: 'networking.k8s.io/v1/networkpolicies',
    label: 'Default-deny NetworkPolicy',
    yaml: (ns) => `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: ${ns}
spec:
  # Selects every pod in the namespace. With no ingress or egress rules,
  # all traffic to and from those pods is denied until other policies allow it.
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
`,
  },
  'resource-quota': {
    id: 'resource-quota',
    gvr: 'v1/resourcequotas',
    label: 'ResourceQuota',
    yaml: (ns) => `apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: ${ns}
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "50"
`,
  },
  'limit-range': {
    id: 'limit-range',
    gvr: 'v1/limitranges',
    label: 'LimitRange',
    yaml: (ns) => `apiVersion: v1
kind: LimitRange
metadata:
  name: container-defaults
  namespace: ${ns}
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      default:
        cpu: 500m
        memory: 512Mi
      max:
        cpu: "2"
        memory: 2Gi
`,
  },
  'prometheus-rule': {
    id: 'prometheus-rule',
    gvr: 'monitoring.coreos.com/v1/prometheusrules',
    label: 'PrometheusRule (alert)',
    yaml: (ns) => `apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: my-alerts
  namespace: ${ns}
spec:
  groups:
    - name: my-alerts.rules
      rules:
        - alert: HighPodRestartRate
          # Fires when any container in this namespace restarted more than 3 times in 15 minutes.
          expr: increase(kube_pod_container_status_restarts_total{namespace="${ns}"}[15m]) > 3
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "{{ $labels.pod }} is restarting frequently"
            description: "{{ $labels.container }} in {{ $labels.namespace }}/{{ $labels.pod }} restarted {{ $value }} times in 15 minutes."
`,
  },
};

const NS_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** The template's manifest for `namespace`, or null when the id is unknown or the namespace invalid. */
export function renderCreateTemplate(id: string | null, namespace: string): string | null {
  if (!id) return null;
  const t = CREATE_TEMPLATES[id];
  if (!t || !NS_RE.test(namespace)) return null;
  return t.yaml(namespace);
}

/** `/create/...` link for a template in a namespace. */
export function createTemplateUrl(id: keyof typeof CREATE_TEMPLATES | string, namespace: string): string {
  const t = CREATE_TEMPLATES[id];
  return `/create/${t.gvr.replace(/\//g, '~')}?template=${encodeURIComponent(id)}&namespace=${encodeURIComponent(namespace)}`;
}
