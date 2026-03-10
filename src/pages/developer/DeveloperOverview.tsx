import {
  PageSection,
  Title,
  Card,
  CardBody,
  Label,
} from '@patternfly/react-core';
import { Grid, GridItem } from '@patternfly/react-core';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface RawDeployment extends K8sMeta {
  spec: { replicas?: number };
  status?: { readyReplicas?: number; availableReplicas?: number };
}

interface RawPod extends K8sMeta {
  status?: { phase?: string };
}

interface RawService extends K8sMeta {
  spec: { type?: string; ports?: { port: number }[] };
}

interface RawRoute extends K8sMeta {
  spec: { host: string; path?: string };
}

interface DeploymentItem {
  name: string;
  namespace: string;
  ready: number;
  replicas: number;
  age: string;
}

interface PodItem {
  name: string;
  namespace: string;
  phase: string;
}

interface ServiceItem {
  name: string;
  namespace: string;
}

interface RouteItem {
  name: string;
  namespace: string;
  host: string;
}

export default function DeveloperOverview() {
  const { data: deployments, loading: dLoading } = useK8sResource<RawDeployment, DeploymentItem>(
    '/apis/apps/v1/deployments',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      ready: item.status?.readyReplicas ?? 0,
      replicas: item.spec.replicas ?? 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  const { data: pods, loading: pLoading } = useK8sResource<RawPod, PodItem>(
    '/api/v1/pods',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      phase: item.status?.phase ?? 'Unknown',
    }),
  );

  const { data: services, loading: sLoading } = useK8sResource<RawService, ServiceItem>(
    '/api/v1/services',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
    }),
  );

  const { data: routes, loading: rLoading } = useK8sResource<RawRoute, RouteItem>(
    '/apis/route.openshift.io/v1/routes',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      host: item.spec.host,
    }),
  );

  const loading = dLoading || pLoading || sLoading || rLoading;
  const runningPods = pods.filter((p) => p.phase === 'Running');

  return (
    <>
      <PageSection variant="default">
        <Title headingLevel="h1" size="2xl">Developer - Project Overview</Title>
        <p className="os-list__description">
          Overview of deployments, pods, services, and routes in your project
        </p>
      </PageSection>

      <PageSection>
        {loading ? (
          <p className="os-text-muted">Loading project resources...</p>
        ) : (
          <Grid hasGutter>
            <GridItem span={6}>
              <Card isFullHeight>
                <CardBody>
                  <Title headingLevel="h3" size="lg" className="os-detail__section-title">
                    My Deployments
                  </Title>
                  <p className="os-text-muted">{deployments.length} total</p>
                  {deployments.map((d) => (
                    <div key={`${d.namespace}-${d.name}`} className="os-overview__inventory-row">
                      <strong>{d.name}</strong>
                      <Label color={d.ready === d.replicas ? 'green' : 'orange'}>
                        {d.ready}/{d.replicas} ready
                      </Label>
                      <span className="os-text-muted">{d.age}</span>
                    </div>
                  ))}
                  {deployments.length === 0 && (
                    <p className="os-text-muted">No deployments found</p>
                  )}
                </CardBody>
              </Card>
            </GridItem>

            <GridItem span={6}>
              <Card isFullHeight>
                <CardBody>
                  <Title headingLevel="h3" size="lg" className="os-detail__section-title">
                    Running Pods
                  </Title>
                  <p className="os-text-muted">{runningPods.length} running</p>
                </CardBody>
              </Card>
            </GridItem>

            <GridItem span={6}>
              <Card isFullHeight>
                <CardBody>
                  <Title headingLevel="h3" size="lg" className="os-detail__section-title">
                    Services
                  </Title>
                  <p className="os-text-muted">{services.length} total</p>
                </CardBody>
              </Card>
            </GridItem>

            <GridItem span={6}>
              <Card isFullHeight>
                <CardBody>
                  <Title headingLevel="h3" size="lg" className="os-detail__section-title">
                    Routes
                  </Title>
                  {routes.map((r) => (
                    <div key={`${r.namespace}-${r.name}`} className="os-overview__inventory-row">
                      <strong>{r.name}</strong>
                      <code className="os-text-muted">{r.host}</code>
                    </div>
                  ))}
                  {routes.length === 0 && (
                    <p className="os-text-muted">No routes found</p>
                  )}
                </CardBody>
              </Card>
            </GridItem>
          </Grid>
        )}
      </PageSection>
    </>
  );
}
