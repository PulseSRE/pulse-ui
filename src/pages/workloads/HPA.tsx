import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface HorizontalPodAutoscaler {
  name: string;
  namespace: string;
  reference: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  cpuTarget: string;
  cpuCurrent: string;
  age: string;
}

interface RawHPAMetric {
  type: string;
  resource?: {
    name: string;
    current?: { averageUtilization?: number };
  };
}

interface RawHPA extends K8sMeta {
  spec: {
    scaleTargetRef: { kind?: string; name: string };
    minReplicas?: number;
    maxReplicas: number;
    metrics?: { type: string; resource?: { name: string; target?: { averageUtilization?: number } } }[];
  };
  status: {
    currentReplicas?: number;
    currentMetrics?: RawHPAMetric[];
  };
}

const columns: ColumnDef<HorizontalPodAutoscaler>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Reference', key: 'reference' },
  { title: 'Min/Max Pods', key: 'minMax', render: (hpa) => `${hpa.minReplicas} / ${hpa.maxReplicas}`, sortable: false },
  { title: 'Current', key: 'currentReplicas' },
  { title: 'CPU Target', key: 'cpuTarget' },
  { title: 'CPU Current', key: 'cpuCurrent' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (hpa) => <ResourceActions name={hpa.name} namespace={hpa.namespace} apiBase="/apis/autoscaling/v2" resourceType="horizontalpodautoscalers" kind="HPA" detailPath={`/workloads/hpa/${hpa.namespace}/${hpa.name}`} />, sortable: false },
];

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

export default function HPA() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawHPA, HorizontalPodAutoscaler>(
    '/apis/autoscaling/v2/horizontalpodautoscalers',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      reference: `${item.spec.scaleTargetRef.kind ?? 'Deployment'}/${item.spec.scaleTargetRef.name}`,
      minReplicas: item.spec.minReplicas ?? 1,
      maxReplicas: item.spec.maxReplicas,
      currentReplicas: item.status.currentReplicas ?? 0,
      cpuTarget: getCpuTarget(item.spec.metrics),
      cpuCurrent: getCpuCurrent(item.status.currentMetrics),
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Horizontal Pod Autoscalers"
      description="Manage autoscaling policies for workloads based on resource utilization"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(hpa) => `${hpa.namespace}-${hpa.name}`}
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/hpa/${item.namespace}/${item.name}`)}
    />
  );
}
