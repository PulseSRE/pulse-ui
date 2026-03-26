import React from 'react';
import {
  Hammer, CheckCircle, XCircle, Clock, Loader2, ArrowRight,
  AlertTriangle, Play, Box, Layers, Timer, StopCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { k8sCreate, k8sGet, k8sPatch } from '../engine/query';
import { useQuery } from '@tanstack/react-query';
import { Panel } from '../components/primitives/Panel';
import { MetricCard } from '../components/metrics/Sparkline';
import { CHART_COLORS } from '../engine/colors';
import { formatDuration, timeAgo } from '../engine/dateUtils';
import type { Build, BuildConfig, ImageStream } from '../engine/types';
import { Card } from '../components/primitives/Card';
import { showErrorToast } from '../engine/errorToast';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { ScrollText } from 'lucide-react';

function getBuildStatus(build: Build): { phase: string; color: string; icon: React.ReactNode } {
  const phase = build.status?.phase || 'Unknown';
  switch (phase) {
    case 'Complete':
      return { phase, color: 'text-green-400', icon: <CheckCircle className="w-4 h-4 text-green-500" /> };
    case 'Running':
      return { phase, color: 'text-blue-400', icon: <Loader2 className="w-4 h-4 text-blue-400 animate-spin" /> };
    case 'Pending':
    case 'New':
      return { phase, color: 'text-yellow-400', icon: <Clock className="w-4 h-4 text-yellow-400" /> };
    case 'Failed':
    case 'Error':
      return { phase, color: 'text-red-400', icon: <XCircle className="w-4 h-4 text-red-500" /> };
    case 'Cancelled':
      return { phase, color: 'text-slate-500', icon: <XCircle className="w-4 h-4 text-slate-500" /> };
    default:
      return { phase, color: 'text-slate-400', icon: <AlertTriangle className="w-4 h-4 text-slate-400" /> };
  }
}

export default function BuildsView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const addToast = useUIStore((s) => s.addToast);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  const { data: builds = [] } = useK8sListWatch({ apiPath: '/apis/build.openshift.io/v1/builds', namespace: nsFilter });
  const { data: buildConfigs = [] } = useK8sListWatch({ apiPath: '/apis/build.openshift.io/v1/buildconfigs', namespace: nsFilter });
  const { data: imageStreams = [] } = useK8sListWatch({ apiPath: '/apis/image.openshift.io/v1/imagestreams', namespace: nsFilter });

  async function cancelBuild(namespace: string, name: string) {
    try {
      await k8sPatch(
        `/apis/build.openshift.io/v1/namespaces/${namespace}/builds/${name}`,
        { status: { cancelled: true } },
      );
      addToast({ type: 'success', title: `Build ${name} cancelled` });
    } catch (e) {
      showErrorToast(e, 'Cancel failed');
    }
  }

  // Build stats
  const buildStats = React.useMemo(() => {
    const stats = { Complete: 0, Running: 0, Pending: 0, Failed: 0, Cancelled: 0, Other: 0 };
    for (const b of builds as Build[]) {
      const phase = b.status?.phase || 'Other';
      if (phase in stats) stats[phase as keyof typeof stats]++;
      else if (phase === 'New') stats.Pending++;
      else if (phase === 'Error') stats.Failed++;
      else stats.Other++;
    }
    return stats;
  }, [builds]);

  // Recent builds sorted by creation time
  const recentBuilds = React.useMemo(() =>
    [...(builds as Build[])].sort((a, b) =>
      new Date(b.metadata?.creationTimestamp || 0).getTime() - new Date(a.metadata?.creationTimestamp || 0).getTime()
    ).slice(0, 50),
  [builds]);

  // Build duration averages per BuildConfig
  const buildConfigStats = React.useMemo(() => {
    const map = new Map<string, { total: number; count: number; lastStatus: string; lastBuild: string }>();
    for (const b of builds as Build[]) {
      const bcName = b.metadata?.labels?.['openshift.io/build-config.name'] || b.metadata?.annotations?.['openshift.io/build-config.name'];
      if (!bcName) continue;
      const key = `${b.metadata?.namespace}/${bcName}`;
      const entry = map.get(key) || { total: 0, count: 0, lastStatus: '', lastBuild: '' };
      const start = b.status?.startTimestamp;
      const end = b.status?.completionTimestamp;
      if (start && end) {
        entry.total += new Date(end).getTime() - new Date(start).getTime();
        entry.count++;
      }
      if (!entry.lastBuild || new Date(b.metadata?.creationTimestamp || 0) > new Date(entry.lastBuild)) {
        entry.lastBuild = b.metadata?.creationTimestamp || '';
        entry.lastStatus = b.status?.phase || '';
      }
      map.set(key, entry);
    }
    return map;
  }, [builds]);

  // Failed builds
  const failedBuilds = React.useMemo(() =>
    recentBuilds.filter(b => b.status?.phase === 'Failed' || b.status?.phase === 'Error'),
  [recentBuilds]);

  // Running builds
  const runningBuilds = React.useMemo(() =>
    recentBuilds.filter(b => b.status?.phase === 'Running' || b.status?.phase === 'New' || b.status?.phase === 'Pending'),
  [recentBuilds]);

  // ImageStream tag count
  const totalTags = React.useMemo(() =>
    (imageStreams as ImageStream[]).reduce((sum, is) => sum + (is.status?.tags?.length || 0), 0),
  [imageStreams]);

  // Issues
  const issues: Array<{ msg: string; severity: 'warning' | 'critical' }> = [];
  if (failedBuilds.length > 0) issues.push({ msg: `${failedBuilds.length} failed build${failedBuilds.length > 1 ? 's' : ''}`, severity: 'critical' });
  if (runningBuilds.length > 0) issues.push({ msg: `${runningBuilds.length} build${runningBuilds.length > 1 ? 's' : ''} in progress`, severity: 'warning' });

  // Trigger build
  const handleTriggerBuild = async (bc: BuildConfig) => {
    const ns = bc.metadata?.namespace;
    const name = bc.metadata?.name;
    try {
      await k8sCreate(`/apis/build.openshift.io/v1/namespaces/${ns}/buildconfigs/${name}/instantiate`, {
        apiVersion: 'build.openshift.io/v1',
        kind: 'BuildRequest',
        metadata: { name },
      });
      addToast({ type: 'success', title: `Build triggered for ${name}` });
    } catch (err) {
      showErrorToast(err, 'Build trigger failed');
    }
  };

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Hammer className="w-6 h-6 text-orange-500" /> Builds
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            BuildConfigs, Builds, and ImageStreams
            {nsFilter && <span className="text-blue-400 ml-1">in {nsFilter}</span>}
          </p>
        </div>

        {/* Issues */}
        {issues.length > 0 && (
          <div className="space-y-2">
            {issues.map((issue, i) => (
              <div key={i} className={cn('flex items-center px-4 py-2.5 rounded-lg border',
                issue.severity === 'critical' ? 'bg-red-950/30 border-red-900' : 'bg-yellow-950/30 border-yellow-900')}>
                <div className="flex items-center gap-2">
                  {issue.severity === 'critical' ? <XCircle className="w-4 h-4 text-red-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  <span className="text-sm text-slate-200">{issue.msg}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <MetricGrid>
          <button onClick={() => go('/r/build.openshift.io~v1~buildconfigs', 'BuildConfigs')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">BuildConfigs</div>
            <div className="text-xl font-bold text-slate-100">{buildConfigs.length}</div>
          </button>
          <button onClick={() => go('/r/build.openshift.io~v1~builds', 'Builds')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', failedBuilds.length > 0 ? 'border-red-800' : 'border-slate-800')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Builds</span>
              {failedBuilds.length > 0 && <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{failedBuilds.length}</span>}
            </div>
            <div className="text-xl font-bold text-slate-100">{builds.length}</div>
          </button>
          <button onClick={() => go('/r/image.openshift.io~v1~imagestreams', 'ImageStreams')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">ImageStreams</div>
            <div className="text-xl font-bold text-slate-100">{imageStreams.length}</div>
          </button>
          <Card className="p-3">
            <div className="text-xs text-slate-400 mb-1">Image Tags</div>
            <div className="text-xl font-bold text-slate-100">{totalTags}</div>
          </Card>
        </MetricGrid>

        {/* Build Metrics */}
        {builds.length > 0 && (
          <MetricGrid>
            <MetricCard
              title="Build Rate"
              query='sum(increase(openshift_build_total[1h]))'
              unit="/hr"
              color={CHART_COLORS.blue}
            />
            <MetricCard
              title="Avg Duration"
              query='avg(openshift_build_duration_seconds) / 60'
              unit=" min"
              color={CHART_COLORS.amber}
            />
            <MetricCard
              title="Failure Rate"
              query='sum(openshift_build_total{phase=~"Failed|Error|Cancelled"}) / sum(openshift_build_total) * 100'
              unit="%"
              color={CHART_COLORS.red}
              thresholds={{ warning: 10, critical: 30 }}
            />
            <Card className="p-3">
              <div className="text-xs text-slate-400 mb-1">Success Rate</div>
              <div className={cn('text-xl font-bold', (() => {
                const complete = recentBuilds.filter(b => b.status?.phase === 'Complete').length;
                const total = recentBuilds.filter(b => b.status?.phase === 'Complete' || b.status?.phase === 'Failed' || b.status?.phase === 'Error').length;
                const rate = total > 0 ? Math.round((complete / total) * 100) : 100;
                return rate >= 90 ? 'text-emerald-400' : rate >= 70 ? 'text-amber-400' : 'text-red-400';
              })())}>
                {(() => {
                  const complete = recentBuilds.filter(b => b.status?.phase === 'Complete').length;
                  const total = recentBuilds.filter(b => b.status?.phase === 'Complete' || b.status?.phase === 'Failed' || b.status?.phase === 'Error').length;
                  return total > 0 ? `${Math.round((complete / total) * 100)}%` : '—';
                })()}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">last {recentBuilds.length} builds</div>
            </Card>
          </MetricGrid>
        )}

        {/* Build Status Breakdown */}
        {builds.length > 0 && (
          <Panel title="Build Status" icon={<Hammer className="w-4 h-4 text-orange-400" />}>
            <div className="space-y-2">
              {Object.entries(buildStats).filter(([, count]) => count > 0).map(([status, count]) => {
                const maxCount = Math.max(...Object.values(buildStats).filter(v => v > 0), 1);
                const pct = (count / maxCount) * 100;
                const color = status === 'Complete' ? 'bg-green-500' : status === 'Running' ? 'bg-blue-500' : status === 'Pending' ? 'bg-amber-500' : status === 'Failed' ? 'bg-red-500' : 'bg-slate-600';
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('w-2.5 h-2.5 rounded-full', color)} />
                        <span className="text-sm text-slate-300">{status}</span>
                      </div>
                      <span className="text-sm font-mono text-slate-400">{count}</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* BuildConfigs */}
        <Panel title={`BuildConfigs (${buildConfigs.length})`} icon={<Layers className="w-4 h-4 text-blue-400" />}>
          {buildConfigs.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">No BuildConfigs{nsFilter ? ` in ${nsFilter}` : ''}</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {(buildConfigs as BuildConfig[]).map((bc) => {
                const name = bc.metadata?.name || '';
                const ns = bc.metadata?.namespace || '';
                const strategy = bc.spec?.strategy?.type || 'Unknown';
                const source = bc.spec?.source?.type || 'None';
                const sourceURI = bc.spec?.source?.git?.uri || '';
                const key = `${ns}/${name}`;
                const stats = buildConfigStats.get(key);
                const avgDuration = stats && stats.count > 0 ? formatDuration('2000-01-01T00:00:00Z', new Date(new Date('2000-01-01T00:00:00Z').getTime() + stats.total / stats.count).toISOString()) : '—';
                const lastBuildPhase = stats?.lastStatus || '—';
                const lastBuildTime = stats?.lastBuild ? timeAgo(stats.lastBuild) : '—';

                return (
                  <div key={bc.metadata?.uid} className="flex items-center gap-3 py-3 px-1 group">
                    <div className="flex-1 min-w-0">
                      <button onClick={() => go(`/r/build.openshift.io~v1~buildconfigs/${ns}/${name}`, name)}
                        className="text-sm font-medium text-blue-400 hover:text-blue-300 truncate block">
                        {name}
                      </button>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span>{ns}</span>
                        <span>{strategy}</span>
                        {source === 'Git' && <span className="truncate max-w-48">{sourceURI}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-400 shrink-0">
                      <div className="flex items-center gap-1" title="Average duration">
                        <Timer className="w-3 h-3" /> {avgDuration}
                      </div>
                      <div className="flex items-center gap-1" title="Last build">
                        <Clock className="w-3 h-3" />
                        <span className={lastBuildPhase === 'Complete' ? 'text-green-400' : lastBuildPhase === 'Failed' ? 'text-red-400' : ''}>
                          {lastBuildPhase}
                        </span>
                        <span className="text-slate-500">{lastBuildTime}</span>
                      </div>
                      <button onClick={() => handleTriggerBuild(bc)}
                        className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
                        title="Start build">
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Running Builds */}
        {runningBuilds.length > 0 && (
          <Panel title={`In Progress (${runningBuilds.length})`} icon={<Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}>
            <div className="divide-y divide-slate-800">
              {runningBuilds.map((b: Build) => {
                const { phase, color, icon } = getBuildStatus(b);
                const name = b.metadata?.name || '';
                const ns = b.metadata?.namespace || '';
                const start = b.status?.startTimestamp;
                return (
                  <div key={b.metadata?.uid} className="flex items-center gap-3 py-3 px-1">
                    {icon}
                    <div className="flex-1 min-w-0">
                      <button onClick={() => go(`/r/build.openshift.io~v1~builds/${ns}/${name}`, name)}
                        className="text-sm font-medium text-blue-400 hover:text-blue-300 truncate block">{name}</button>
                      <div className="text-xs text-slate-500">{ns}</div>
                    </div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      {start ? formatDuration(start) : '—'}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); go(`/logs/${ns}/${name}?container=&kind=Build`, `${name} (Logs)`); }}
                      className="text-slate-500 hover:text-blue-400 transition-colors" title="View Build Logs"
                    ><ScrollText className="w-3.5 h-3.5" /></button>
                    {(phase === 'Running' || phase === 'Pending' || phase === 'New') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelBuild(ns, name); }}
                        className="text-slate-500 hover:text-red-400 transition-colors" title="Cancel Build"
                      ><StopCircle className="w-3.5 h-3.5" /></button>
                    )}
                    <span className={cn('text-xs', color)}>{phase}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* Failed Builds */}
        {failedBuilds.length > 0 && (
          <Panel title={`Failed Builds (${failedBuilds.length})`} icon={<XCircle className="w-4 h-4 text-red-500" />}>
            <div className="divide-y divide-slate-800">
              {failedBuilds.slice(0, 20).map((b: Build) => {
                const name = b.metadata?.name || '';
                const ns = b.metadata?.namespace || '';
                const message = b.status?.message || b.status?.reason || '';
                const start = b.status?.startTimestamp;
                const end = b.status?.completionTimestamp;
                return (
                  <div key={b.metadata?.uid} className="flex items-center gap-3 py-3 px-1">
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <button onClick={() => go(`/r/build.openshift.io~v1~builds/${ns}/${name}`, name)}
                        className="text-sm font-medium text-blue-400 hover:text-blue-300 truncate block">{name}</button>
                      {message && <div className="text-xs text-red-400 truncate mt-0.5">{message}</div>}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); go(`/logs/${ns}/${name}?container=&kind=Build`, `${name} (Logs)`); }}
                      className="text-slate-500 hover:text-blue-400 transition-colors" title="View Build Logs"
                    ><ScrollText className="w-3.5 h-3.5" /></button>
                    <div className="text-xs text-slate-500 shrink-0 flex items-center gap-2">
                      <span>{start && end ? formatDuration(start, end) : '—'}</span>
                      <span>{timeAgo(b.metadata?.creationTimestamp)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* Recent Builds */}
        <Panel title={`Recent Builds (${builds.length})`} icon={<Hammer className="w-4 h-4 text-orange-400" />}>
          {builds.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">No builds{nsFilter ? ` in ${nsFilter}` : ''}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Namespace</th>
                    <th className="py-2 pr-4">Strategy</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2 pr-4">Started</th>
                    <th className="py-2 pr-4">Logs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {recentBuilds.slice(0, 30).map((b: Build) => {
                    const { phase, color, icon } = getBuildStatus(b);
                    const name = b.metadata?.name || '';
                    const ns = b.metadata?.namespace || '';
                    const strategy = b.spec?.strategy?.type || '—';
                    const start = b.status?.startTimestamp;
                    const end = b.status?.completionTimestamp;
                    return (
                      <tr key={b.metadata?.uid} className="hover:bg-slate-900/50">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1.5">
                            {icon}
                            <span className={cn('text-xs', color)}>{phase}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <button onClick={() => go(`/r/build.openshift.io~v1~builds/${ns}/${name}`, name)}
                            className="text-blue-400 hover:text-blue-300 truncate block max-w-64">{name}</button>
                        </td>
                        <td className="py-2 pr-4 text-slate-500">{ns}</td>
                        <td className="py-2 pr-4 text-slate-500">{strategy}</td>
                        <td className="py-2 pr-4 text-slate-400 font-mono">{start ? formatDuration(start, end || undefined) : '—'}</td>
                        <td className="py-2 pr-4 text-slate-500">{timeAgo(b.metadata?.creationTimestamp)}</td>
                        <td className="py-2 pr-4">
                          <button
                            onClick={(e) => { e.stopPropagation(); go(`/logs/${ns}/${name}?container=&kind=Build`, `${name} (Logs)`); }}
                            className="text-slate-500 hover:text-blue-400 transition-colors" title="View Build Logs"
                          ><ScrollText className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {builds.length > 30 && (
                <div className="py-2 text-center">
                  <button onClick={() => go('/r/build.openshift.io~v1~builds', 'Builds')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mx-auto">
                    View all {builds.length} <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* ImageStreams */}
        <Panel title={`ImageStreams (${imageStreams.length})`} icon={<Box className="w-4 h-4 text-purple-400" />}>
          {imageStreams.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">No ImageStreams{nsFilter ? ` in ${nsFilter}` : ''}</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {(imageStreams as ImageStream[]).slice(0, 25).map((is) => {
                const name = is.metadata?.name || '';
                const ns = is.metadata?.namespace || '';
                const tags = is.status?.tags || [];
                const dockerRepo = is.status?.dockerImageRepository || '';
                return (
                  <div key={is.metadata?.uid} className="flex items-center gap-3 py-3 px-1">
                    <Box className="w-4 h-4 text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <button onClick={() => go(`/r/image.openshift.io~v1~imagestreams/${ns}/${name}`, name)}
                        className="text-sm font-medium text-blue-400 hover:text-blue-300 truncate block">{name}</button>
                      <div className="text-xs text-slate-500 truncate">{dockerRepo || ns}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {tags.slice(0, 4).map((tag: { tag: string }) => (
                        <span key={tag.tag} className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded">{tag.tag}</span>
                      ))}
                      {tags.length > 4 && <span className="text-xs text-slate-500">+{tags.length - 4}</span>}
                    </div>
                  </div>
                );
              })}
              {imageStreams.length > 25 && (
                <div className="py-2 text-center">
                  <button onClick={() => go('/r/image.openshift.io~v1~imagestreams', 'ImageStreams')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mx-auto">
                    View all {imageStreams.length} <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

