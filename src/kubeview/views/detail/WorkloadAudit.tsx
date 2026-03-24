import React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle, AlertCircle, Shield } from 'lucide-react';
import type { K8sResource } from '../../engine/renderers';
import type { Deployment, Container, Probe, PodTemplateSpec } from '../../engine/types';

function probeDescription(probe: Probe): string {
  if (probe.httpGet) return `HTTP ${probe.httpGet.path || '/'}:${probe.httpGet.port}${probe.httpGet.scheme === 'HTTPS' ? ' (HTTPS)' : ''}`;
  if (probe.tcpSocket) return `TCP :${probe.tcpSocket.port}`;
  if (probe.exec) return `exec: ${(probe.exec.command || []).join(' ').slice(0, 40)}`;
  if ((probe as Probe & { grpc?: { port: number } }).grpc) return `gRPC :${(probe as Probe & { grpc?: { port: number } }).grpc!.port}`;
  return 'Configured';
}

export function WorkloadAudit({ resource, go }: { resource: K8sResource; go: (path: string, title: string) => void }) {
  const spec = resource.spec as Deployment['spec'];
  const containers: Container[] = spec?.template?.spec?.containers || [];
  const initContainers: Container[] = spec?.template?.spec?.initContainers || [];
  const strategy = spec?.strategy?.type || spec?.updateStrategy?.type || '—';
  const podSecCtx = spec?.template?.spec?.securityContext || {};

  interface AuditCheck {
    label: string;
    pass: boolean;
    detail: string;
    items?: Array<{ name: string; pass: boolean; detail: string }>;
  }

  const checks: AuditCheck[] = [];

  // 1. Resource limits
  const noLimits = containers.filter(c => !c.resources?.limits?.cpu || !c.resources?.limits?.memory);
  checks.push({
    label: 'Resource Limits',
    pass: noLimits.length === 0,
    detail: noLimits.length === 0 ? 'All containers have CPU and memory limits' : `${noLimits.length} container${noLimits.length > 1 ? 's' : ''} missing limits`,
    items: containers.map(c => ({
      name: c.name,
      pass: !!(c.resources?.limits?.cpu && c.resources?.limits?.memory),
      detail: c.resources?.limits ? `CPU: ${c.resources.limits.cpu || '—'}, Mem: ${c.resources.limits.memory || '—'}` : 'No limits set',
    })),
  });

  // 2. Resource requests
  const noRequests = containers.filter(c => !c.resources?.requests?.cpu || !c.resources?.requests?.memory);
  checks.push({
    label: 'Resource Requests',
    pass: noRequests.length === 0,
    detail: noRequests.length === 0 ? 'All containers have CPU and memory requests' : `${noRequests.length} container${noRequests.length > 1 ? 's' : ''} missing requests`,
    items: containers.map(c => ({
      name: c.name,
      pass: !!(c.resources?.requests?.cpu && c.resources?.requests?.memory),
      detail: c.resources?.requests ? `CPU: ${c.resources.requests.cpu || '—'}, Mem: ${c.resources.requests.memory || '—'}` : 'No requests set',
    })),
  });

  // 3. Liveness probes
  const noLiveness = containers.filter(c => !c.livenessProbe);
  checks.push({
    label: 'Liveness Probes',
    pass: noLiveness.length === 0,
    detail: noLiveness.length === 0 ? 'All containers have liveness probes' : `${noLiveness.length} container${noLiveness.length > 1 ? 's' : ''} missing liveness probe`,
    items: containers.map(c => ({
      name: c.name,
      pass: !!c.livenessProbe,
      detail: c.livenessProbe ? probeDescription(c.livenessProbe) : 'Not configured',
    })),
  });

  // 4. Readiness probes
  const noReadiness = containers.filter(c => !c.readinessProbe);
  checks.push({
    label: 'Readiness Probes',
    pass: noReadiness.length === 0,
    detail: noReadiness.length === 0 ? 'All containers have readiness probes' : `${noReadiness.length} container${noReadiness.length > 1 ? 's' : ''} missing readiness probe`,
    items: containers.map(c => ({
      name: c.name,
      pass: !!c.readinessProbe,
      detail: c.readinessProbe ? probeDescription(c.readinessProbe) : 'Not configured',
    })),
  });

  // 5. Replicas
  if (resource.kind !== 'DaemonSet') {
    checks.push({
      label: 'High Availability',
      pass: (spec?.replicas ?? 0) >= 2,
      detail: `${spec?.replicas ?? 0} replica${(spec?.replicas ?? 0) !== 1 ? 's' : ''} — ${(spec?.replicas ?? 0) >= 2 ? 'HA' : 'single point of failure'}`,
    });
  }

  // 6. Strategy
  if (resource.kind === 'Deployment') {
    checks.push({
      label: 'Update Strategy',
      pass: strategy !== 'Recreate',
      detail: strategy === 'Recreate' ? 'Recreate causes downtime during updates' : `${strategy}${spec?.strategy?.rollingUpdate ? ` (maxUnavailable: ${spec.strategy.rollingUpdate.maxUnavailable ?? 'default'}, maxSurge: ${spec.strategy.rollingUpdate.maxSurge ?? 'default'})` : ''}`,
    });
  }

  // 7. Security context
  const hasRunAsNonRoot = podSecCtx.runAsNonRoot === true;
  const noPrivEscalation = containers.every(c => c.securityContext?.allowPrivilegeEscalation === false);
  const dropAllCaps = containers.every(c => {
    const drop = c.securityContext?.capabilities?.drop || [];
    return drop.some((d: string) => d === 'ALL' || d === 'all');
  });
  checks.push({
    label: 'Security Context',
    pass: hasRunAsNonRoot && noPrivEscalation && dropAllCaps,
    detail: [
      hasRunAsNonRoot ? 'runAsNonRoot' : '⚠ runAsNonRoot not set',
      noPrivEscalation ? 'no privilege escalation' : '⚠ privilege escalation allowed',
      dropAllCaps ? 'caps dropped' : '⚠ capabilities not dropped',
    ].join(' · '),
    items: containers.map(c => ({
      name: c.name,
      pass: c.securityContext?.allowPrivilegeEscalation === false,
      detail: c.securityContext ? `allowPrivilegeEscalation: ${c.securityContext.allowPrivilegeEscalation ?? 'default'}, readOnlyRootFilesystem: ${c.securityContext.readOnlyRootFilesystem ?? 'false'}` : 'No security context',
    })),
  });

  const passCount = checks.filter(c => c.pass).length;
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-400" />
          Workload Health
        </h2>
        <span className={cn('text-xs font-medium', passCount === checks.length ? 'text-green-400' : 'text-yellow-400')}>
          {passCount}/{checks.length} passed
        </span>
      </div>
      <div className="divide-y divide-slate-800">
        {checks.map((check) => (
          <div key={check.label}>
            <button
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/50 transition-colors"
              onClick={() => setExpanded(expanded === check.label ? null : check.label)}
            >
              {check.pass
                ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                : <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" />
              }
              <div className="flex-1 text-left min-w-0">
                <span className="text-sm text-slate-200">{check.label}</span>
                <span className={cn('text-xs ml-2', check.pass ? 'text-green-400' : 'text-yellow-400')}>{check.detail}</span>
              </div>
              {check.items && (
                <span className="text-xs text-slate-500">{expanded === check.label ? '▲' : '▼'}</span>
              )}
            </button>
            {expanded === check.label && check.items && (
              <div className="px-4 pb-3 space-y-1.5 ml-7">
                {check.items.map((item) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', item.pass ? 'bg-green-500' : 'bg-yellow-500')} />
                    <span className="text-slate-300 font-mono w-32 truncate shrink-0">{item.name}</span>
                    <span className="text-slate-500">{item.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
