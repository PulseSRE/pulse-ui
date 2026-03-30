import React, { lazy, Suspense } from 'react';
import { HeartPulse } from 'lucide-react';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { ReportTab } from './pulse/ReportTab';
import { FleetReportTab } from './pulse/FleetReportTab';
import { AIOnboarding } from '../components/agent/AIOnboarding';
import { SectionHeader } from '../components/primitives/SectionHeader';

const TopologyMap = lazy(() => import('../components/topology/TopologyMap'));

export default function PulseView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const fleetMode = useFleetStore((s) => s.fleetMode);

  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;
  const { data: nodes = [], isLoading: nodesLoading } = useK8sListWatch({ apiPath: '/api/v1/nodes' });
  const { data: pods = [], isLoading: podsLoading } = useK8sListWatch({ apiPath: '/api/v1/pods', namespace: nsFilter });
  const { data: deployments = [], isLoading: deploysLoading } = useK8sListWatch({ apiPath: '/apis/apps/v1/deployments', namespace: nsFilter });
  const { data: pvcs = [], isLoading: pvcsLoading } = useK8sListWatch({ apiPath: '/api/v1/persistentvolumeclaims', namespace: nsFilter });
  const { data: operators = [], isLoading: opsLoading } = useK8sListWatch({ apiPath: '/apis/config.openshift.io/v1/clusteroperators' });
  const { data: events = [] } = useK8sListWatch({ apiPath: '/api/v1/events', namespace: nsFilter });

  const isLoading = nodesLoading || podsLoading || deploysLoading || pvcsLoading || opsLoading;

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <SectionHeader
          icon={<HeartPulse className="w-6 h-6 text-blue-500" />}
          title="Cluster Pulse"
          subtitle={<>Daily briefing — control plane, capacity, workload health, and next steps{selectedNamespace !== '*' && <span className="text-blue-400 ml-1">· {selectedNamespace}</span>}</>}
        />

        <AIOnboarding compact className="mb-2" />

        <Suspense fallback={
          <div className="h-[420px] bg-slate-900 rounded-lg border border-slate-800 animate-pulse" />
        }>
          <TopologyMap
            nodes={nodes as K8sResource[]}
            pods={pods as K8sResource[]}
            operators={operators as K8sResource[]}
            events={events as K8sResource[]}
            go={go}
          />
        </Suspense>

        {fleetMode === 'multi' ? (
          <FleetReportTab />
        ) : isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-slate-900 rounded-lg border border-slate-800 p-6 animate-pulse">
                <div className="h-4 bg-slate-800 rounded w-1/3 mb-3" />
                <div className="h-3 bg-slate-800 rounded w-2/3 mb-2" />
                <div className="h-3 bg-slate-800 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : (
        <ReportTab
          nodes={nodes as K8sResource[]}
          allPods={pods as K8sResource[]}
          deployments={deployments as K8sResource[]}
          pvcs={pvcs as K8sResource[]}
          operators={operators as K8sResource[]}
          go={go}
        />
        )}
      </div>
    </div>
  );
}
