import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import type { K8sResource } from '../../engine/renderers';
import type { MachineConfigPoolResource } from './types';

interface MachineConfigSectionProps {
  machineConfigPools: K8sResource[];
  go: (path: string, title: string) => void;
}

export function MachineConfigSection({ machineConfigPools, go }: MachineConfigSectionProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <MachineConfigPoolsCard machineConfigPools={machineConfigPools} go={go} />
      <MachineConfigQuickAccess go={go} />
    </div>
  );
}

function MachineConfigPoolsCard({ machineConfigPools, go }: { machineConfigPools: K8sResource[]; go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">MachineConfigPools ({machineConfigPools.length})</h2>
        <button onClick={() => go('/r/machineconfiguration.openshift.io~v1~machineconfigpools', 'MachineConfigPools')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
        {machineConfigPools.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500">No MachineConfigPools found</div>
        ) : (machineConfigPools as MachineConfigPoolResource[]).map((mcp) => {
          const conditions = mcp.status?.conditions || [];
          const updated = conditions.find((c) => c.type === 'Updated');
          const updating = conditions.find((c) => c.type === 'Updating');
          const degraded = conditions.find((c) => c.type === 'Degraded');
          const isUpdated = updated?.status === 'True';
          const isUpdating = updating?.status === 'True';
          const isDegraded = degraded?.status === 'True';
          const machineCount = mcp.status?.machineCount ?? 0;
          const readyCount = mcp.status?.readyMachineCount ?? 0;
          const updatedCount = mcp.status?.updatedMachineCount ?? 0;
          const currentConfig = mcp.status?.configuration?.name || '';

          return (
            <button key={mcp.metadata.uid} onClick={() => go(`/r/machineconfiguration.openshift.io~v1~machineconfigpools/_/${mcp.metadata.name}`, mcp.metadata.name)}
              className="w-full px-4 py-3 hover:bg-slate-800/50 text-left transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{mcp.metadata.name}</span>
                  {isDegraded && <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded">Degraded</span>}
                  {isUpdating && <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">Updating</span>}
                  {isUpdated && !isUpdating && <span className="text-xs px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded">Updated</span>}
                </div>
                <span className={cn('text-xs font-mono', readyCount === machineCount ? 'text-green-400' : 'text-yellow-400')}>
                  {readyCount}/{machineCount} ready
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>{updatedCount}/{machineCount} updated</span>
                {currentConfig && <span className="font-mono truncate max-w-[200px]">Config: {currentConfig}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function MachineConfigQuickAccess({ go }: { go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Machine Configuration</h2>
        <button onClick={() => go('/r/machineconfiguration.openshift.io~v1~machineconfigs', 'MachineConfigs')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      <div className="p-4 space-y-2">
        <p className="text-xs text-slate-400">MachineConfigs define OS-level configuration for nodes — systemd units, kernel parameters, files, and more. Changes trigger rolling reboots via MachineConfigPools.</p>
        <div className="space-y-1.5 pt-2">
          {[
            { label: 'MachineConfigs', path: '/r/machineconfiguration.openshift.io~v1~machineconfigs', desc: 'OS-level node configuration (files, systemd, kernel args)' },
            { label: 'MachineConfigPools', path: '/r/machineconfiguration.openshift.io~v1~machineconfigpools', desc: 'Groups of nodes that share the same MachineConfig' },
            { label: 'KubeletConfigs', path: '/r/machineconfiguration.openshift.io~v1~kubeletconfigs', desc: 'Kubelet parameters (maxPods, eviction thresholds)' },
            { label: 'ContainerRuntimeConfigs', path: '/r/machineconfiguration.openshift.io~v1~containerruntimeconfigs', desc: 'CRI-O runtime settings (pids limit, log size)' },
          ].map((item) => (
            <button key={item.label} onClick={() => go(item.path, item.label)}
              className="flex items-center justify-between w-full py-2 px-3 rounded hover:bg-slate-800/50 text-left transition-colors">
              <div>
                <div className="text-sm text-slate-200">{item.label}</div>
                <div className="text-xs text-slate-500">{item.desc}</div>
              </div>
              <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
