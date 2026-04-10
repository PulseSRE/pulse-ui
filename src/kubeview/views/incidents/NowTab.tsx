import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  XCircle, AlertTriangle, Activity, CheckCircle, Eye, X,
  BellOff, Volume2, Clock, ChevronDown, ChevronUp, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../../engine/formatters';
import { Card } from '../../components/primitives/Card';
import { EmptyState } from '../../components/primitives/EmptyState';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { useIncidentFeed } from '../../hooks/useIncidentFeed';
import { useMonitorStore } from '../../store/monitorStore';
import { useUIStore } from '../../store/uiStore';
import { useAgentStore } from '../../store/agentStore';
import { showErrorToast } from '../../engine/errorToast';
import type { IncidentItem, IncidentSeverity } from '../../engine/types/incident';

interface Silence {
  id: string;
  status: { state: string };
  matchers: Array<{ name: string; value: string; isRegex: boolean }>;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
}

const DEFAULT_SILENCE_DURATION = '2h';

const SILENCE_DURATION_LABELS: Record<string, string> = {
  '30m': '30 minutes', '1h': '1 hour', '2h': '2 hours',
  '4h': '4 hours', '8h': '8 hours', '24h': '24 hours', '1d': '1 day',
};

function formatSilenceDuration(d: string): string {
  return SILENCE_DURATION_LABELS[d] || d;
}

async function createQuickSilence(
  alertName: string,
  duration = DEFAULT_SILENCE_DURATION,
  namespace?: string,
  severity?: string,
) {
  // Parse duration string (e.g., '2h', '30m', '1d') into milliseconds
  const durationMatch = duration.match(/^(\d+)(m|h|d)$/);
  let durationMs = 2 * 60 * 60 * 1000; // default 2 hours
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];
    if (unit === 'm') durationMs = value * 60 * 1000;
    else if (unit === 'h') durationMs = value * 60 * 60 * 1000;
    else if (unit === 'd') durationMs = value * 24 * 60 * 60 * 1000;
  }
  const endsAt = new Date(Date.now() + durationMs).toISOString();
  // Scope silence to alertname + namespace + severity to avoid silencing across all namespaces
  const matchers = [{ name: 'alertname', value: alertName, isRegex: false }];
  if (namespace) matchers.push({ name: 'namespace', value: namespace, isRegex: false });
  if (severity) matchers.push({ name: 'severity', value: severity, isRegex: false });
  const res = await fetch('/api/alertmanager/api/v2/silences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchers,
      startsAt: new Date().toISOString(),
      endsAt,
      createdBy: useUIStore.getState().impersonateUser || 'pulse-ui',
      comment: `Quick silence from Incident Center (${formatSilenceDuration(duration)})`,
    }),
  });
  if (!res.ok) throw new Error('Failed to create silence');
}

async function expireSilenceRequest(id: string) {
  const res = await fetch(`/api/alertmanager/api/v2/silence/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to expire silence');
}

const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  critical: 'bg-red-900/50 text-red-300',
  warning: 'bg-yellow-900/50 text-yellow-300',
  info: 'bg-blue-900/50 text-blue-300',
};


export function NowTab() {
  const dismissFinding = useMonitorStore((s) => s.dismissFinding);
  const resolutions = useMonitorStore((s) => s.resolutions);
  const queryClient = useQueryClient();
  const { incidents, counts, isLoading } = useIncidentFeed();
  const [silencesExpanded, setSilencesExpanded] = useState(false);
  const [confirmExpireId, setConfirmExpireId] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // Deep-link: auto-focus incident from ?finding=<id> URL param
  useEffect(() => {
    const findingId = new URLSearchParams(window.location.search).get('finding');
    if (findingId && incidents.length > 0) {
      const idx = incidents.findIndex((i) => i.id === findingId || i.sourceRef === findingId);
      if (idx >= 0) setFocusedIdx(idx);
    }
  }, [incidents]);

  // Keyboard shortcuts for incident triage (j/k/s/i/d)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input or dialog is open
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.querySelector('[role="dialog"]')) return;
      if (incidents.length === 0) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((prev) => Math.min(prev + 1, incidents.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx((prev) => Math.max(prev - 1, 0));
      } else if (focusedIdx >= 0 && focusedIdx < incidents.length) {
        const incident = incidents[focusedIdx];
        if (e.key === 'i') {
          e.preventDefault();
          useUIStore.getState().openDock('agent');
          const agentStore = useAgentStore.getState();
          if (agentStore.connected) {
            agentStore.sendMessage(`The monitor detected this issue:\n\n"${incident.title}: ${incident.detail}"\n\nInvestigate this further. What is the root cause and what should I do to fix it?`);
          }
        } else if (e.key === 's' && incident.source === 'prometheus-alert') {
          e.preventDefault();
          handleSilence(incident.title);
        } else if (e.key === 'd' && incident.source === 'finding') {
          e.preventDefault();
          dismissFinding(incident.id);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [incidents, focusedIdx]);

  // Fetch active silences from Alertmanager
  const { data: silences = [] } = useQuery<Silence[]>({
    queryKey: ['incidents', 'silences'],
    queryFn: async () => {
      const res = await fetch('/api/alertmanager/api/v2/silences');
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
  });

  const activeSilences = useMemo(
    () => silences.filter((s) => s.status.state === 'active'),
    [silences],
  );

  const handleSilence = async (alertName: string, duration = DEFAULT_SILENCE_DURATION, namespace?: string, severity?: string) => {
    const addToast = useUIStore.getState().addToast;
    try {
      await createQuickSilence(alertName, duration, namespace, severity);
      addToast({ type: 'success', title: 'Silence created', detail: `${alertName} silenced for ${formatSilenceDuration(duration)}` });
      queryClient.invalidateQueries({ queryKey: ['incidents', 'silences'] });
    } catch (err: unknown) {
      showErrorToast(err, 'Failed to create silence');
    }
  };

  const handleExpire = async (id: string) => {
    const addToast = useUIStore.getState().addToast;
    try {
      await expireSilenceRequest(id);
      addToast({ type: 'success', title: 'Silence expired', detail: `Silence ${id} has been removed` });
      queryClient.invalidateQueries({ queryKey: ['incidents', 'silences'] });
    } catch (err: unknown) {
      showErrorToast(err, 'Failed to expire silence');
    }
    setConfirmExpireId(null);
  };

  return (
    <div className="space-y-6">
      {/* Severity cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className={cn('bg-slate-900 rounded-lg border p-4', counts.critical > 0 ? 'border-red-800' : 'border-slate-800')}>
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-slate-400">Critical</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">{counts.critical}</div>
        </div>
        <div className={cn('bg-slate-900 rounded-lg border p-4', counts.warning > 0 ? 'border-yellow-800' : 'border-slate-800')}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span className="text-xs text-slate-400">Warning</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">{counts.warning}</div>
        </div>
        <div className={cn('bg-slate-900 rounded-lg border p-4', counts.info > 0 ? 'border-blue-800' : 'border-slate-800')}>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-slate-400">Info</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">{counts.info}</div>
        </div>
      </div>

      {/* Active Silences collapsible section */}
      {activeSilences.length > 0 && (
        <Card>
          <button
            onClick={() => setSilencesExpanded((prev) => !prev)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <BellOff className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium text-slate-200">Active Silences</span>
              <span className="text-xs px-2 py-0.5 bg-violet-900/50 text-violet-300 rounded">
                {activeSilences.length}
              </span>
            </div>
            {silencesExpanded ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>
          {silencesExpanded && (
            <div className="divide-y divide-slate-800 border-t border-slate-800">
              {activeSilences.map((silence) => (
                <div key={silence.id} className="px-4 py-3 flex items-start gap-3">
                  <Volume2 className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-slate-200">
                        {silence.comment || 'No comment'}
                      </span>
                    </div>
                    <div className="space-y-0.5 mb-1">
                      {silence.matchers.map((m, i) => (
                        <span key={i} className="text-xs font-mono text-slate-400 mr-2">
                          {m.name}{m.isRegex ? '=~' : '='}{m.value}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Ends: {new Date(silence.endsAt).toLocaleString()}
                      </span>
                      <span>By: {silence.createdBy}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setConfirmExpireId(silence.id)}
                    className="px-2.5 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-1.5 flex-shrink-0 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Expire
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Loading state */}
      {isLoading && incidents.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <span className="text-slate-500 text-sm">Loading incidents...</span>
        </div>
      ) : incidents.length === 0 ? (
        <EmptyState
          icon={<CheckCircle className="w-8 h-8 text-green-400" />}
          title="All clear"
          description="No active incidents. The cluster is healthy."
        />
      ) : (
        <div className="space-y-2" ref={listRef}>
          {incidents.map((incident, idx) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              focused={idx === focusedIdx}
              onDismiss={incident.source === 'finding' ? () => dismissFinding(incident.id) : undefined}
              onSilence={
                incident.source === 'prometheus-alert'
                  ? (duration?: string) => handleSilence(incident.title, duration, incident.namespace, incident.severity)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Expire Confirmation Dialog */}
      <ConfirmDialog
        open={!!confirmExpireId}
        onClose={() => setConfirmExpireId(null)}
        title="Expire Silence"
        description="Are you sure you want to expire this silence? Alerts matching this silence will start firing again."
        confirmLabel="Expire"
        variant="danger"
        onConfirm={() => confirmExpireId && handleExpire(confirmExpireId)}
      />

      {/* Recent Resolutions */}
      {resolutions.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Recently Resolved ({resolutions.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-800">
            {resolutions.slice(-5).reverse().map((r, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-3">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-slate-200">{r.title}</span>
                  <span className={cn(
                    'ml-2 text-xs px-1.5 py-0.5 rounded',
                    r.resolvedBy === 'auto-fix' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-blue-900/50 text-blue-300',
                  )}>
                    {r.resolvedBy === 'auto-fix' ? 'Auto-fixed' : 'Self-healed'}
                  </span>
                </div>
                <span className="text-xs text-slate-600 shrink-0">{formatRelativeTime(r.timestamp)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function IncidentCard({
  incident,
  focused,
  onDismiss,
  onSilence,
}: {
  incident: IncidentItem;
  focused?: boolean;
  onDismiss?: () => void;
  onSilence?: (duration?: string) => void;
}) {
  const [silencing, setSilencing] = useState(false);
  const [confirmSilence, setConfirmSilence] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [silenceDuration, setSilenceDuration] = useState(DEFAULT_SILENCE_DURATION);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);

  return (
    <div ref={cardRef}>
    <Card className={focused ? 'ring-1 ring-violet-500/60' : undefined}>
      <div className="px-4 py-3 flex items-start gap-3">
        {incident.severity === 'critical' ? (
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
        ) : incident.severity === 'warning' ? (
          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
        ) : (
          <Activity className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium text-slate-200">{incident.title}</span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded', SEVERITY_COLORS[incident.severity])}>
              {incident.severity}
            </span>
            <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
              {incident.source}
            </span>
            <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
              {incident.category}
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-2">{incident.detail}</p>
          {incident.resources.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {incident.resources.map((r, i) => (
                <span key={i} className="text-xs font-mono px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
                  {r.kind}/{r.name}
                  {r.namespace && ` (${r.namespace})`}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{formatRelativeTime(incident.timestamp)}</span>
            {(() => {
              const runbookUrl = (incident.sourceData as Record<string, unknown>)?.annotations
                ? ((incident.sourceData as Record<string, Record<string, string>>).annotations?.runbook_url)
                : undefined;
              return runbookUrl ? (
                <a href={runbookUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  onClick={(e) => e.stopPropagation()}>
                  Runbook →
                </a>
              ) : null;
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              useUIStore.getState().openDock('agent');
              const { connectAndSend } = useAgentStore.getState();
              connectAndSend(
                `The monitor detected this issue:\n\n"${incident.title}: ${incident.detail}"\n\nInvestigate this further. What is the root cause and what should I do to fix it?`,
              );
            }}
            className="px-2.5 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded flex items-center gap-1.5 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            Investigate
          </button>
          {onSilence && (
            <button
              onClick={() => setConfirmSilence(true)}
              disabled={silencing}
              className="px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={`Silence this alert for ${formatSilenceDuration(silenceDuration)}`}
            >
              <BellOff className="w-3.5 h-3.5" />
              {silencing ? 'Silencing...' : 'Silence'}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => setConfirmDismiss(true)}
              className="px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded flex items-center gap-1.5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* Silence Confirmation Dialog */}
      <ConfirmDialog
        open={confirmSilence}
        onClose={() => setConfirmSilence(false)}
        title="Silence Alert"
        description={`Silence "${incident.title}" for ${formatSilenceDuration(silenceDuration)}?`}
        confirmLabel="Silence"
        variant="warning"
        loading={silencing}
        onConfirm={async () => {
          if (onSilence) {
            setSilencing(true);
            try { await onSilence(silenceDuration); } finally { setSilencing(false); }
          }
          setConfirmSilence(false);
        }}
      >
        <div className="flex gap-1 mt-2">
          {['30m', '1h', '2h', '4h', '8h', '24h'].map((d) => (
            <button
              key={d}
              onClick={() => setSilenceDuration(d)}
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-colors',
                silenceDuration === d
                  ? 'bg-amber-600/30 text-amber-300 border border-amber-600/50'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200',
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </ConfirmDialog>

      {/* Dismiss Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDismiss}
        onClose={() => setConfirmDismiss(false)}
        title="Dismiss Finding"
        description="Dismiss this finding? It won't appear again until the next scan."
        confirmLabel="Dismiss"
        variant="warning"
        onConfirm={() => {
          onDismiss?.();
          setConfirmDismiss(false);
        }}
      />
    </Card>
    {focused && (
      <div className="text-[10px] text-slate-600 text-right -mt-1 mr-1">
        <kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono">i</kbd> investigate
        {onSilence && <> · <kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono">s</kbd> silence</>}
        {onDismiss && <> · <kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono">d</kbd> dismiss</>}
      </div>
    )}
    </div>
  );
}
