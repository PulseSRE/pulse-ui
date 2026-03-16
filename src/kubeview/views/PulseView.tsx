import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  XCircle,
  CheckCircle,
  Clock,
  ArrowRight,
  Server,
  Box,
  ShieldAlert,
  HeartPulse,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { getPodStatus, getNodeStatus, getDeploymentStatus } from '../engine/renderers/statusUtils';
import { kindToPlural } from '../engine/renderers/index';
import { findNeedsAttention, diagnoseResource, type NeedsAttentionItem } from '../engine/diagnosis';
import { useUIStore } from '../store/uiStore';

function filterByNamespace<T extends { metadata: { namespace?: string } }>(items: T[], ns: string): T[] {
  if (ns === '*') return items;
  return items.filter((i) => i.metadata.namespace === ns);
}

export default function PulseView() {
  const navigate = useNavigate();
  const addTab = useUIStore((s) => s.addTab);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);

  const { data: nodes = [] } = useQuery<K8sResource[]>({
    queryKey: ['pulse', 'nodes'],
    queryFn: () => k8sList<K8sResource>('/api/v1/nodes'),
    refetchInterval: 30000,
  });

  const { data: pods = [], isLoading: podsLoading } = useQuery<K8sResource[]>({
    queryKey: ['pulse', 'pods'],
    queryFn: () => k8sList<K8sResource>('/api/v1/pods'),
    refetchInterval: 30000,
  });

  const { data: deployments = [] } = useQuery<K8sResource[]>({
    queryKey: ['pulse', 'deployments'],
    queryFn: () => k8sList<K8sResource>('/apis/apps/v1/deployments'),
    refetchInterval: 30000,
  });

  const { data: events = [] } = useQuery<K8sResource[]>({
    queryKey: ['pulse', 'events'],
    queryFn: () => k8sList<K8sResource>('/api/v1/events?limit=100'),
    refetchInterval: 30000,
  });

  const { data: pvcs = [] } = useQuery<K8sResource[]>({
    queryKey: ['pulse', 'pvcs'],
    queryFn: () => k8sList<K8sResource>('/api/v1/persistentvolumeclaims'),
    refetchInterval: 30000,
  });

  // Apply namespace filter
  const filteredPods = React.useMemo(() => filterByNamespace(pods as any[], selectedNamespace), [pods, selectedNamespace]);
  const filteredDeployments = React.useMemo(() => filterByNamespace(deployments as any[], selectedNamespace), [deployments, selectedNamespace]);

  // Needs attention items from diagnosis engine
  const attentionItems = React.useMemo(() => {
    const all = [...filteredPods, ...nodes, ...pvcs];
    return findNeedsAttention(all);
  }, [filteredPods, nodes, pvcs]);

  // Failing pods
  const failingPods = React.useMemo(() => {
    return filteredPods.filter((pod) => {
      const status = getPodStatus(pod);
      return status.reason === 'CrashLoopBackOff' || status.reason === 'ImagePullBackOff' ||
        status.reason === 'ErrImagePull' || status.phase === 'Failed';
    });
  }, [filteredPods]);

  // Unhealthy deployments
  const unhealthyDeploys = React.useMemo(() => {
    return filteredDeployments.filter((d) => !getDeploymentStatus(d).available);
  }, [filteredDeployments]);

  // Unready nodes
  const unreadyNodes = React.useMemo(() => {
    return nodes.filter((n) => !getNodeStatus(n).ready);
  }, [nodes]);

  // Pending PVCs
  const pendingPVCs = React.useMemo(() => {
    return pvcs.filter((pvc) => (pvc.status as any)?.phase === 'Pending');
  }, [pvcs]);

  // Recent warning events
  const recentWarnings = React.useMemo(() => {
    return events
      .filter((e) => (e as any).type === 'Warning')
      .sort((a, b) => {
        const at = (a as any).lastTimestamp || (a as any).firstTimestamp || '';
        const bt = (b as any).lastTimestamp || (b as any).firstTimestamp || '';
        return new Date(bt).getTime() - new Date(at).getTime();
      })
      .slice(0, 10);
  }, [events]);

  // Recent changes — group events by action type
  const recentChanges = React.useMemo(() => {
    const changeReasons = new Set(['Created', 'Started', 'Killing', 'Deleted', 'Pulled', 'Scheduled',
      'ScalingReplicaSet', 'SuccessfulCreate', 'SuccessfulDelete', 'ScaledUp', 'ScaledDown',
      'Scaled', 'DeploymentRollback', 'DeploymentUpdated']);

    const changes = events
      .filter((e) => {
        const reason = (e as any).reason || '';
        return changeReasons.has(reason) || reason.includes('Scaled') || reason.includes('Create') || reason.includes('Delete');
      })
      .sort((a, b) => {
        const at = (a as any).lastTimestamp || (a as any).firstTimestamp || '';
        const bt = (b as any).lastTimestamp || (b as any).firstTimestamp || '';
        return new Date(bt).getTime() - new Date(at).getTime();
      })
      .slice(0, 8);

    return changes;
  }, [events]);

  const totalIssues = failingPods.length + unhealthyDeploys.length + unreadyNodes.length + pendingPVCs.length;
  const isHealthy = totalIssues === 0;

  function navigateTo(path: string, title: string) {
    addTab({ title, path, pinned: false, closable: true });
    navigate(path);
  }

  function getGvrUrl(resource: K8sResource) {
    const apiVersion = resource.apiVersion || 'v1';
    const kind = resource.kind || '';
    const [group, version] = apiVersion.includes('/') ? apiVersion.split('/') : ['', apiVersion];
    const plural = kindToPlural(kind);
    const gvr = group ? `${group}~${version}~${plural}` : `${version}~${plural}`;
    const ns = resource.metadata.namespace;
    return ns ? `/r/${gvr}/${ns}/${resource.metadata.name}` : `/r/${gvr}/_/${resource.metadata.name}`;
  }

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <HeartPulse className="w-6 h-6 text-blue-500" />
              Cluster Pulse
            </h1>
            <p className="text-sm text-slate-400 mt-1">What needs your attention right now</p>
          </div>
          {isHealthy ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-800 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-sm font-medium text-green-300">All systems healthy</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-900/30 border border-red-800 rounded-lg">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              <span className="text-sm font-medium text-red-300">{totalIssues} issue{totalIssues !== 1 ? 's' : ''} need attention</span>
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Nodes"
            value={`${nodes.filter(n => getNodeStatus(n).ready).length}/${nodes.length}`}
            icon={<Server className="w-4 h-4" />}
            issues={unreadyNodes.length}
            onClick={() => navigate('/r/v1~nodes')}
          />
          <StatCard
            label="Pods"
            value={`${filteredPods.filter(p => { const s = getPodStatus(p); return s.phase === 'Running' && s.ready; }).length}/${filteredPods.length}`}
            icon={<Box className="w-4 h-4" />}
            issues={failingPods.length}
            onClick={() => navigate('/r/v1~pods')}
          />
          <StatCard
            label="Deployments"
            value={`${filteredDeployments.filter(d => getDeploymentStatus(d).available).length}/${filteredDeployments.length}`}
            icon={<Activity className="w-4 h-4" />}
            issues={unhealthyDeploys.length}
            onClick={() => navigate('/r/apps~v1~deployments')}
          />
          <StatCard
            label="Warnings"
            value={String(recentWarnings.length)}
            icon={<AlertCircle className="w-4 h-4" />}
            issues={recentWarnings.length}
            onClick={() => navigate('/timeline')}
          />
        </div>

        {/* Failing Pods */}
        {failingPods.length > 0 && (
          <IssueSection
            title={`Failing Pods (${failingPods.length})`}
            icon={<XCircle className="w-4 h-4 text-red-500" />}
            severity="critical"
          >
            {failingPods.slice(0, 5).map((pod) => {
              const status = getPodStatus(pod);
              const diagnoses = diagnoseResource(pod);
              return (
                <IssueRow
                  key={pod.metadata.uid}
                  name={pod.metadata.name}
                  namespace={pod.metadata.namespace}
                  status={status.reason || status.phase}
                  detail={diagnoses[0]?.suggestion}
                  onClick={() => navigateTo(getGvrUrl(pod), pod.metadata.name)}
                />
              );
            })}
            {failingPods.length > 5 && (
              <button onClick={() => navigate('/r/v1~pods')} className="w-full text-center text-xs text-blue-400 hover:text-blue-300 pt-2">
                View all {failingPods.length} failing pods →
              </button>
            )}
          </IssueSection>
        )}

        {/* Unhealthy Deployments */}
        {unhealthyDeploys.length > 0 && (
          <IssueSection
            title={`Unhealthy Deployments (${unhealthyDeploys.length})`}
            icon={<AlertCircle className="w-4 h-4 text-yellow-500" />}
            severity="warning"
          >
            {unhealthyDeploys.slice(0, 5).map((deploy) => {
              const status = getDeploymentStatus(deploy);
              return (
                <IssueRow
                  key={deploy.metadata.uid}
                  name={deploy.metadata.name}
                  namespace={deploy.metadata.namespace}
                  status={`${status.ready}/${status.desired} ready`}
                  onClick={() => navigateTo(getGvrUrl(deploy), deploy.metadata.name)}
                />
              );
            })}
          </IssueSection>
        )}

        {/* Unready Nodes */}
        {unreadyNodes.length > 0 && (
          <IssueSection
            title={`Unready Nodes (${unreadyNodes.length})`}
            icon={<XCircle className="w-4 h-4 text-red-500" />}
            severity="critical"
          >
            {unreadyNodes.map((node) => (
              <IssueRow
                key={node.metadata.uid}
                name={node.metadata.name}
                status="NotReady"
                onClick={() => navigateTo(`/r/v1~nodes/_/${node.metadata.name}`, node.metadata.name)}
              />
            ))}
          </IssueSection>
        )}

        {/* Pending PVCs */}
        {pendingPVCs.length > 0 && (
          <IssueSection
            title={`Pending PVCs (${pendingPVCs.length})`}
            icon={<AlertCircle className="w-4 h-4 text-yellow-500" />}
            severity="warning"
          >
            {pendingPVCs.slice(0, 5).map((pvc) => (
              <IssueRow
                key={pvc.metadata.uid}
                name={pvc.metadata.name}
                namespace={pvc.metadata.namespace}
                status="Pending"
                detail="No volume bound"
                onClick={() => navigateTo(getGvrUrl(pvc), pvc.metadata.name)}
              />
            ))}
          </IssueSection>
        )}

        {/* Recent Changes */}
        {recentChanges.length > 0 && (
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                Recent Changes
              </h2>
              <button
                onClick={() => navigate('/timeline')}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                View all <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="divide-y divide-slate-800">
              {recentChanges.map((event, idx) => {
                const e = event as any;
                const reason = e.reason || '';
                const time = e.lastTimestamp || e.firstTimestamp;
                const obj = e.involvedObject || {};

                let icon = <Activity className="w-3.5 h-3.5 text-blue-400" />;
                let color = 'text-blue-400';
                if (reason.includes('Create') || reason === 'Created' || reason === 'Started' || reason === 'Scheduled') {
                  icon = <CheckCircle className="w-3.5 h-3.5 text-green-400" />;
                  color = 'text-green-400';
                } else if (reason.includes('Delete') || reason === 'Killing') {
                  icon = <XCircle className="w-3.5 h-3.5 text-red-400" />;
                  color = 'text-red-400';
                } else if (reason.includes('Scal')) {
                  icon = <Activity className="w-3.5 h-3.5 text-purple-400" />;
                  color = 'text-purple-400';
                }

                return (
                  <div key={idx} className="px-4 py-2.5 hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-center gap-3">
                      {icon}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${color}`}>{reason}</span>
                          <span className="text-xs text-slate-500">{obj.kind} {obj.name}</span>
                        </div>
                      </div>
                      <span className="text-xs text-slate-500 flex-shrink-0">
                        {time ? new Date(time).toLocaleTimeString() : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Warnings */}
        <div className="bg-slate-900 rounded-lg border border-slate-800">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" />
              Recent Warning Events
            </h2>
            <button
              onClick={() => navigate('/timeline')}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
            {recentWarnings.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500 text-sm">
                <CheckCircle className="w-6 h-6 mx-auto mb-2 text-green-500" />
                No warning events
              </div>
            ) : (
              recentWarnings.map((event, idx) => {
                const e = event as any;
                const time = e.lastTimestamp || e.firstTimestamp;
                return (
                  <div key={idx} className="px-4 py-3 hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-slate-500">
                            {time ? new Date(time).toLocaleTimeString() : ''}
                          </span>
                          <span className="text-xs text-slate-600">·</span>
                          <span className="text-xs text-slate-400">{e.involvedObject?.kind} {e.involvedObject?.name}</span>
                        </div>
                        <div className="text-sm font-medium text-slate-200">{e.reason}</div>
                        <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{e.message}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, issues, onClick }: {
  label: string; value: string; icon: React.ReactNode; issues: number; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-slate-900 rounded-lg border p-3 cursor-pointer transition-colors hover:border-slate-600',
        issues > 0 ? 'border-yellow-800' : 'border-slate-800'
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-xs">{label}</span></div>
        {issues > 0 ? (
          <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{issues}</span>
        ) : (
          <div className="w-2 h-2 rounded-full bg-green-500" />
        )}
      </div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
    </div>
  );
}

function IssueSection({ title, icon, severity, children }: {
  title: string; icon: React.ReactNode; severity: 'critical' | 'warning'; children: React.ReactNode;
}) {
  return (
    <div className={cn(
      'rounded-lg border',
      severity === 'critical' ? 'bg-red-950/30 border-red-900' : 'bg-yellow-950/30 border-yellow-900'
    )}>
      <div className="px-4 py-3 border-b border-slate-800/50">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">{icon}{title}</h2>
      </div>
      <div className="p-3 space-y-1">{children}</div>
    </div>
  );
}

function IssueRow({ name, namespace, status, detail, onClick }: {
  name: string; namespace?: string; status: string; detail?: string; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between p-2 rounded hover:bg-slate-800/50 cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-sm text-slate-200 font-medium truncate">{name}</div>
          {namespace && <div className="text-xs text-slate-500">{namespace}</div>}
          {detail && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{detail}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-300 rounded">{status}</span>
        <ArrowRight className="w-3 h-3 text-slate-500" />
      </div>
    </div>
  );
}
