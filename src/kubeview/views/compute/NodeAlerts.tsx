import React from 'react';
import { XCircle, AlertCircle, ArrowRight } from 'lucide-react';
import type { K8sResource } from '../../engine/renderers';
import { getNodeStatus } from '../../engine/renderers/statusUtils';

interface NodeAlertsProps {
  unreadyNodes: K8sResource[];
  pressureNodes: K8sResource[];
  go: (path: string, title: string) => void;
}

export function NodeAlerts({ unreadyNodes, pressureNodes, go }: NodeAlertsProps) {
  if (unreadyNodes.length === 0 && pressureNodes.length === 0) return null;

  return (
    <div className="space-y-2">
      {unreadyNodes.map((n) => (
        <button key={n.metadata.uid} onClick={() => go(`/r/v1~nodes/_/${n.metadata.name}`, n.metadata.name)}
          className="w-full flex items-center gap-3 px-4 py-3 bg-red-950/30 border border-red-900 rounded-lg hover:bg-red-950/50 text-left">
          <XCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div className="flex-1"><span className="text-sm font-medium text-slate-200">{n.metadata.name}</span><span className="text-xs text-red-400 ml-2">NotReady</span></div>
          <ArrowRight className="w-4 h-4 text-slate-600" />
        </button>
      ))}
      {pressureNodes.map((n) => {
        const s = getNodeStatus(n);
        const pressures = [s.pressure.disk && 'Disk', s.pressure.memory && 'Memory', s.pressure.pid && 'PID'].filter(Boolean).join(', ');
        return (
          <button key={n.metadata.uid} onClick={() => go(`/r/v1~nodes/_/${n.metadata.name}`, n.metadata.name)}
            className="w-full flex items-center gap-3 px-4 py-3 bg-yellow-950/30 border border-yellow-900 rounded-lg hover:bg-yellow-950/50 text-left">
            <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0" />
            <div className="flex-1"><span className="text-sm font-medium text-slate-200">{n.metadata.name}</span><span className="text-xs text-yellow-400 ml-2">{pressures} Pressure</span></div>
            <ArrowRight className="w-4 h-4 text-slate-600" />
          </button>
        );
      })}
    </div>
  );
}
