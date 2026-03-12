import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@patternfly/react-core';

const K8S = '/api/kubernetes';
const PROM = '/api/prometheus';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  actions?: { label: string; action: () => Promise<void> }[];
}

interface AIAssistantProps {
  open: boolean;
  onClose: () => void;
}

// --- Cluster context gathering ---

async function gatherClusterContext(): Promise<string> {
  const sections: string[] = [];

  // Nodes
  try {
    const res = await fetch(`${K8S}/api/v1/nodes`);
    if (res.ok) {
      const data = await res.json() as { items: { metadata: { name: string }; status: { conditions: { type: string; status: string }[] } }[] };
      const nodes = data.items.map((n) => {
        const ready = n.status.conditions.find((c) => c.type === 'Ready');
        return `${n.metadata.name}: ${ready?.status === 'True' ? 'Ready' : 'NotReady'}`;
      });
      sections.push(`NODES (${nodes.length}):\n${nodes.join('\n')}`);
    }
  } catch { /* skip */ }

  // Pods with issues
  try {
    const res = await fetch(`${K8S}/api/v1/pods`);
    if (res.ok) {
      const data = await res.json() as { items: { metadata: { name: string; namespace: string }; status: { phase: string; containerStatuses?: { restartCount: number; state?: Record<string, unknown> }[] } }[] };
      const total = data.items.length;
      const running = data.items.filter((p) => p.status.phase === 'Running').length;
      const failing = data.items.filter((p) => {
        const restarts = p.status.containerStatuses?.reduce((s, c) => s + c.restartCount, 0) ?? 0;
        return p.status.phase !== 'Running' && p.status.phase !== 'Succeeded' || restarts > 5;
      });
      sections.push(`PODS: ${running}/${total} running`);
      if (failing.length > 0) {
        sections.push(`FAILING PODS (${failing.length}):\n${failing.slice(0, 10).map((p) => {
          const restarts = p.status.containerStatuses?.reduce((s, c) => s + c.restartCount, 0) ?? 0;
          return `  ${p.metadata.namespace}/${p.metadata.name}: phase=${p.status.phase}, restarts=${restarts}`;
        }).join('\n')}`);
      }
    }
  } catch { /* skip */ }

  // Deployments
  try {
    const res = await fetch(`${K8S}/apis/apps/v1/deployments`);
    if (res.ok) {
      const data = await res.json() as { items: { metadata: { name: string; namespace: string }; spec: { replicas: number }; status: { readyReplicas?: number } }[] };
      const degraded = data.items.filter((d) => (d.status.readyReplicas ?? 0) < d.spec.replicas);
      if (degraded.length > 0) {
        sections.push(`DEGRADED DEPLOYMENTS (${degraded.length}):\n${degraded.slice(0, 10).map((d) =>
          `  ${d.metadata.namespace}/${d.metadata.name}: ${d.status.readyReplicas ?? 0}/${d.spec.replicas} ready`
        ).join('\n')}`);
      }
    }
  } catch { /* skip */ }

  // Recent warning events
  try {
    const res = await fetch(`${K8S}/api/v1/events?fieldSelector=type=Warning&limit=15`);
    if (res.ok) {
      const data = await res.json() as { items: { reason: string; message: string; metadata: { namespace: string }; involvedObject?: { name: string; kind: string } }[] };
      if (data.items.length > 0) {
        sections.push(`RECENT WARNING EVENTS (${data.items.length}):\n${data.items.slice(0, 8).map((e) =>
          `  [${e.metadata.namespace}] ${e.involvedObject?.kind}/${e.involvedObject?.name}: ${e.reason} - ${e.message.slice(0, 100)}`
        ).join('\n')}`);
      }
    }
  } catch { /* skip */ }

  // Firing alerts
  try {
    const res = await fetch(`${PROM}/api/v1/alerts`);
    if (res.ok) {
      const data = await res.json() as { data?: { alerts?: { labels: Record<string, string>; state: string; annotations?: Record<string, string> }[] } };
      const firing = data.data?.alerts?.filter((a) => a.state === 'firing') ?? [];
      if (firing.length > 0) {
        sections.push(`FIRING ALERTS (${firing.length}):\n${firing.slice(0, 8).map((a) =>
          `  [${a.labels['severity']}] ${a.labels['alertname']}: ${a.annotations?.['summary'] ?? a.annotations?.['description'] ?? ''}`
        ).join('\n')}`);
      }
    }
  } catch { /* skip */ }

  return sections.join('\n\n') || 'No cluster data available. Make sure oc proxy is running.';
}

async function fetchResourceDetail(kind: string, name: string, namespace?: string): Promise<string> {
  const paths: Record<string, string> = {
    pod: namespace ? `/api/v1/namespaces/${namespace}/pods/${name}` : `/api/v1/pods`,
    deployment: namespace ? `/apis/apps/v1/namespaces/${namespace}/deployments/${name}` : `/apis/apps/v1/deployments`,
    service: namespace ? `/api/v1/namespaces/${namespace}/services/${name}` : `/api/v1/services`,
    node: `/api/v1/nodes/${name}`,
  };
  const path = paths[kind.toLowerCase()];
  if (!path) return '';
  try {
    const res = await fetch(`${K8S}${path}`);
    if (!res.ok) return '';
    const data = await res.json();
    return JSON.stringify(data, null, 2).slice(0, 3000);
  } catch {
    return '';
  }
}

async function fetchPodLogs(name: string, namespace: string): Promise<string> {
  try {
    const res = await fetch(`${K8S}/api/v1/namespaces/${namespace}/pods/${name}/log?tailLines=30`);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

// --- Action parser ---

interface ParsedAction {
  label: string;
  execute: () => Promise<void>;
}

function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = [];

  // Match patterns like [ACTION: scale deployment X in namespace Y to N replicas]
  const scaleMatch = text.match(/scale (?:deployment |deploy )?(\S+)(?: in (?:namespace )?(\S+))? to (\d+)/i);
  if (scaleMatch) {
    const [, depName, ns, replicas] = scaleMatch;
    const namespace = ns || 'default';
    actions.push({
      label: `Scale ${depName} to ${replicas} replicas`,
      execute: async () => {
        await fetch(`${K8S}/apis/apps/v1/namespaces/${namespace}/deployments/${depName}/scale`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiVersion: 'autoscaling/v1', kind: 'Scale', metadata: { name: depName, namespace }, spec: { replicas: parseInt(replicas) } }),
        });
      },
    });
  }

  const restartMatch = text.match(/restart (?:pod )?(\S+)(?: in (?:namespace )?(\S+))?/i);
  if (restartMatch) {
    const [, podName, ns] = restartMatch;
    const namespace = ns || 'default';
    actions.push({
      label: `Restart pod ${podName}`,
      execute: async () => {
        await fetch(`${K8S}/api/v1/namespaces/${namespace}/pods/${podName}`, { method: 'DELETE' });
      },
    });
  }

  const cordonMatch = text.match(/cordon (?:node )?(\S+)/i);
  if (cordonMatch) {
    actions.push({
      label: `Cordon node ${cordonMatch[1]}`,
      execute: async () => {
        await fetch(`${K8S}/api/v1/nodes/${cordonMatch[1]}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
          body: JSON.stringify({ spec: { unschedulable: true } }),
        });
      },
    });
  }

  return actions;
}

// --- Chat with Claude ---

async function chat(messages: { role: string; content: string }[], clusterContext: string): Promise<string> {
  const systemPrompt = `You are an expert Kubernetes/OpenShift cluster operations assistant embedded in a web console. You help cluster administrators diagnose issues, optimize resources, and manage their cluster.

CURRENT CLUSTER STATE:
${clusterContext}

GUIDELINES:
- Be concise and actionable. Give specific commands or recommendations.
- When suggesting fixes, include the exact resource name and namespace.
- Use phrases like "scale deployment X in namespace Y to N replicas" or "restart pod X in namespace Y" so the UI can parse executable actions.
- If you need more info about a specific resource, say so and the user can ask follow-up questions.
- Format your response with clear sections. Use **bold** for important items.
- Don't be overly verbose. Admins are busy.`;

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anthropic_version: 'vertex-2023-10-16',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401 || res.status === 403) {
        return 'AI Assistant requires GCP authentication. Run: gcloud auth login';
      }
      return `API error: ${res.status} ${err.slice(0, 200)}`;
    }

    const data = await res.json() as { content?: { text: string }[] };
    return data.content?.[0]?.text ?? 'No response received.';
  } catch (err) {
    return `Connection error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// --- Component ---

const AIAssistant: React.FC<AIAssistantProps> = ({ open, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [clusterContext, setClusterContext] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  // Gather context on open
  useEffect(() => {
    if (open) {
      gatherClusterContext().then(setClusterContext);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Check if user is asking about a specific resource — fetch extra context
    let extraContext = '';
    const podMatch = text.match(/pod[s]?\s+(\S+)(?:\s+in\s+(\S+))?/i);
    const deployMatch = text.match(/deploy(?:ment)?[s]?\s+(\S+)(?:\s+in\s+(\S+))?/i);
    if (podMatch) {
      const detail = await fetchResourceDetail('pod', podMatch[1], podMatch[2]);
      const logs = await fetchPodLogs(podMatch[1], podMatch[2] || 'default');
      if (detail) extraContext += `\n\nPOD DETAIL:\n${detail}`;
      if (logs) extraContext += `\n\nPOD LOGS (last 30 lines):\n${logs}`;
    } else if (deployMatch) {
      const detail = await fetchResourceDetail('deployment', deployMatch[1], deployMatch[2]);
      if (detail) extraContext += `\n\nDEPLOYMENT DETAIL:\n${detail}`;
    }

    const userMsg: Message = { id: nextId.current++, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Refresh cluster context if stale
    const freshContext = await gatherClusterContext();
    setClusterContext(freshContext);

    const chatHistory = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    // Append extra context to the user message
    if (extraContext) {
      chatHistory[chatHistory.length - 1].content += extraContext;
    }

    const response = await chat(chatHistory, freshContext);
    const actions = parseActions(response);

    const assistantMsg: Message = {
      id: nextId.current++,
      role: 'assistant',
      content: response,
      actions: actions.length > 0 ? actions.map((a) => ({ label: a.label, action: a.execute })) : undefined,
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setLoading(false);
  }, [input, loading, messages, clusterContext]);

  const handleAction = useCallback(async (action: () => Promise<void>, label: string) => {
    try {
      await action();
      setMessages((prev) => [...prev, {
        id: nextId.current++,
        role: 'assistant',
        content: `✅ Executed: ${label}`,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: nextId.current++,
        role: 'assistant',
        content: `❌ Failed: ${label} — ${err instanceof Error ? err.message : String(err)}`,
      }]);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="os-ai">
      <div className="os-ai__header">
        <span className="os-ai__title">AI Operations Assistant</span>
        <span className="os-ai__badge">Claude</span>
        <button className="os-ai__close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="os-ai__body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="os-ai__welcome">
            <div className="os-ai__welcome-title">How can I help with your cluster?</div>
            <div className="os-ai__suggestions">
              {['Why are pods failing?', 'What needs attention?', 'Show me resource usage', 'Any security concerns?'].map((q) => (
                <button key={q} className="os-ai__suggestion" onClick={() => { setInput(q); setTimeout(() => handleSend(), 50); }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`os-ai__msg os-ai__msg--${msg.role}`}>
            <div className="os-ai__msg-content">{msg.content}</div>
            {msg.actions && msg.actions.length > 0 && (
              <div className="os-ai__actions">
                {msg.actions.map((a, i) => (
                  <Button key={i} variant="secondary" size="sm" onClick={() => handleAction(a.action, a.label)}>
                    ⚡ {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <div className="os-ai__msg os-ai__msg--assistant os-ai__msg--loading">Analyzing cluster...</div>}
      </div>
      <div className="os-ai__input-row">
        <input
          ref={inputRef}
          className="os-ai__input"
          placeholder="Ask about your cluster..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={loading}
        />
        <Button variant="primary" size="sm" onClick={handleSend} isLoading={loading} isDisabled={!input.trim()}>
          Send
        </Button>
      </div>

      <style>{`
        .os-ai { position: fixed; bottom: 0; right: 0; width: 420px; height: 520px; display: flex; flex-direction: column; border: 1px solid var(--glass-border); border-radius: 12px 12px 0 0; background: var(--glass-bg); z-index: 9999; box-shadow: 0 -4px 24px rgba(0,0,0,0.15); }
        .os-ai__header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--glass-border); }
        .os-ai__title { font-weight: 600; font-size: 14px; flex: 1; }
        .os-ai__badge { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: var(--theme-color-1); color: #fff; }
        .os-ai__close { background: none; border: none; cursor: pointer; font-size: 16px; color: var(--os-text-secondary, #6a6e73); padding: 2px 6px; }
        .os-ai__body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        .os-ai__welcome { text-align: center; padding: 24px 0; }
        .os-ai__welcome-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
        .os-ai__suggestions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
        .os-ai__suggestion { padding: 6px 12px; border-radius: 16px; border: 1px solid var(--glass-border); background: transparent; cursor: pointer; font-size: 12px; color: var(--os-text-primary, #151515); transition: border-color 0.15s; }
        .os-ai__suggestion:hover { border-color: var(--theme-color-1); }
        .os-ai__msg { padding: 10px 12px; border-radius: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; max-width: 90%; }
        .os-ai__msg--user { background: var(--theme-color-1); color: #fff; align-self: flex-end; border-radius: 8px 8px 2px 8px; }
        .os-ai__msg--assistant { background: rgba(0,0,0,0.04); align-self: flex-start; border-radius: 8px 8px 8px 2px; }
        .dark .os-ai__msg--assistant { background: rgba(255,255,255,0.06); }
        .os-ai__msg--loading { opacity: 0.7; font-style: italic; }
        .os-ai__msg-content { white-space: pre-wrap; }
        .os-ai__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .os-ai__input-row { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--glass-border); }
        .os-ai__input { flex: 1; border: 1px solid var(--glass-border); border-radius: 6px; padding: 8px 12px; font-size: 13px; background: transparent; color: var(--os-text-primary, #151515); outline: none; }
        .os-ai__input:focus { border-color: var(--theme-color-1); }
        .os-ai__input::placeholder { color: var(--os-text-muted, #8a8d90); }
      `}</style>
    </div>
  );
};

export default AIAssistant;
