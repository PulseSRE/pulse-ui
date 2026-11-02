import React from 'react';
import { formatRelative } from '../../engine/format';
import { Clock, Globe, Server, HardDrive } from 'lucide-react';
import type { K8sResource } from '../../engine/renderers';
import type { Pod } from '../../engine/types';
import { Card } from '../../components/primitives/Card';

interface PodSummaryProps {
  resource: K8sResource;
  go: (path: string, title: string) => void;
}

export function PodSummary({ resource }: PodSummaryProps) {
  const spec = resource.spec as Pod['spec'];
  const status = resource.status as Pod['status'] | undefined;
  const podIP = status?.podIP || '—';
  const hostIP = status?.hostIP || '';
  const qosClass = status?.qosClass || '—';
  const serviceAccount = spec?.serviceAccountName || spec?.serviceAccount || '—';
  const restartPolicy = spec?.restartPolicy || 'Always';
  const volumes = spec?.volumes || [];
  const age = formatRelative(resource.metadata.creationTimestamp);


  return (
    <div className="space-y-4">
      {/* Placement and identity. State, restarts and the last exit are in the
          pod header; per-container facts in the container cards. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm md:grid-cols-3 lg:grid-cols-6" aria-label="Pod facts">
        <div><dt className="text-xs text-slate-500 flex items-center gap-1"><Globe className="w-3 h-3" />Pod IP</dt><dd className="font-mono text-slate-200 truncate">{podIP}</dd></div>
        <div><dt className="text-xs text-slate-500 flex items-center gap-1"><Server className="w-3 h-3" />Host IP</dt><dd className="font-mono text-slate-200 truncate">{hostIP || '—'}</dd></div>
        <div><dt className="text-xs text-slate-500">QoS class</dt><dd className="text-slate-200">{qosClass}</dd></div>
        <div><dt className="text-xs text-slate-500">Service account</dt><dd className="text-slate-200 truncate">{serviceAccount}</dd></div>
        <div><dt className="text-xs text-slate-500">Restart policy</dt><dd className="text-slate-200">{restartPolicy}</dd></div>
        <div><dt className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />Age</dt><dd className="text-slate-200" title={resource.metadata.creationTimestamp}>{age}</dd></div>
      </dl>

      {/* Pod CPU and memory sparklines are in the incident context panel (once). */}

      {/* Volumes */}
      {volumes.length > 0 && (
        <Card>
          <div className="px-4 py-2.5 border-b border-slate-800">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Volumes ({volumes.length})</h3>
          </div>
          <div className="divide-y divide-slate-800">
            {volumes.map((v) => {
              const vol = v as { name: string; [key: string]: unknown };
              const type = vol.configMap ? 'ConfigMap' : vol.secret ? 'Secret' : vol.persistentVolumeClaim ? 'PVC' :
                vol.emptyDir ? 'EmptyDir' : vol.hostPath ? 'HostPath' : vol.downwardAPI ? 'DownwardAPI' :
                vol.projected ? 'Projected' : 'Other';
              const ref = (vol.configMap as Record<string, string> | undefined)?.name || (vol.secret as Record<string, string> | undefined)?.secretName || (vol.persistentVolumeClaim as Record<string, string> | undefined)?.claimName ||
                (vol.hostPath as Record<string, string> | undefined)?.path || '';
              return (
                <div key={v.name} className="px-4 py-2 flex items-center gap-3">
                  <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-200">{v.name}</span>
                  </div>
                  <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{type}</span>
                  {ref && (
                    <span className="text-xs text-slate-500 font-mono truncate max-w-48">{ref}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
