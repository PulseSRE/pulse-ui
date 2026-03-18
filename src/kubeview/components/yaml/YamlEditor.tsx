import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { foldGutter, bracketMatching } from '@codemirror/language';
import { highlightActiveLine } from '@codemirror/view';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { Save, FileDown, BookOpen, Puzzle, HelpCircle, X, Copy, Check, AlertTriangle, GitCompare } from 'lucide-react';
import { linter, type Diagnostic } from '@codemirror/lint';
import { cn } from '@/lib/utils';
import DiffPreview from './DiffPreview';
import SchemaPanel from './SchemaPanel';
import { snippets, resolveSnippet, type Snippet } from './SnippetEngine';

export interface YamlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  onSave?: (value: string) => void;
  showDiff?: boolean;
  originalValue?: string;
  resourceGvk?: { group: string; version: string; kind: string };
}

// K8s YAML keywords for autocomplete
const k8sKeywords: Completion[] = [
  { label: 'apiVersion', type: 'keyword', detail: 'API version', info: 'e.g., v1, apps/v1' },
  { label: 'kind', type: 'keyword', detail: 'Resource type', info: 'e.g., Pod, Deployment, Service' },
  { label: 'metadata', type: 'keyword', detail: 'Object metadata' },
  { label: 'name', type: 'property', detail: 'Resource name' },
  { label: 'namespace', type: 'property', detail: 'Namespace' },
  { label: 'labels', type: 'property', detail: 'Key-value labels' },
  { label: 'annotations', type: 'property', detail: 'Key-value annotations' },
  { label: 'spec', type: 'keyword', detail: 'Resource specification' },
  { label: 'status', type: 'keyword', detail: 'Resource status (read-only)' },
  { label: 'replicas', type: 'property', detail: 'Number of replicas', info: 'integer, >= 0' },
  { label: 'selector', type: 'property', detail: 'Label selector' },
  { label: 'matchLabels', type: 'property', detail: 'Exact label matching' },
  { label: 'template', type: 'property', detail: 'Pod template' },
  { label: 'containers', type: 'property', detail: 'Container list' },
  { label: 'image', type: 'property', detail: 'Container image', info: 'e.g., nginx:latest' },
  { label: 'ports', type: 'property', detail: 'Port list' },
  { label: 'containerPort', type: 'property', detail: 'Container port number' },
  { label: 'protocol', type: 'property', detail: 'TCP or UDP' },
  { label: 'env', type: 'property', detail: 'Environment variables' },
  { label: 'envFrom', type: 'property', detail: 'Env from ConfigMap/Secret' },
  { label: 'volumeMounts', type: 'property', detail: 'Volume mount points' },
  { label: 'volumes', type: 'property', detail: 'Volume definitions' },
  { label: 'resources', type: 'property', detail: 'Resource requests/limits' },
  { label: 'requests', type: 'property', detail: 'Minimum resources' },
  { label: 'limits', type: 'property', detail: 'Maximum resources' },
  { label: 'cpu', type: 'property', detail: 'CPU cores', info: 'e.g., 100m, 0.5, 1' },
  { label: 'memory', type: 'property', detail: 'Memory', info: 'e.g., 128Mi, 1Gi' },
  { label: 'readinessProbe', type: 'property', detail: 'Readiness health check' },
  { label: 'livenessProbe', type: 'property', detail: 'Liveness health check' },
  { label: 'httpGet', type: 'property', detail: 'HTTP health check' },
  { label: 'path', type: 'property', detail: 'HTTP path' },
  { label: 'port', type: 'property', detail: 'Port number' },
  { label: 'serviceAccountName', type: 'property', detail: 'Service account' },
  { label: 'nodeSelector', type: 'property', detail: 'Node scheduling constraint' },
  { label: 'tolerations', type: 'property', detail: 'Tolerate node taints' },
  { label: 'affinity', type: 'property', detail: 'Scheduling affinity rules' },
  { label: 'type', type: 'property', detail: 'Resource type', info: 'e.g., ClusterIP, NodePort, LoadBalancer' },
  { label: 'clusterIP', type: 'property', detail: 'Service cluster IP' },
  { label: 'data', type: 'property', detail: 'Data map (ConfigMap/Secret)' },
  { label: 'stringData', type: 'property', detail: 'String data (Secret)' },
  { label: 'accessModes', type: 'property', detail: 'PVC access modes' },
  { label: 'storageClassName', type: 'property', detail: 'Storage class name' },
  { label: 'storage', type: 'property', detail: 'Storage size', info: 'e.g., 10Gi' },
];

// Common values autocomplete
const k8sValues: Completion[] = [
  { label: 'v1', type: 'text', detail: 'Core API' },
  { label: 'apps/v1', type: 'text', detail: 'Apps API' },
  { label: 'batch/v1', type: 'text', detail: 'Batch API' },
  { label: 'networking.k8s.io/v1', type: 'text', detail: 'Networking API' },
  { label: 'rbac.authorization.k8s.io/v1', type: 'text', detail: 'RBAC API' },
  { label: 'Pod', type: 'text', detail: 'Single container group' },
  { label: 'Deployment', type: 'text', detail: 'Managed replica set' },
  { label: 'Service', type: 'text', detail: 'Network endpoint' },
  { label: 'ConfigMap', type: 'text', detail: 'Configuration data' },
  { label: 'Secret', type: 'text', detail: 'Sensitive data' },
  { label: 'Ingress', type: 'text', detail: 'HTTP routing' },
  { label: 'StatefulSet', type: 'text', detail: 'Stateful workload' },
  { label: 'DaemonSet', type: 'text', detail: 'Node-level workload' },
  { label: 'Job', type: 'text', detail: 'Run-to-completion' },
  { label: 'CronJob', type: 'text', detail: 'Scheduled job' },
  { label: 'ClusterIP', type: 'text', detail: 'Internal only' },
  { label: 'NodePort', type: 'text', detail: 'Node port exposure' },
  { label: 'LoadBalancer', type: 'text', detail: 'External LB' },
  { label: 'ReadWriteOnce', type: 'text', detail: 'Single node R/W' },
  { label: 'ReadOnlyMany', type: 'text', detail: 'Multi-node read' },
  { label: 'ReadWriteMany', type: 'text', detail: 'Multi-node R/W' },
  { label: 'Always', type: 'text', detail: 'Always pull image' },
  { label: 'IfNotPresent', type: 'text', detail: 'Pull if missing' },
  { label: 'Never', type: 'text', detail: 'Never pull image' },
  { label: 'RollingUpdate', type: 'text', detail: 'Rolling update strategy' },
  { label: 'Recreate', type: 'text', detail: 'Recreate strategy' },
];

function k8sCompletion(context: CompletionContext) {
  const word = context.matchBefore(/[\w./]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const line = context.state.doc.lineAt(context.pos);
  const lineText = line.text;
  const isValue = lineText.includes(':');
  const beforeColon = lineText.split(':')[0].trim();

  // After colon = value position
  if (isValue && context.pos > line.from + lineText.indexOf(':')) {
    return { from: word.from, options: k8sValues, filter: true };
  }

  // Before colon = key position
  return { from: word.from, options: k8sKeywords, filter: true };
}

export default function YamlEditor({
  value, onChange, readOnly = false, height = '100%', onSave, showDiff = false, originalValue, resourceGvk,
}: YamlEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [internalValue, setInternalValue] = useState(value);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [showDiffPreview, setShowDiffPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sidePanel, setSidePanel] = useState<'none' | 'snippets' | 'help' | 'schema'>('none');
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [showDiffMode, setShowDiffMode] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [cursorField, setCursorField] = useState<string | null>(null);

  // Detect kind from YAML for contextual snippets
  const detectedKind = useMemo(() => {
    const m = internalValue.match(/^kind:\s*(.+)$/m);
    return m?.[1]?.trim() || null;
  }, [internalValue]);

  // Context-aware sub-snippets for the current resource type
  const contextSnippets = useMemo(() => {
    const all: Array<{ label: string; description: string; yaml: string; kinds: string[] }> = [
      { label: 'Container', description: 'Add a container to spec', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job', 'CronJob'], yaml: '      - name: my-container\n        image: nginx:latest\n        ports:\n        - containerPort: 80' },
      { label: 'Resource Limits', description: 'CPU and memory limits', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job'], yaml: '        resources:\n          requests:\n            cpu: 100m\n            memory: 128Mi\n          limits:\n            cpu: 500m\n            memory: 256Mi' },
      { label: 'Readiness Probe', description: 'HTTP readiness check', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'], yaml: '        readinessProbe:\n          httpGet:\n            path: /healthz\n            port: 8080\n          initialDelaySeconds: 5\n          periodSeconds: 10' },
      { label: 'Liveness Probe', description: 'HTTP liveness check', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'], yaml: '        livenessProbe:\n          httpGet:\n            path: /healthz\n            port: 8080\n          initialDelaySeconds: 15\n          periodSeconds: 20' },
      { label: 'Environment Variable', description: 'Add env var', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job', 'CronJob'], yaml: '        env:\n        - name: MY_VAR\n          value: "my-value"' },
      { label: 'Env from Secret', description: 'Env from secret key', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job'], yaml: '        env:\n        - name: DB_PASSWORD\n          valueFrom:\n            secretKeyRef:\n              name: my-secret\n              key: password' },
      { label: 'Volume Mount', description: 'Mount a ConfigMap/Secret', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job'], yaml: '        volumeMounts:\n        - name: config-vol\n          mountPath: /etc/config\n      volumes:\n      - name: config-vol\n        configMap:\n          name: my-config' },
      { label: 'Node Selector', description: 'Schedule on specific nodes', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job'], yaml: '      nodeSelector:\n        kubernetes.io/os: linux' },
      { label: 'Toleration', description: 'Tolerate a taint', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'], yaml: '      tolerations:\n      - key: "node-role.kubernetes.io/master"\n        operator: "Exists"\n        effect: "NoSchedule"' },
      { label: 'Init Container', description: 'Run before main containers', kinds: ['Deployment', 'StatefulSet', 'Pod', 'Job'], yaml: '      initContainers:\n      - name: init\n        image: busybox:latest\n        command: ["sh", "-c", "echo init"]' },
      { label: 'Service Port', description: 'Add port mapping', kinds: ['Service'], yaml: '  - name: http\n    port: 80\n    targetPort: 8080\n    protocol: TCP' },
      { label: 'Ingress Rule', description: 'Add HTTP routing rule', kinds: ['Ingress'], yaml: '  - host: example.com\n    http:\n      paths:\n      - path: /\n        pathType: Prefix\n        backend:\n          service:\n            name: my-service\n            port:\n              number: 80' },
      { label: 'Data Entry', description: 'Add key-value data', kinds: ['ConfigMap', 'Secret'], yaml: '  my-key: my-value' },
      // PVC context snippets
      { label: 'Storage Class', description: 'Set the storage class', kinds: ['PersistentVolumeClaim'], yaml: '  storageClassName: gp3-csi' },
      { label: 'Access Mode RWX', description: 'Change to ReadWriteMany (shared)', kinds: ['PersistentVolumeClaim'], yaml: '  accessModes:\n  - ReadWriteMany' },
      { label: 'Block Volume Mode', description: 'Use raw block device instead of filesystem', kinds: ['PersistentVolumeClaim'], yaml: '  volumeMode: Block' },
      { label: 'Data Source (Snapshot)', description: 'Restore from a VolumeSnapshot', kinds: ['PersistentVolumeClaim'], yaml: '  dataSource:\n    name: my-snapshot\n    kind: VolumeSnapshot\n    apiGroup: snapshot.storage.k8s.io' },
      { label: 'Data Source (Clone)', description: 'Clone from another PVC', kinds: ['PersistentVolumeClaim'], yaml: '  dataSource:\n    name: source-pvc\n    kind: PersistentVolumeClaim' },
      { label: 'Labels', description: 'Add labels for selection', kinds: ['PersistentVolumeClaim'], yaml: '  labels:\n    app: my-app\n    tier: storage' },
      // StorageClass context snippets
      { label: 'Reclaim Policy', description: 'Set to Retain for production data', kinds: ['StorageClass'], yaml: 'reclaimPolicy: Retain' },
      { label: 'Volume Binding', description: 'WaitForFirstConsumer (recommended)', kinds: ['StorageClass'], yaml: 'volumeBindingMode: WaitForFirstConsumer' },
      { label: 'Allow Expansion', description: 'Enable volume resizing', kinds: ['StorageClass'], yaml: 'allowVolumeExpansion: true' },
      { label: 'Set as Default', description: 'Make this the default StorageClass', kinds: ['StorageClass'], yaml: '  annotations:\n    storageclass.kubernetes.io/is-default-class: "true"' },
      // PVC volume mount for workloads
      { label: 'PVC Volume Mount', description: 'Mount a PersistentVolumeClaim', kinds: ['Deployment', 'StatefulSet', 'Pod', 'Job'], yaml: '        volumeMounts:\n        - name: data\n          mountPath: /data\n      volumes:\n      - name: data\n        persistentVolumeClaim:\n          claimName: my-pvc' },
      // VolumeClaimTemplate for StatefulSets
      { label: 'Volume Claim Template', description: 'Auto-create PVCs per replica', kinds: ['StatefulSet'], yaml: '  volumeClaimTemplates:\n  - metadata:\n      name: data\n    spec:\n      accessModes: ["ReadWriteOnce"]\n      storageClassName: gp3-csi\n      resources:\n        requests:\n          storage: 10Gi' },
      // Route (OpenShift) context snippets
      { label: 'TLS Edge Termination', description: 'Terminate TLS at the router', kinds: ['Route'], yaml: '  tls:\n    termination: edge\n    insecureEdgeTerminationPolicy: Redirect' },
      { label: 'TLS Passthrough', description: 'Pass TLS directly to the backend', kinds: ['Route'], yaml: '  tls:\n    termination: passthrough\n    insecureEdgeTerminationPolicy: None' },
      { label: 'TLS Re-encrypt', description: 'Re-encrypt traffic to backend', kinds: ['Route'], yaml: '  tls:\n    termination: reencrypt\n    insecureEdgeTerminationPolicy: Redirect\n    destinationCACertificate: |\n      -----BEGIN CERTIFICATE-----\n      ...\n      -----END CERTIFICATE-----' },
      { label: 'Route Path', description: 'Route to a specific path', kinds: ['Route'], yaml: '  path: /api' },
      { label: 'Alternate Backend', description: 'Split traffic across services', kinds: ['Route'], yaml: '  alternateBackends:\n  - kind: Service\n    name: canary-service\n    weight: 20' },
      { label: 'Rate Limit Annotations', description: 'Rate limiting via HAProxy annotations', kinds: ['Route'], yaml: '  annotations:\n    haproxy.router.openshift.io/rate-limit-connections: "true"\n    haproxy.router.openshift.io/rate-limit-connections.concurrent-tcp: "100"\n    haproxy.router.openshift.io/rate-limit-connections.rate-http: "50"\n    haproxy.router.openshift.io/rate-limit-connections.rate-tcp: "50"' },
      // NetworkPolicy context snippets
      { label: 'Allow from Namespace', description: 'Ingress rule: allow from labeled namespace', kinds: ['NetworkPolicy'], yaml: '  ingress:\n  - from:\n    - namespaceSelector:\n        matchLabels:\n          name: trusted-namespace' },
      { label: 'Allow from Pod', description: 'Ingress rule: allow from labeled pods', kinds: ['NetworkPolicy'], yaml: '  ingress:\n  - from:\n    - podSelector:\n        matchLabels:\n          role: frontend\n    ports:\n    - protocol: TCP\n      port: 80' },
      { label: 'Egress to CIDR', description: 'Egress rule: allow traffic to IP range', kinds: ['NetworkPolicy'], yaml: '  egress:\n  - to:\n    - ipBlock:\n        cidr: 10.0.0.0/8\n    ports:\n    - protocol: TCP\n      port: 443' },
      { label: 'Deny All Ingress', description: 'Block all incoming traffic', kinds: ['NetworkPolicy'], yaml: '  policyTypes:\n  - Ingress\n  ingress: []' },
      { label: 'Deny All Egress', description: 'Block all outgoing traffic', kinds: ['NetworkPolicy'], yaml: '  policyTypes:\n  - Egress\n  egress: []' },
      // CronJob context snippets
      { label: 'Every 5 Minutes', description: 'Schedule: */5 * * * *', kinds: ['CronJob'], yaml: '  schedule: "*/5 * * * *"' },
      { label: 'Hourly', description: 'Schedule: 0 * * * *', kinds: ['CronJob'], yaml: '  schedule: "0 * * * *"' },
      { label: 'Daily at Midnight', description: 'Schedule: 0 0 * * *', kinds: ['CronJob'], yaml: '  schedule: "0 0 * * *"' },
      { label: 'Weekly (Sunday)', description: 'Schedule: 0 0 * * 0', kinds: ['CronJob'], yaml: '  schedule: "0 0 * * 0"' },
      { label: 'Job Template', description: 'Job template with restart policy', kinds: ['CronJob'], yaml: '  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n          - name: job\n            image: busybox:latest\n            command: ["sh", "-c", "echo hello"]\n          restartPolicy: OnFailure' },
      { label: 'Concurrency Policy', description: 'Control concurrent job execution', kinds: ['CronJob'], yaml: '  concurrencyPolicy: Forbid  # Allow | Forbid | Replace' },
      { label: 'History Limits', description: 'Limit kept job history', kinds: ['CronJob'], yaml: '  successfulJobsHistoryLimit: 3\n  failedJobsHistoryLimit: 1' },
      // Job context snippets
      { label: 'Backoff Limit', description: 'Max retries before marking failed', kinds: ['Job'], yaml: '  backoffLimit: 4' },
      { label: 'Active Deadline', description: 'Max seconds before job is terminated', kinds: ['Job'], yaml: '  activeDeadlineSeconds: 600' },
      { label: 'TTL After Finished', description: 'Auto-delete job after completion', kinds: ['Job'], yaml: '  ttlSecondsAfterFinished: 3600' },
      { label: 'Parallelism', description: 'Run multiple pods in parallel', kinds: ['Job'], yaml: '  parallelism: 3\n  completions: 5' },
      // Namespace context snippets
      { label: 'Network Policy Labels', description: 'Labels for network policy selection', kinds: ['Namespace'], yaml: '  labels:\n    name: my-namespace\n    environment: production' },
      { label: 'Resource Quota Annotation', description: 'Annotate with quota info', kinds: ['Namespace'], yaml: '  annotations:\n    openshift.io/requester: admin\n    openshift.io/description: "Production namespace"' },
      { label: 'Pod Security Labels', description: 'Enforce pod security standards', kinds: ['Namespace'], yaml: '  labels:\n    pod-security.kubernetes.io/enforce: restricted\n    pod-security.kubernetes.io/warn: restricted\n    pod-security.kubernetes.io/audit: restricted' },
      // ServiceAccount context snippets
      { label: 'Image Pull Secret', description: 'Add image pull secret reference', kinds: ['ServiceAccount'], yaml: 'imagePullSecrets:\n- name: my-registry-secret' },
      { label: 'Disable Automount Token', description: 'Do not automount API token', kinds: ['ServiceAccount'], yaml: 'automountServiceAccountToken: false' },
      // RoleBinding/ClusterRoleBinding context snippets
      { label: 'Subject (User)', description: 'Bind to a user', kinds: ['RoleBinding', 'ClusterRoleBinding'], yaml: 'subjects:\n- kind: User\n  name: jane\n  apiGroup: rbac.authorization.k8s.io' },
      { label: 'Subject (Group)', description: 'Bind to a group', kinds: ['RoleBinding', 'ClusterRoleBinding'], yaml: 'subjects:\n- kind: Group\n  name: developers\n  apiGroup: rbac.authorization.k8s.io' },
      { label: 'Subject (ServiceAccount)', description: 'Bind to a service account', kinds: ['RoleBinding', 'ClusterRoleBinding'], yaml: 'subjects:\n- kind: ServiceAccount\n  name: my-sa\n  namespace: my-namespace' },
      // Role/ClusterRole context snippets
      { label: 'Rule (Read Only)', description: 'Allow get, list, watch', kinds: ['Role', 'ClusterRole'], yaml: 'rules:\n- apiGroups: [""]\n  resources: ["pods", "services", "configmaps"]\n  verbs: ["get", "list", "watch"]' },
      { label: 'Rule (Read-Write)', description: 'Allow full CRUD access', kinds: ['Role', 'ClusterRole'], yaml: 'rules:\n- apiGroups: [""]\n  resources: ["pods", "services", "configmaps"]\n  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]' },
      { label: 'Rule (Specific Resource)', description: 'Access a named resource', kinds: ['Role', 'ClusterRole'], yaml: 'rules:\n- apiGroups: [""]\n  resources: ["secrets"]\n  resourceNames: ["my-secret"]\n  verbs: ["get"]' },
      // HorizontalPodAutoscaler context snippets
      { label: 'CPU Metric', description: 'Scale on CPU utilization', kinds: ['HorizontalPodAutoscaler'], yaml: '  metrics:\n  - type: Resource\n    resource:\n      name: cpu\n      target:\n        type: Utilization\n        averageUtilization: 70' },
      { label: 'Memory Metric', description: 'Scale on memory utilization', kinds: ['HorizontalPodAutoscaler'], yaml: '  metrics:\n  - type: Resource\n    resource:\n      name: memory\n      target:\n        type: Utilization\n        averageUtilization: 80' },
      { label: 'Custom Metric', description: 'Scale on a custom metric', kinds: ['HorizontalPodAutoscaler'], yaml: '  metrics:\n  - type: Pods\n    pods:\n      metric:\n        name: requests_per_second\n      target:\n        type: AverageValue\n        averageValue: "1000"' },
      // Deployment additional context snippets
      { label: 'Rolling Update Strategy', description: 'Configure rolling update params', kinds: ['Deployment'], yaml: '  strategy:\n    type: RollingUpdate\n    rollingUpdate:\n      maxSurge: 25%\n      maxUnavailable: 25%' },
      { label: 'Pod Anti-Affinity', description: 'Spread pods across nodes', kinds: ['Deployment', 'StatefulSet'], yaml: '      affinity:\n        podAntiAffinity:\n          preferredDuringSchedulingIgnoredDuringExecution:\n          - weight: 100\n            podAffinityTerm:\n              labelSelector:\n                matchExpressions:\n                - key: app\n                  operator: In\n                  values:\n                  - my-app\n              topologyKey: kubernetes.io/hostname' },
      { label: 'Security Context (Non-Root)', description: 'Run container as non-root', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Job'], yaml: '        securityContext:\n          runAsNonRoot: true\n          allowPrivilegeEscalation: false\n          capabilities:\n            drop:\n            - ALL\n          seccompProfile:\n            type: RuntimeDefault' },
      { label: 'Image Pull Policy', description: 'Set image pull policy', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'], yaml: '        imagePullPolicy: IfNotPresent  # Always | IfNotPresent | Never' },
      { label: 'Service Account', description: 'Set service account for pod', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'], yaml: '      serviceAccountName: my-service-account' },
      // Pod additional context snippets
      { label: 'Pod Security Context', description: 'Run pod as non-root user', kinds: ['Pod'], yaml: '  securityContext:\n    runAsNonRoot: true\n    runAsUser: 1000\n    fsGroup: 1000' },
      { label: 'DNS Policy', description: 'Set DNS resolution policy', kinds: ['Pod'], yaml: '  dnsPolicy: ClusterFirst  # Default | ClusterFirst | ClusterFirstWithHostNet | None' },
      { label: 'Restart Policy', description: 'Set pod restart behavior', kinds: ['Pod', 'Job'], yaml: '  restartPolicy: OnFailure  # Always | OnFailure | Never' },
      // Secret type context snippets
      { label: 'TLS Secret Type', description: 'Secret for TLS certificate/key pair', kinds: ['Secret'], yaml: 'type: kubernetes.io/tls\ndata:\n  tls.crt: <base64-encoded-cert>\n  tls.key: <base64-encoded-key>' },
      { label: 'Docker Registry Type', description: 'Secret for container registry auth', kinds: ['Secret'], yaml: 'type: kubernetes.io/dockerconfigjson\ndata:\n  .dockerconfigjson: <base64-encoded-docker-config>' },
      { label: 'Basic Auth Type', description: 'Secret for basic authentication', kinds: ['Secret'], yaml: 'type: kubernetes.io/basic-auth\nstringData:\n  username: admin\n  password: changeme' },
    ];

    if (!detectedKind) return [];
    return all.filter((s) => s.kinds.includes(detectedKind));
  }, [detectedKind]);

  useEffect(() => { setInternalValue(value); }, [value]);

  const hasChanges = useMemo(() => originalValue !== undefined && internalValue !== originalValue, [internalValue, originalValue]);

  const handleChange = useCallback((newValue: string) => {
    setInternalValue(newValue);
    onChange?.(newValue);
  }, [onChange]);

  const handleSave = useCallback(async () => {
    if (!onSave || readOnly) return;
    setIsSaving(true);
    try { await onSave(internalValue); setShowDiffPreview(false); } finally { setIsSaving(false); }
  }, [onSave, internalValue, readOnly]);

  const handleDiscard = useCallback(() => {
    if (originalValue !== undefined) { setInternalValue(originalValue); onChange?.(originalValue); }
    setShowDiffPreview(false);
  }, [originalValue, onChange]);

  // Insert text at cursor position in CodeMirror
  const insertAtCursor = useCallback((text: string) => {
    const view = editorRef.current?.view;
    if (view) {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);

      // Add newline before if cursor isn't at start of a line
      const prefix = line.from === pos ? '' : '\n';
      const insertText = prefix + text + '\n';

      view.dispatch({
        changes: { from: pos, insert: insertText },
        selection: { anchor: pos + insertText.length },
      });

      // Sync with React state
      const newValue = view.state.doc.toString();
      setInternalValue(newValue);
      onChange?.(newValue);
      view.focus();
    } else {
      // Fallback: append to end
      const newValue = internalValue + '\n' + text;
      setInternalValue(newValue);
      onChange?.(newValue);
    }
  }, [internalValue, onChange]);

  const insertSnippet = useCallback((snippet: Snippet) => {
    const resolved = resolveSnippet(snippet);
    if (internalValue.trim()) {
      // Full resource templates go after a document separator
      const view = editorRef.current?.view;
      if (view) {
        const end = view.state.doc.length;
        const insertText = '\n---\n' + resolved;
        view.dispatch({
          changes: { from: end, insert: insertText },
          selection: { anchor: end + insertText.length },
        });
        const newValue = view.state.doc.toString();
        setInternalValue(newValue);
        onChange?.(newValue);
        view.focus();
      } else {
        setInternalValue(internalValue + '\n---\n' + resolved);
        onChange?.(internalValue + '\n---\n' + resolved);
      }
    } else {
      setInternalValue(resolved);
      onChange?.(resolved);
    }
    setCopiedSnippet(snippet.prefix);
    setTimeout(() => setCopiedSnippet(null), 1500);
  }, [internalValue, onChange]);

  const saveKeymap = useMemo(() => keymap.of([{
    key: 'Mod-s',
    run: () => {
      if (!readOnly && hasChanges) { showDiff ? setShowDiffPreview(true) : handleSave(); }
      return true;
    },
  }]), [readOnly, hasChanges, showDiff, handleSave]);

  const handleCursorActivity = useCallback((view: EditorView) => {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    setCursorPosition({ line: line.number, column: pos - line.from + 1 });
  }, []);

  // YAML linter — validates structure
  const yamlLinter = useMemo(() => linter((view) => {
    const diagnostics: Diagnostic[] = [];
    const text = view.state.doc.toString();
    const errors: string[] = [];

    // Check for tab characters
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('\t')) {
        const pos = view.state.doc.line(i + 1);
        diagnostics.push({ from: pos.from, to: pos.to, severity: 'error', message: 'Tabs are not allowed in YAML — use spaces' });
        errors.push(`Line ${i + 1}: tabs not allowed`);
      }
      // Check for inconsistent indentation
      const indent = lines[i].match(/^(\s*)/)?.[1] || '';
      if (indent.length % 2 !== 0 && indent.length > 0 && !lines[i].trim().startsWith('-') && !lines[i].trim().startsWith('#')) {
        const pos = view.state.doc.line(i + 1);
        diagnostics.push({ from: pos.from, to: pos.from + indent.length, severity: 'warning', message: 'Odd indentation — YAML typically uses 2-space indent' });
      }
    }

    // Check required K8s fields
    if (text.length > 10) {
      if (!text.match(/^apiVersion:/m)) {
        errors.push('Missing required field: apiVersion');
        diagnostics.push({ from: 0, to: 0, severity: 'warning', message: 'Missing apiVersion field' });
      }
      if (!text.match(/^kind:/m)) {
        errors.push('Missing required field: kind');
        diagnostics.push({ from: 0, to: 0, severity: 'warning', message: 'Missing kind field' });
      }
      if (!text.match(/^metadata:/m)) {
        errors.push('Missing required field: metadata');
      }
    }

    // Check for duplicate keys at same level
    const keyPattern = /^(\s*)(\w[\w.-]*)\s*:/gm;
    const keysByIndent = new Map<string, Set<string>>();
    let match;
    while ((match = keyPattern.exec(text)) !== null) {
      const indent = match[1];
      const key = match[2];
      const levelKey = `${indent.length}:${key}`;
      // Simple duplicate detection within nearby lines
      if (!keysByIndent.has(indent)) keysByIndent.set(indent, new Set());
    }

    setValidationErrors(errors);
    return diagnostics;
  }, { delay: 500 }), []);

  // Detect field at cursor for documentation
  const handleCursorChange = useCallback((view: EditorView) => {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;

    // Extract the YAML path at cursor
    const keyMatch = lineText.match(/^\s*(\w[\w.-]*)\s*:/);
    if (keyMatch) {
      // Build the full path by looking at indentation
      const currentIndent = (lineText.match(/^(\s*)/)?.[1] || '').length;
      const pathParts: string[] = [keyMatch[1]];

      // Walk backwards to find parent keys
      for (let lineNum = line.number - 1; lineNum >= 1; lineNum--) {
        const prevLine = view.state.doc.line(lineNum).text;
        const prevIndent = (prevLine.match(/^(\s*)/)?.[1] || '').length;
        const prevKey = prevLine.match(/^\s*(\w[\w.-]*)\s*:/);
        if (prevKey && prevIndent < currentIndent) {
          pathParts.unshift(prevKey[1]);
          if (prevIndent === 0) break;
        }
      }

      setCursorField(pathParts.join('.'));
    } else {
      setCursorField(null);
    }

    // Also update cursor position
    setCursorPosition({ line: line.number, column: pos - line.from + 1 });
  }, []);

  const extensions = useMemo(() => [
    yaml(),
    lineNumbers(),
    foldGutter(),
    bracketMatching(),
    highlightActiveLine(),
    autocompletion({ override: [k8sCompletion], activateOnTyping: true }),
    yamlLinter,
    saveKeymap,
    EditorView.updateListener.of((update) => {
      if (update.selectionSet) handleCursorChange(update.view);
    }),
  ], [saveKeymap, handleCursorChange, yamlLinter]);

  return (
    <div className="flex" style={{ height }}>
      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <CodeMirror
            ref={editorRef}
            value={internalValue}
            onChange={handleChange}
            extensions={extensions}
            theme={oneDark}
            editable={!readOnly}
            basicSetup={false}
            className="font-mono text-[13px] bg-slate-950"
            style={{ minHeight: '100%' }}
          />
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-4">
            <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
            <span>YAML</span>
            {cursorField && <span className="text-blue-400 font-mono">{cursorField}</span>}
            {validationErrors.length > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <AlertTriangle className="w-3 h-3" />
                {validationErrors.length} issue{validationErrors.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {originalValue && (
              <button
                onClick={() => setShowDiffMode(!showDiffMode)}
                className={cn('flex items-center gap-1 px-2 py-0.5 rounded transition-colors', showDiffMode ? 'bg-purple-600 text-white' : 'hover:bg-slate-800')}
                title="Show diff against original"
              >
                <GitCompare className="w-3 h-3" />
                Diff
              </button>
            )}
            <button
              onClick={() => setSidePanel(sidePanel === 'schema' ? 'none' : 'schema')}
              className={cn('flex items-center gap-1 px-2 py-0.5 rounded transition-colors', sidePanel === 'schema' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800')}
              title="API Schema"
            >
              <BookOpen className="w-3 h-3" />
              Schema
            </button>
            <button
              onClick={() => setSidePanel(sidePanel === 'snippets' ? 'none' : 'snippets')}
              className={cn('flex items-center gap-1 px-2 py-0.5 rounded transition-colors', sidePanel === 'snippets' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800')}
              title="Insert snippet"
            >
              <Puzzle className="w-3 h-3" />
              Snippets
            </button>
            <button
              onClick={() => setSidePanel(sidePanel === 'help' ? 'none' : 'help')}
              className={cn('flex items-center gap-1 px-2 py-0.5 rounded transition-colors', sidePanel === 'help' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800')}
              title="YAML help"
            >
              <HelpCircle className="w-3 h-3" />
              Help
            </button>
            {!readOnly && onSave && (
              <button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className={cn('flex items-center gap-1 px-2 py-0.5 rounded transition-colors', hasChanges ? 'hover:bg-slate-800 text-emerald-400' : 'opacity-50 cursor-not-allowed')}
                title="Save (⌘S)"
              >
                <Save className="w-3 h-3" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline Diff View */}
      {showDiffMode && originalValue && (
        <div className="w-80 flex-shrink-0 border-l border-slate-700 bg-slate-900 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
            <span className="text-sm font-semibold text-slate-200">Changes</span>
            <button onClick={() => setShowDiffMode(false)} className="text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto font-mono text-[11px] p-2">
            {(() => {
              const oldLines = originalValue.split('\n');
              const newLines = internalValue.split('\n');
              const maxLen = Math.max(oldLines.length, newLines.length);
              const diffs: Array<{ type: 'same' | 'add' | 'remove' | 'change'; lineNum: number; old?: string; new?: string }> = [];

              for (let i = 0; i < maxLen; i++) {
                const o = oldLines[i];
                const n = newLines[i];
                if (o === n) {
                  // skip unchanged
                } else if (o === undefined) {
                  diffs.push({ type: 'add', lineNum: i + 1, new: n });
                } else if (n === undefined) {
                  diffs.push({ type: 'remove', lineNum: i + 1, old: o });
                } else {
                  diffs.push({ type: 'change', lineNum: i + 1, old: o, new: n });
                }
              }

              if (diffs.length === 0) {
                return <div className="text-center py-8 text-slate-500 text-xs">No changes</div>;
              }

              return (
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 mb-2">{diffs.length} change{diffs.length !== 1 ? 's' : ''}</div>
                  {diffs.map((d, i) => (
                    <div key={i} className="rounded overflow-hidden">
                      {d.old !== undefined && (
                        <div className="bg-red-950/30 text-red-300 px-2 py-0.5 border-l-2 border-red-500">
                          <span className="text-red-500/50 mr-2">{d.lineNum}</span>- {d.old}
                        </div>
                      )}
                      {d.new !== undefined && (
                        <div className="bg-green-950/30 text-green-300 px-2 py-0.5 border-l-2 border-green-500">
                          <span className="text-green-500/50 mr-2">{d.lineNum}</span>+ {d.new}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Side Panel */}
      {sidePanel !== 'none' && (
        <div className="w-72 flex-shrink-0 border-l border-slate-700 bg-slate-900 flex flex-col overflow-hidden">
          {sidePanel === 'schema' ? (
            <SchemaPanel gvk={resourceGvk} yamlContent={internalValue} />
          ) : (
          <>
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
            <span className="text-sm font-semibold text-slate-200">
              {sidePanel === 'snippets' ? 'Snippets' : 'YAML Help'}
            </span>
            <button onClick={() => setSidePanel('none')} className="text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            {sidePanel === 'snippets' && (
              <div className="p-2 space-y-1">
                {/* Context-aware sub-snippets based on current YAML */}
                {detectedKind && (
                  <>
                    <div className="px-2 py-1 text-xs text-slate-500 uppercase tracking-wider font-semibold">
                      Add to {detectedKind}
                    </div>
                    {contextSnippets.map((cs) => (
                      <button
                        key={cs.label}
                        onClick={() => insertAtCursor(cs.yaml)}
                        className="w-full flex items-start gap-2 p-2 rounded hover:bg-slate-800 transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-200">{cs.label}</div>
                          <div className="text-xs text-slate-500">{cs.description}</div>
                        </div>
                        <Copy className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                      </button>
                    ))}
                    <div className="border-t border-slate-700 my-2" />
                    <div className="px-2 py-1 text-xs text-slate-500 uppercase tracking-wider font-semibold">
                      Full Resource Templates
                    </div>
                  </>
                )}
                {snippets.map((snippet) => (
                  <button
                    key={snippet.prefix}
                    onClick={() => insertSnippet(snippet)}
                    className="w-full flex items-start gap-2 p-2 rounded hover:bg-slate-800 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-200">{snippet.label}</div>
                      <div className="text-xs text-slate-500">{snippet.description}</div>
                    </div>
                    {copiedSnippet === snippet.prefix ? (
                      <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {sidePanel === 'help' && (
              <div className="p-3 space-y-4 text-xs">
                <div>
                  <h4 className="font-semibold text-slate-300 mb-2">Keyboard Shortcuts</h4>
                  <div className="space-y-1">
                    <KbdRow keys="⌘ S" label="Save changes" />
                    <KbdRow keys="⌘ Z" label="Undo" />
                    <KbdRow keys="⌘ ⇧ Z" label="Redo" />
                    <KbdRow keys="⌘ /" label="Toggle comment" />
                    <KbdRow keys="⌘ D" label="Select next occurrence" />
                    <KbdRow keys="Ctrl Space" label="Trigger autocomplete" />
                    <KbdRow keys="⌘ F" label="Find" />
                    <KbdRow keys="Tab" label="Indent" />
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-300 mb-2">Autocomplete</h4>
                  <p className="text-slate-400 leading-relaxed">
                    Start typing any K8s field name and autocomplete will suggest options.
                    Press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">Ctrl+Space</kbd> to
                    manually trigger. After a colon, values like API versions and kinds are suggested.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-300 mb-2">YAML Tips</h4>
                  <ul className="space-y-1 text-slate-400">
                    <li>• Use <code className="text-emerald-400">---</code> to separate multiple documents</li>
                    <li>• Indentation must be spaces, not tabs (2 spaces standard)</li>
                    <li>• Strings don't need quotes unless they contain special characters</li>
                    <li>• Use <code className="text-emerald-400">|</code> for multi-line strings</li>
                    <li>• Use <code className="text-emerald-400">&gt;</code> for folded (single-line) strings</li>
                    <li>• Lists use <code className="text-emerald-400">- </code> prefix (dash + space)</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-300 mb-2">Common Patterns</h4>
                  <CodeExample title="Labels" code={`metadata:\n  labels:\n    app: my-app\n    version: v1`} />
                  <CodeExample title="Resource Limits" code={`resources:\n  requests:\n    cpu: 100m\n    memory: 128Mi\n  limits:\n    cpu: 500m\n    memory: 256Mi`} />
                  <CodeExample title="Health Check" code={`readinessProbe:\n  httpGet:\n    path: /healthz\n    port: 8080\n  initialDelaySeconds: 5\n  periodSeconds: 10`} />
                  <CodeExample title="Volume Mount" code={`volumeMounts:\n- name: config\n  mountPath: /etc/config\nvolumes:\n- name: config\n  configMap:\n    name: my-config`} />
                  <CodeExample title="Env from Secret" code={`env:\n- name: DB_PASSWORD\n  valueFrom:\n    secretKeyRef:\n      name: db-secret\n      key: password`} />
                </div>
              </div>
            )}
          </div>
          </>
          )}
        </div>
      )}

      {/* Diff Preview */}
      {showDiff && showDiffPreview && originalValue && (
        <DiffPreview original={originalValue} modified={internalValue} onApply={handleSave} onDiscard={handleDiscard} loading={isSaving} />
      )}
    </div>
  );
}

function KbdRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-slate-400">{label}</span>
      <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-xs font-mono text-slate-300">{keys}</kbd>
    </div>
  );
}

function CodeExample({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-400">{title}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1000); }}
          className="text-slate-500 hover:text-slate-300"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <pre className="bg-slate-950 rounded p-2 text-[11px] text-emerald-400 font-mono overflow-x-auto">{code}</pre>
    </div>
  );
}
