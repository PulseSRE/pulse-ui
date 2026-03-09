import {
  PageSection,
  Title,
  Card,
  CardBody,
  Grid,
  GridItem,
  Label,
} from '@patternfly/react-core';
import { useK8sResource, type K8sMeta } from '@/hooks/useK8sResource';
import '@/openshift-components.css';

/* ---------- Raw K8s types ---------- */

interface RawNodeCondition {
  type: string;
  status: string;
}

interface RawNode extends K8sMeta {
  status?: {
    conditions?: RawNodeCondition[];
  };
}

interface RawPod extends K8sMeta {
  status?: {
    phase?: string;
  };
}

interface RawClusterOperatorCondition {
  type: string;
  status: string;
}

interface RawClusterOperator extends K8sMeta {
  status?: {
    conditions?: RawClusterOperatorCondition[];
  };
}

/* ---------- Transformed types ---------- */

interface NodeInfo {
  name: string;
  ready: boolean;
}

interface PodInfo {
  name: string;
  phase: string;
}

interface OperatorInfo {
  name: string;
  available: boolean;
  degraded: boolean;
}

/* ---------- Helpers ---------- */

function scoreColor(score: number): 'green' | 'orange' | 'red' {
  if (score > 90) return 'green';
  if (score >= 70) return 'orange';
  return 'red';
}

function scoreClassName(score: number): string {
  if (score > 90) return 'os-cluster-health__score--green';
  if (score >= 70) return 'os-cluster-health__score--yellow';
  return 'os-cluster-health__score--red';
}

/* ---------- Component ---------- */

export default function ClusterHealth() {
  const { data: nodes, loading: nodesLoading } = useK8sResource<RawNode, NodeInfo>(
    '/api/v1/nodes',
    (item) => ({
      name: item.metadata.name,
      ready: item.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') ?? false,
    }),
  );

  const { data: pods, loading: podsLoading } = useK8sResource<RawPod, PodInfo>(
    '/api/v1/pods',
    (item) => ({
      name: item.metadata.name,
      phase: item.status?.phase ?? 'Unknown',
    }),
  );

  const { data: operators, loading: operatorsLoading } = useK8sResource<RawClusterOperator, OperatorInfo>(
    '/apis/config.openshift.io/v1/clusteroperators',
    (item) => {
      const conditions = item.status?.conditions ?? [];
      return {
        name: item.metadata.name,
        available: conditions.some((c) => c.type === 'Available' && c.status === 'True'),
        degraded: conditions.some((c) => c.type === 'Degraded' && c.status === 'True'),
      };
    },
  );

  const loading = nodesLoading || podsLoading || operatorsLoading;

  const totalNodes = nodes.length;
  const readyNodes = nodes.filter((n) => n.ready).length;

  const totalPods = pods.length;
  const runningPods = pods.filter((p) => p.phase === 'Running' || p.phase === 'Succeeded').length;
  const failedPods = pods.filter((p) => p.phase === 'Failed').length;

  const totalOperators = operators.length;
  const availableOperators = operators.filter((o) => o.available).length;
  const degradedOperators = operators.filter((o) => o.degraded).length;

  const nodeRatio = totalNodes > 0 ? readyNodes / totalNodes : 0;
  const podRatio = totalPods > 0 ? runningPods / totalPods : 0;
  const operatorRatio = totalOperators > 0 ? availableOperators / totalOperators : 0;

  const healthScore = Math.round(
    (nodeRatio * 0.4 + podRatio * 0.3 + operatorRatio * 0.3) * 100,
  );

  return (
    <>
      <PageSection variant="default">
        <Title headingLevel="h1" size="2xl">Cluster Health</Title>
        <p className="os-cluster-health__description">
          Overall cluster health score based on node, pod, and operator status
        </p>
      </PageSection>

      <PageSection>
        {loading ? (
          <p className="os-text-muted">Loading cluster health data...</p>
        ) : (
          <>
            <Card className="os-cluster-health__score-card">
              <CardBody>
                <div className="os-cluster-health__score-container">
                  <span className={`os-cluster-health__score-value ${scoreClassName(healthScore)}`}>
                    {healthScore}
                  </span>
                  <span className="os-cluster-health__score-label">Health Score</span>
                  <Label color={scoreColor(healthScore)} className="os-cluster-health__score-badge">
                    {healthScore > 90 ? 'Healthy' : healthScore >= 70 ? 'Warning' : 'Critical'}
                  </Label>
                </div>
              </CardBody>
            </Card>

            <Grid hasGutter className="os-cluster-health__grid">
              {/* Nodes Card */}
              <GridItem md={4}>
                <Card isFullHeight>
                  <CardBody>
                    <Title headingLevel="h3" size="lg" className="os-cluster-health__card-title">Nodes</Title>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Ready</span>
                      <Label color="green">{readyNodes}</Label>
                    </div>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Not Ready</span>
                      <Label color={totalNodes - readyNodes > 0 ? 'red' : 'grey'}>
                        {totalNodes - readyNodes}
                      </Label>
                    </div>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Total</span>
                      <Label color="blue">{totalNodes}</Label>
                    </div>
                  </CardBody>
                </Card>
              </GridItem>

              {/* Pods Card */}
              <GridItem md={4}>
                <Card isFullHeight>
                  <CardBody>
                    <Title headingLevel="h3" size="lg" className="os-cluster-health__card-title">Pods</Title>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Running</span>
                      <Label color="green">{runningPods}</Label>
                    </div>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Failed</span>
                      <Label color={failedPods > 0 ? 'red' : 'grey'}>{failedPods}</Label>
                    </div>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Total</span>
                      <Label color="blue">{totalPods}</Label>
                    </div>
                  </CardBody>
                </Card>
              </GridItem>

              {/* Operators Card */}
              <GridItem md={4}>
                <Card isFullHeight>
                  <CardBody>
                    <Title headingLevel="h3" size="lg" className="os-cluster-health__card-title">Operators</Title>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Available</span>
                      <Label color="green">{availableOperators}</Label>
                    </div>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Degraded</span>
                      <Label color={degradedOperators > 0 ? 'red' : 'grey'}>{degradedOperators}</Label>
                    </div>
                    <div className="os-cluster-health__stat-row">
                      <span className="os-cluster-health__stat-label">Total</span>
                      <Label color="blue">{totalOperators}</Label>
                    </div>
                  </CardBody>
                </Card>
              </GridItem>
            </Grid>
          </>
        )}
      </PageSection>
    </>
  );
}
