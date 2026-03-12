import React, { useState, useRef, useCallback, useEffect } from 'react';

interface WebTerminalProps {
  open: boolean;
  onClose: () => void;
}

interface TerminalEntry {
  id: number;
  command: string;
  output: string;
  isError?: boolean;
}

const BASE = '/api/kubernetes';

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, maxRow) + 2;
  });
  const headerLine = headers.map((h, i) => padRight(h, colWidths[i])).join('');
  const rowLines = rows.map((row) => row.map((cell, i) => padRight(cell, colWidths[i])).join(''));
  return [headerLine, ...rowLines].join('\n');
}

async function k8sFetch(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// --- Command handlers ---

const RESOURCE_MAP: Record<string, { api: string; namespaced: boolean }> = {
  pods: { api: '/api/v1', namespaced: true },
  pod: { api: '/api/v1', namespaced: true },
  po: { api: '/api/v1', namespaced: true },
  nodes: { api: '/api/v1', namespaced: false },
  node: { api: '/api/v1', namespaced: false },
  no: { api: '/api/v1', namespaced: false },
  deployments: { api: '/apis/apps/v1', namespaced: true },
  deployment: { api: '/apis/apps/v1', namespaced: true },
  deploy: { api: '/apis/apps/v1', namespaced: true },
  services: { api: '/api/v1', namespaced: true },
  service: { api: '/api/v1', namespaced: true },
  svc: { api: '/api/v1', namespaced: true },
  namespaces: { api: '/api/v1', namespaced: false },
  namespace: { api: '/api/v1', namespaced: false },
  ns: { api: '/api/v1', namespaced: false },
  configmaps: { api: '/api/v1', namespaced: true },
  configmap: { api: '/api/v1', namespaced: true },
  cm: { api: '/api/v1', namespaced: true },
  secrets: { api: '/api/v1', namespaced: true },
  secret: { api: '/api/v1', namespaced: true },
  statefulsets: { api: '/apis/apps/v1', namespaced: true },
  statefulset: { api: '/apis/apps/v1', namespaced: true },
  sts: { api: '/apis/apps/v1', namespaced: true },
  daemonsets: { api: '/apis/apps/v1', namespaced: true },
  daemonset: { api: '/apis/apps/v1', namespaced: true },
  ds: { api: '/apis/apps/v1', namespaced: true },
  jobs: { api: '/apis/batch/v1', namespaced: true },
  job: { api: '/apis/batch/v1', namespaced: true },
  cronjobs: { api: '/apis/batch/v1', namespaced: true },
  cronjob: { api: '/apis/batch/v1', namespaced: true },
};

function pluralize(resource: string): string {
  const plurals: Record<string, string> = {
    pod: 'pods', po: 'pods', node: 'nodes', no: 'nodes',
    deployment: 'deployments', deploy: 'deployments',
    service: 'services', svc: 'services',
    namespace: 'namespaces', ns: 'namespaces',
    configmap: 'configmaps', cm: 'configmaps',
    secret: 'secrets', statefulset: 'statefulsets', sts: 'statefulsets',
    daemonset: 'daemonsets', ds: 'daemonsets',
    job: 'jobs', cronjob: 'cronjobs',
  };
  return plurals[resource] ?? resource;
}

function parseFlags(args: string[]): { namespace?: string; remaining: string[] } {
  let namespace: string | undefined;
  const remaining: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-n' || args[i] === '--namespace') && args[i + 1]) {
      namespace = args[++i];
    } else if (args[i].startsWith('-n=')) {
      namespace = args[i].slice(3);
    } else {
      remaining.push(args[i]);
    }
  }
  return { namespace, remaining };
}

async function handleGet(resource: string, namespace?: string): Promise<string> {
  const info = RESOURCE_MAP[resource];
  if (!info) return `error: the server doesn't have a resource type "${resource}"`;
  const plural = pluralize(resource);
  const path = info.namespaced && namespace
    ? `${info.api}/namespaces/${namespace}/${plural}`
    : `${info.api}/${plural}`;
  const data = await k8sFetch(path) as { items?: Record<string, unknown>[] };
  if (!data.items?.length) return 'No resources found.';

  const headers = ['NAME', 'NAMESPACE', 'STATUS'];
  const rows = data.items.map((item) => {
    const meta = item['metadata'] as Record<string, unknown>;
    const status = item['status'] as Record<string, unknown> | undefined;
    const phase = status?.['phase'] as string | undefined;
    const conditions = status?.['conditions'] as { type: string; status: string }[] | undefined;
    const readyCond = conditions?.find((c) => c.type === 'Ready');
    const statusText = phase ?? (readyCond?.status === 'True' ? 'Ready' : readyCond ? 'NotReady' : '-');
    return [String(meta?.['name'] ?? ''), String(meta?.['namespace'] ?? '-'), statusText];
  });
  return formatTable(headers, rows);
}

async function handleDelete(resource: string, name: string, namespace?: string): Promise<string> {
  const info = RESOURCE_MAP[resource];
  if (!info) return `error: the server doesn't have a resource type "${resource}"`;
  const plural = pluralize(resource);
  const path = info.namespaced
    ? `${info.api}/namespaces/${namespace ?? 'default'}/${plural}/${name}`
    : `${info.api}/${plural}/${name}`;
  await k8sFetch(path.replace(BASE, '')); // verify it exists first
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return `${resource} "${name}" deleted`;
}

async function handleScale(resource: string, name: string, replicas: number, namespace?: string): Promise<string> {
  const ns = namespace ?? 'default';
  const info = RESOURCE_MAP[resource];
  if (!info) return `error: the server doesn't have a resource type "${resource}"`;
  const plural = pluralize(resource);
  const res = await fetch(`${BASE}${info.api}/namespaces/${ns}/${plural}/${name}/scale`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiVersion: 'autoscaling/v1', kind: 'Scale', metadata: { name, namespace: ns }, spec: { replicas } }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return `${resource} "${name}" scaled to ${replicas}`;
}

async function handleLogs(name: string, namespace?: string): Promise<string> {
  const ns = namespace ?? 'default';
  const res = await fetch(`${BASE}/api/v1/namespaces/${ns}/pods/${name}/log?tailLines=30`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text() || '(no logs)';
}

function showHelp(): string {
  return [
    'Available commands:',
    '',
    '  get <resource> [-n namespace]   List resources (pods, nodes, deploy, svc, ns, cm, secrets, ...)',
    '  delete <resource> <name> [-n ns]  Delete a resource',
    '  scale <resource> <name> <N> [-n ns]  Scale a deployment/statefulset',
    '  logs <pod-name> [-n namespace]  Show last 30 log lines',
    '  whoami                          Show current user',
    '  version                         Show server version',
    '  clear                           Clear terminal',
    '  help                            Show this help',
    '',
    'Prefix with "kubectl" or "oc" (optional). Use -n for namespace.',
    'Examples: get pods -n default, scale deploy api 3, logs nginx-abc -n prod',
  ].join('\n');
}

async function executeCommand(rawCmd: string): Promise<{ output: string; isError?: boolean }> {
  const cmd = rawCmd.replace(/^(kubectl|oc)\s+/, '').trim();
  const parts = cmd.split(/\s+/);
  const verb = parts[0];
  const { namespace, remaining } = parseFlags(parts.slice(1));

  try {
    switch (verb) {
      case 'get':
        return { output: await handleGet(remaining[0], namespace) };
      case 'delete':
        if (!remaining[1]) return { output: 'Usage: delete <resource> <name> [-n ns]', isError: true };
        return { output: await handleDelete(remaining[0], remaining[1], namespace) };
      case 'scale':
        if (!remaining[2]) return { output: 'Usage: scale <resource> <name> <replicas> [-n ns]', isError: true };
        return { output: await handleScale(remaining[0], remaining[1], parseInt(remaining[2]), namespace) };
      case 'logs':
      case 'log':
        if (!remaining[0]) return { output: 'Usage: logs <pod-name> [-n ns]', isError: true };
        return { output: await handleLogs(remaining[0], namespace) };
      case 'whoami': {
        const data = await k8sFetch('/apis/user.openshift.io/v1/users/~') as { metadata: { name: string } };
        return { output: data.metadata.name };
      }
      case 'version': {
        const data = await k8sFetch('/version') as { gitVersion: string; platform: string };
        return { output: `Server Version: ${data.gitVersion}\nPlatform: ${data.platform}` };
      }
      case 'help':
        return { output: showHelp() };
      case 'clear':
        return { output: '__CLEAR__' };
      default:
        return { output: `Unknown command "${verb}". Type "help" for available commands.`, isError: true };
    }
  } catch (err) {
    return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

const WebTerminal: React.FC<WebTerminalProps> = ({ open, onClose }) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TerminalEntry[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [nextId, setNextId] = useState(0);
  const [executing, setExecuting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
  }, [history]);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const newIdx = historyIdx < cmdHistory.length - 1 ? historyIdx + 1 : historyIdx;
        setHistoryIdx(newIdx);
        setInput(cmdHistory[cmdHistory.length - 1 - newIdx] ?? '');
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(cmdHistory[cmdHistory.length - 1 - newIdx] ?? '');
      } else {
        setHistoryIdx(-1);
        setInput('');
      }
      return;
    }
    if (e.key !== 'Enter') return;
    const cmd = input.trim();
    if (!cmd) return;

    setExecuting(true);
    setInput('');
    setCmdHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);

    const result = await executeCommand(cmd);

    if (result.output === '__CLEAR__') {
      setHistory([]);
    } else {
      setHistory((prev) => [...prev, { id: nextId, command: cmd, output: result.output, isError: result.isError }]);
      setNextId((n) => n + 1);
    }
    setExecuting(false);
  }, [input, nextId, cmdHistory, historyIdx]);

  if (!open) return null;

  return (
    <div className="os-terminal">
      <div className="os-terminal__header">
        <span className="os-terminal__title">Terminal</span>
        <button type="button" className="os-terminal__close" aria-label="Close terminal" onClick={onClose}>&#x2715;</button>
      </div>
      <div ref={contentRef} className="os-terminal__body" onClick={() => inputRef.current?.focus()} role="log">
        <div className="os-terminal__line os-terminal__line--info">Type "help" for available commands. Supports kubectl/oc syntax.</div>
        {history.map((entry) => (
          <div key={entry.id}>
            <div className="os-terminal__line"><span className="os-terminal__prompt">$</span> {entry.command}</div>
            <div className={`os-terminal__line os-terminal__line--output${entry.isError ? ' os-terminal__line--error' : ''}`}>{entry.output}</div>
          </div>
        ))}
        <div className="os-terminal__line">
          <span className="os-terminal__prompt">$</span>
          <input
            ref={inputRef}
            type="text"
            className="os-terminal__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Terminal input"
            autoComplete="off"
            spellCheck={false}
            disabled={executing}
          />
        </div>
      </div>

      <style>{`
        .os-terminal { position: fixed; bottom: 0; left: 0; right: 0; z-index: 9990; display: flex; flex-direction: column; height: 350px; border-top: 1px solid var(--glass-border); }
        .os-terminal__header { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: #1a1a2e; color: #e2e8f0; font-size: 13px; font-weight: 600; }
        .os-terminal__close { background: none; border: none; color: #e2e8f0; cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 3px; }
        .os-terminal__close:hover { background: rgba(255,255,255,0.1); }
        .os-terminal__body { flex: 1; overflow-y: auto; padding: 8px 12px; background: #0d1117; color: #e2e8f0; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 13px; line-height: 1.5; }
        .os-terminal__line { white-space: pre-wrap; word-break: break-all; padding: 1px 0; }
        .os-terminal__line--info { color: #6a6e73; margin-bottom: 4px; }
        .os-terminal__line--output { color: #c9d1d9; }
        .os-terminal__line--error { color: #f87171; }
        .os-terminal__prompt { color: #4ade80; margin-right: 6px; font-weight: 600; }
        .os-terminal__input { background: none; border: none; color: #e2e8f0; font-family: inherit; font-size: inherit; outline: none; width: calc(100% - 20px); caret-color: #4ade80; }
      `}</style>
    </div>
  );
};

export default WebTerminal;
