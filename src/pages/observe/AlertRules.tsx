import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';
import '@/openshift-components.css';

interface AlertRuleRow {
  name: string;
  namespace: string;
  groupCount: number;
  ruleCount: number;
  age: string;
}

interface RawRule {
  alert?: string;
  record?: string;
  expr: string;
}

interface RawRuleGroup {
  name: string;
  rules: RawRule[];
}

interface RawPrometheusRule extends K8sMeta {
  spec: {
    groups: RawRuleGroup[];
  };
}

const columns: ColumnDef<AlertRuleRow>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Groups', key: 'groupCount' },
  { title: 'Rules', key: 'ruleCount' },
  { title: 'Age', key: 'age' },
];

export default function AlertRules() {
  const navigate = useNavigate();

  const { data, loading } = useK8sResource<RawPrometheusRule, AlertRuleRow>(
    '/apis/monitoring.coreos.com/v1/prometheusrules',
    (item) => {
      const groups = item.spec.groups ?? [];
      const ruleCount = groups.reduce((sum, g) => sum + g.rules.length, 0);
      return {
        name: item.metadata.name,
        namespace: item.metadata.namespace ?? '',
        groupCount: groups.length,
        ruleCount,
        age: ageFromTimestamp(item.metadata.creationTimestamp),
      };
    },
  );

  return (
    <ResourceListPage
      title="Alert Rules"
      description="PrometheusRule custom resources defining alerting and recording rules"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(r) => `${r.namespace}-${r.name}`}
      nameField="name"
      onRowClick={(item) =>
        navigate(
          `/observe/alertrules/${item.namespace}/${item.name}`,
        )
      }
      filterFn={(r, s) => {
        const term = s.toLowerCase();
        return r.name.toLowerCase().includes(term) || r.namespace.toLowerCase().includes(term);
      }}
    />
  );
}
