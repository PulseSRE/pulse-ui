import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DrawerShell } from '../../components/primitives/DrawerShell';
import { useMonitorStore } from '../../store/monitorStore';
import type { ScannerCoverage } from '../../engine/analyticsApi';

const DISABLED_KEY = 'pulse-disabled-scanners';

const SCANNER_INFO: Record<string, { description: string; autoFixable?: boolean; severity: string }> = {
  crashloop: { description: 'Pods in CrashLoopBackOff — restarts > 5 in the last hour', autoFixable: true, severity: 'critical' },
  pending: { description: 'Pods stuck in Pending — unschedulable due to resources, affinity, or taints', severity: 'warning' },
  workloads: { description: 'Deployments with 0 available replicas or progressing for too long', autoFixable: true, severity: 'critical' },
  nodes: { description: 'Nodes with MemoryPressure, DiskPressure, or PIDPressure conditions', severity: 'critical' },
  cert_expiry: { description: 'TLS certificates in Secrets expiring within 30 days', severity: 'warning' },
  alerts: { description: 'Firing Prometheus alerts from Alertmanager (excludes Watchdog and InfoInhibitor)', severity: 'critical' },
  oom: { description: 'Pods killed by OOM (Out of Memory) — containers exceeding memory limits', severity: 'warning' },
  image_pull: { description: 'Pods in ImagePullBackOff — wrong image tag, missing registry auth, or network issues', autoFixable: true, severity: 'warning' },
  operators: { description: 'ClusterOperators in Degraded state — platform components not fully healthy', severity: 'warning' },
  daemonsets: { description: 'DaemonSets with fewer ready pods than desired — missing coverage on some nodes', severity: 'warning' },
  hpa: { description: 'HPAs at maxReplicas with ScalingLimited condition — unable to scale further', severity: 'warning' },
  audit_config: { description: 'ConfigMap changes correlated with pod restarts or failures', severity: 'info' },
  audit_rbac: { description: 'New or modified ClusterRoleBindings with cluster-admin privileges', severity: 'info' },
  audit_deployment: { description: 'Recent deployment rollouts — tracks what changed and when', severity: 'info' },
  audit_events: { description: 'High-frequency Warning events that may indicate emerging issues', severity: 'info' },
  audit_auth: { description: 'Auth anomalies — kubeadmin usage, login failures, service account token creation', severity: 'info' },
  security_posture: { description: 'Pod security violations — privileged containers, host networking, missing security contexts', severity: 'warning' },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

interface ScannerDrawerProps {
  coverage: ScannerCoverage | null;
  onClose: () => void;
}

export function ScannerDrawer({ coverage, onClose }: ScannerDrawerProps) {
  const setDisabledBackend = useMonitorStore((s) => s.setDisabledScanners);

  const [disabled, setDisabled] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(DISABLED_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const toggle = useCallback((id: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(DISABLED_KEY, JSON.stringify([...next]));
      setDisabledBackend([...next]);
      return next;
    });
  }, [setDisabledBackend]);

  const scanners = coverage?.per_scanner || [];
  const activeCount = scanners.filter((s) => !disabled.has(s.name)).length;

  return (
    <DrawerShell title="Scanner Coverage" onClose={onClose}>
      <p className="text-[11px] text-slate-500 mb-1">
        The monitor runs all enabled scanners every 60 seconds against your cluster. Findings appear in the Incident Center. Scanners cannot be added or customized — they are built into the agent.
      </p>
      <div className="text-xs text-slate-500 mb-4">
        {activeCount}/{scanners.length} scanners active
      </div>

      <div className="space-y-1">
        {scanners.map((scanner) => {
          const isDisabled = disabled.has(scanner.name);
          const info = SCANNER_INFO[scanner.name];
          return (
            <div
              key={scanner.name}
              className={cn(
                'flex items-center justify-between px-3 py-3 rounded-lg border transition-colors',
                isDisabled ? 'border-slate-800 opacity-50' : 'border-slate-800',
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-200 font-medium">
                    {scanner.name.replace(/^scan_/, '').replace(/_/g, ' ')}
                  </span>
                  {info?.autoFixable && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/40">auto-fix</span>
                  )}
                  {info && (
                    <span className={cn('text-[9px]', SEVERITY_COLORS[info.severity] || 'text-slate-500')}>{info.severity}</span>
                  )}
                </div>
                {info && !isDisabled && (
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{info.description}</div>
                )}
                {!isDisabled && scanner.finding_count > 0 && (
                  <div className="text-xs text-amber-400/70 mt-1">
                    {scanner.finding_count} findings ({scanner.actionable_count} actionable)
                    {scanner.noise_pct > 0 && ` \u00B7 ${scanner.noise_pct}% noise`}
                  </div>
                )}
                {!isDisabled && scanner.finding_count === 0 && !info && (
                  <div className="text-xs text-slate-600 mt-0.5">No findings yet</div>
                )}
                {isDisabled && (
                  <div className="text-xs text-slate-600 mt-0.5">Disabled</div>
                )}
              </div>

              <button
                onClick={() => toggle(scanner.name)}
                role="switch"
                aria-checked={!isDisabled}
                aria-label={`${isDisabled ? 'Enable' : 'Disable'} ${scanner.name.replace(/_/g, ' ')} scanner`}
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors shrink-0 ml-3',
                  isDisabled ? 'bg-slate-700' : 'bg-emerald-600',
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  !isDisabled && 'translate-x-4',
                )} />
              </button>
            </div>
          );
        })}
        {scanners.length === 0 && (
          <div className="text-sm text-slate-500 text-center py-8">No scanner data available</div>
        )}
      </div>
    </DrawerShell>
  );
}
