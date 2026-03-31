export interface QuickAction {
  label: string;
  route: string;
  icon: string;
}

export interface AskPulseResponse {
  text: string;
  suggestions: string[];
  actions: QuickAction[];
}

const QUESTION_WORDS = new Set([
  'what', 'why', 'how', 'show', 'find', 'list', 'which',
  'is', 'are', 'can', 'tell', 'where', 'when', 'do', 'does',
]);

const NL_PATTERNS = [
  'my pods', 'my deployments', 'my nodes',
  'over-provisioned', 'under-provisioned',
  'failing', 'crashed', 'crashloop', 'not ready',
  'high cpu', 'high memory', 'out of memory', 'oom',
  'disk pressure', 'node pressure',
];

/** Returns true if the query looks like a natural language question rather than a resource name. */
export function detectNaturalLanguage(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;

  // Contains a question mark
  if (trimmed.includes('?')) return true;

  const words = trimmed.toLowerCase().split(/\s+/);

  // Starts with a question/command word
  if (QUESTION_WORDS.has(words[0])) return true;

  // 4+ words likely means a sentence
  if (words.length >= 4) return true;

  // Matches known NL patterns
  const lower = trimmed.toLowerCase();
  if (NL_PATTERNS.some((p) => lower.includes(p))) return true;

  return false;
}

const MOCK_RESPONSES: Array<{ keywords: string[]; response: AskPulseResponse }> = [
  {
    keywords: ['pod', 'failing', 'crash', 'crashloop', 'restart', 'not ready'],
    response: {
      text: 'I found 3 pods in CrashLoopBackOff across 2 namespaces. The most common cause is missing ConfigMap references.',
      suggestions: [
        'Show me pod logs',
        'Which namespaces have failing pods?',
        'Auto-fix crashlooping pods',
      ],
      actions: [
        { label: 'View Workloads', route: '/workloads', icon: 'Package' },
        { label: 'Open Incidents', route: '/incidents', icon: 'Bell' },
      ],
    },
  },
  {
    keywords: ['node', 'capacity', 'cpu', 'memory', 'pressure', 'resource'],
    response: {
      text: 'Cluster capacity is at 72% CPU and 68% memory utilization. 2 nodes are approaching resource pressure thresholds.',
      suggestions: [
        'Which nodes are under pressure?',
        'Show me resource quotas',
        'List over-provisioned workloads',
      ],
      actions: [
        { label: 'View Compute', route: '/compute', icon: 'Server' },
        { label: 'Cluster Pulse', route: '/pulse', icon: 'Activity' },
      ],
    },
  },
  {
    keywords: ['deploy', 'deployment', 'scale', 'replica', 'rollout'],
    response: {
      text: 'There are 47 deployments across all namespaces. 3 have pending rollouts and 1 has a replica mismatch.',
      suggestions: [
        'Show deployments with issues',
        'Which deployments are scaling?',
        'List recent rollouts',
      ],
      actions: [
        { label: 'View Workloads', route: '/workloads', icon: 'Package' },
        { label: 'View Deployments', route: '/r/apps~v1~deployments', icon: 'Package' },
      ],
    },
  },
  {
    keywords: ['security', 'rbac', 'permission', 'access', 'role', 'scc'],
    response: {
      text: 'Security scan summary: 4 workloads running as privileged, 2 with host network access. RBAC shows 12 cluster-admin bindings.',
      suggestions: [
        'List privileged workloads',
        'Show cluster-admin bindings',
        'Run security audit',
      ],
      actions: [
        { label: 'Security View', route: '/security', icon: 'ShieldCheck' },
        { label: 'Identity & Access', route: '/identity', icon: 'Shield' },
      ],
    },
  },
  {
    keywords: ['alert', 'firing', 'prometheus', 'silence'],
    response: {
      text: 'Currently 5 alerts firing: 2 critical (KubePodCrashLooping, NodeNotReady), 3 warnings. No active silences.',
      suggestions: [
        'Show critical alerts',
        'Silence a noisy alert',
        'View alert history',
      ],
      actions: [
        { label: 'View Alerts', route: '/alerts', icon: 'Bell' },
        { label: 'Incident Center', route: '/incidents', icon: 'Bell' },
      ],
    },
  },
  {
    keywords: ['storage', 'pvc', 'volume', 'disk', 'pv'],
    response: {
      text: '23 PVCs bound, 2 pending. Total storage allocated: 450Gi. No volumes are approaching capacity limits.',
      suggestions: [
        'Show pending PVCs',
        'List unused volumes',
        'Check storage classes',
      ],
      actions: [
        { label: 'View Storage', route: '/storage', icon: 'HardDrive' },
      ],
    },
  },
  {
    keywords: ['network', 'service', 'route', 'ingress', 'dns'],
    response: {
      text: '89 services, 34 routes, 12 ingresses discovered. All routes have valid TLS certificates.',
      suggestions: [
        'Show services without endpoints',
        'List expiring certificates',
        'Check network policies',
      ],
      actions: [
        { label: 'View Networking', route: '/networking', icon: 'Globe' },
      ],
    },
  },
];

const FALLBACK_RESPONSE: AskPulseResponse = {
  text: 'I can help you investigate that. Let me connect you with the Pulse Agent for a detailed analysis.',
  suggestions: [
    'Show cluster health',
    'List failing pods',
    'Check resource utilization',
  ],
  actions: [
    { label: 'Cluster Pulse', route: '/pulse', icon: 'Activity' },
    { label: 'Incident Center', route: '/incidents', icon: 'Bell' },
  ],
};

/** Returns a mock response matched by keywords in the query. */
export function getMockResponse(query: string): AskPulseResponse {
  const lower = query.toLowerCase();
  for (const entry of MOCK_RESPONSES) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.response;
    }
  }
  return FALLBACK_RESPONSE;
}

const HISTORY_KEY = 'openshiftpulse-ask-history';
const MAX_HISTORY = 5;

/** Returns the last 5 Ask Pulse queries from localStorage. */
export function getRecentQueries(): string[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

/** Saves a query to the Ask Pulse history (deduped, max 5). */
export function saveQuery(query: string): void {
  try {
    const history = getRecentQueries().filter((q) => q !== query);
    const updated = [query, ...history].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}
