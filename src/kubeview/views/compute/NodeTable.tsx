import React from 'react';
import { CheckCircle, XCircle, Ban, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { formatBytes, formatCpu } from '../../engine/formatting';
import { UsageBar } from './StatCard';
import type { NodeDetail } from './types';

interface NodeTableProps {
  nodeDetails: NodeDetail[];
  totalCount: number;
  go: (path: string, title: string) => void;
}

export function NodeTable({ nodeDetails, totalCount, go }: NodeTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Nodes ({totalCount})</h2>
        <button onClick={() => go('/r/v1~nodes', 'Nodes')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Node</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Status</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Roles</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">CPU</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Memory</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Pods</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Instance</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Version</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Age</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {nodeDetails.map((nd) => {
              const podPct = nd.podCap > 0 ? (nd.podCount / nd.podCap) * 100 : 0;
              const memPct = nd.memUsagePct;
              const cpuPct = nd.cpuUsagePct;
              return (
                <tr key={nd.node.metadata.uid} onClick={() => go(`/r/v1~nodes/_/${nd.name}`, nd.name)}
                  className="hover:bg-slate-800/70 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {nd.status.ready ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                      <span className="text-slate-200 truncate max-w-[200px]" title={nd.name}>{nd.name}</span>
                      {nd.unschedulable && <Ban className="w-3 h-3 text-yellow-500" title="Cordoned" />}
                    </div>
                    {nd.taints.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {nd.taints.map((t, i) => (
                          <span key={i} className={cn('text-xs px-1 py-0.5 rounded font-mono',
                            t.effect === 'NoSchedule' ? 'bg-yellow-900/30 text-yellow-400' :
                            t.effect === 'NoExecute' ? 'bg-red-900/30 text-red-400' :
                            'bg-slate-800 text-slate-500'
                          )} title={`${t.key}=${t.value || ''}:${t.effect}`}>
                            {t.key.split('/').pop()}:{t.effect}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-xs px-1.5 py-0.5 rounded', nd.status.ready ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300')}>
                        {nd.status.ready ? 'Ready' : 'NotReady'}
                      </span>
                      {nd.pressures.length > 0 && nd.pressures.map((p: string) => (
                        <span key={p} className="text-xs px-1 py-0.5 bg-red-900/50 text-red-300 rounded">{p}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">{nd.roles.map((r: string) => <span key={r} className={cn('text-xs px-1.5 py-0.5 rounded', r === 'master' || r === 'control-plane' ? 'bg-purple-900/50 text-purple-300' : r === 'infra' ? 'bg-orange-900/50 text-orange-300' : 'bg-blue-900/50 text-blue-300')}>{r}</span>)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {cpuPct !== null ? (
                        <>
                          <UsageBar pct={cpuPct} color={cpuPct > 80 ? 'red' : cpuPct > 60 ? 'yellow' : 'green'} />
                          <span className="text-xs text-slate-400 font-mono w-10">{Math.round(cpuPct)}%</span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">{formatCpu(nd.cpuCap)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {memPct !== null ? (
                        <>
                          <UsageBar pct={memPct} color={memPct > 80 ? 'red' : memPct > 60 ? 'yellow' : 'green'} />
                          <span className="text-xs text-slate-400 font-mono w-10">{Math.round(memPct)}%</span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">{formatBytes(nd.memCap)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <UsageBar pct={podPct} color={podPct > 80 ? 'red' : podPct > 60 ? 'yellow' : 'blue'} />
                      <span className="text-xs text-slate-400 font-mono w-12">{nd.podCount}/{nd.podCap}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {nd.instanceType ? (
                      <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">{nd.instanceType}</span>
                    ) : (
                      <span className="text-xs text-slate-600">{nd.nodeInfo.architecture}</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><span className="text-xs text-slate-500 font-mono">{nd.nodeInfo.kubeletVersion}</span></td>
                  <td className="px-4 py-3"><span className="text-xs text-slate-500">{nd.age}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); go(`/node-logs/${nd.name}`, `${nd.name} (Logs)`); }} className="p-1 text-slate-500 hover:text-blue-400 transition-colors" title="Node Logs"><FileText className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
