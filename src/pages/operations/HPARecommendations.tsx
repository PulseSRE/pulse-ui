import { Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface HPARow {
  name: string;
  namespace: string;
  target: string;
  minPods: number;
  maxPods: number;
  currentReplicas: number;
  desiredReplicas: number;
  cpuTarget: string;
  cpuCurrent: string;
  status: string;
  atCeiling: boolean;
}

interface RawHPAMetric {
  type: string;
  resource?: {
    name: string;
    current?: { averageUtilization?: number };
  };
}

interface RawHPACondition {
  type: string;
  status: string;
  message?: string;
}

interface RawHPA extends K8sMeta {
  spec: {
    scaleTargetRef: { kind?: string; name: string };
    minReplicas?: number;
    maxReplicas: number;
    metrics?: {
      type: string;
      resource?: {
        name: string;
        target?: { averageUtilization?: number };
      };
    }[];
  };
  status: {
    currentReplicas?: number;
    desiredReplicas?: number;
    currentMetrics?: RawHPAMetric[];
    conditions?: RawHPACondition[];
  };
}

function getCpuTarget(metrics: RawHPA['spec']['metrics']): string {
  const cpu = metrics?.find((m) => m.resource?.name === 'cpu');
  const val = cpu?.resource?.target?.averageUtilization;
  return val !== undefined ? `${val}%` : '-';
}

function getCpuCurrent(metrics: RawHPAMetric[] | undefined): string {
  const cpu = metrics?.find((m) => m.resource?.name === 'cpu');
  const val = cpu?.resource?.current?.averageUtilization;
  return val !== undefined ? `${val}%` : '-';
}

function getHPAStatus(conditions: RawHPACondition[] | undefined): string {
  if (!conditions || conditions.length === 0) return 'Unknown';
  const scaling = conditions.find((c) => c.type === 'ScalingActive');
  if (scaling?.status === 'True') return 'Active';
  const limited = conditions.find((c) => c.type === 'ScalingLimited');
  if (limited?.status === 'True') return 'Limited';
  return 'OK';
}

const columns: ColumnDef<HPARow>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Target', key: 'target' },
  { title: 'Min Pods', key: 'minPods' },
  { title: 'Max Pods', key: 'maxPods' },
  { title: 'Current Replicas', key: 'currentReplicas' },
  { title: 'Desired Replicas', key: 'desiredReplicas' },
  {
    title: 'CPU Target %',
    key: 'cpuTarget',
  },
  {
    title: 'CPU Current %',
    key: 'cpuCurrent',
  },
  {
    title: 'Status',
    key: 'status',
    render: (hpa) => {
      if (hpa.atCeiling) {
        return <Label color="orange">At Ceiling</Label>;
      }
      const colorMap: Record<string, 'green' | 'blue' | 'orange' | 'grey'> = {
        Active: 'blue',
        OK: 'green',
        Limited: 'orange',
      };
      return <Label color={colorMap[hpa.status] ?? 'grey'}>{hpa.status}</Label>;
    },
  },
];

export default function HPARecommendations() {
  const { data, loading } = useK8sResource<RawHPA, HPARow>(
    '/apis/autoscaling/v2/horizontalpodautoscalers',
    (item) => {
      const currentReplicas = item.status.currentReplicas ?? 0;
      const maxPods = item.spec.maxReplicas;
      return {
        name: item.metadata.name,
        namespace: item.metadata.namespace ?? '',
        target: `${item.spec.scaleTargetRef.kind ?? 'Deployment'}/${item.spec.scaleTargetRef.name}`,
        minPods: item.spec.minReplicas ?? 1,
        maxPods,
        currentReplicas,
        desiredReplicas: item.status.desiredReplicas ?? 0,
        cpuTarget: getCpuTarget(item.spec.metrics),
        cpuCurrent: getCpuCurrent(item.status.currentMetrics),
        status: getHPAStatus(item.status.conditions),
        atCeiling: currentReplicas === maxPods,
      };
    },
    15000,
  );

  return (
    <ResourceListPage
      title="HPA Recommendations"
      description="Review Horizontal Pod Autoscaler states and identify potential scaling ceilings"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(hpa) => `${hpa.namespace}-${hpa.name}`}
      nameField="name"
      filterFn={(hpa, s) =>
        hpa.name.toLowerCase().includes(s.toLowerCase()) ||
        hpa.namespace.toLowerCase().includes(s.toLowerCase()) ||
        hpa.target.toLowerCase().includes(s.toLowerCase())
      }
    />
  );
}
