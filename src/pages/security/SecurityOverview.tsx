import React, { useMemo } from 'react';
import {
  PageSection,
  Title,
  Card,
  CardBody,
  CardTitle,
  Grid,
  GridItem,
  Label,
  List,
  ListItem,
} from '@patternfly/react-core';
import {
  ShieldAltIcon,
  ExclamationTriangleIcon,
  LockIcon,
  NetworkIcon,
} from '@patternfly/react-icons';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

/* ---------- Raw K8s types ---------- */

interface RawContainerSecurityContext {
  runAsUser?: number;
  runAsNonRoot?: boolean;
}

interface RawContainer {
  name: string;
  securityContext?: RawContainerSecurityContext;
  resources?: {
    limits?: Record<string, string>;
  };
}

interface RawPodSpec {
  containers: RawContainer[];
  securityContext?: {
    runAsNonRoot?: boolean;
    runAsUser?: number;
  };
  hostNetwork?: boolean;
}

interface RawPod extends K8sMeta {
  spec: RawPodSpec;
}

interface RawSecret extends K8sMeta {
  type: string;
}

interface RawNetworkPolicy extends K8sMeta {
  spec: {
    podSelector?: { matchLabels?: Record<string, string> };
    policyTypes?: string[];
  };
}

interface RawNamespace extends K8sMeta {}

/* ---------- Transformed types ---------- */

interface PodSecurity {
  name: string;
  namespace: string;
  isPrivileged: boolean;
  missingLimits: boolean;
  hostNetwork: boolean;
}

interface SecretInfo {
  name: string;
  namespace: string;
  ageDays: number;
  ageLabel: string;
}

interface NetPolInfo {
  name: string;
  namespace: string;
}

interface NamespaceInfo {
  name: string;
}

/* ---------- Helpers ---------- */

function daysSince(ts: string | undefined): number {
  if (!ts) return 0;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

function isRunningAsRoot(pod: RawPod): boolean {
  const podCtx = pod.spec.securityContext;
  if (podCtx?.runAsNonRoot === false) return true;
  if (podCtx?.runAsUser === 0) return true;
  return pod.spec.containers.some(
    (c) => c.securityContext?.runAsUser === 0,
  );
}

function isMissingLimits(pod: RawPod): boolean {
  return pod.spec.containers.some(
    (c) => !c.resources?.limits || Object.keys(c.resources.limits).length === 0,
  );
}

/* ---------- Component ---------- */

export default function SecurityOverview() {
  const pods = useK8sResource<RawPod, PodSecurity>(
    '/api/v1/pods',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      isPrivileged: isRunningAsRoot(item),
      missingLimits: isMissingLimits(item),
      hostNetwork: item.spec.hostNetwork === true,
    }),
  );

  const secrets = useK8sResource<RawSecret, SecretInfo>(
    '/api/v1/secrets',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      ageDays: daysSince(item.metadata.creationTimestamp),
      ageLabel: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  const netPols = useK8sResource<RawNetworkPolicy, NetPolInfo>(
    '/apis/networking.k8s.io/v1/networkpolicies',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
    }),
  );

  const namespaces = useK8sResource<RawNamespace, NamespaceInfo>(
    '/api/v1/namespaces',
    (item) => ({ name: item.metadata.name }),
  );

  const privilegedPods = useMemo(
    () => pods.data.filter((p) => p.isPrivileged),
    [pods.data],
  );
  const noLimitsPods = useMemo(
    () => pods.data.filter((p) => p.missingLimits),
    [pods.data],
  );
  const hostNetPods = useMemo(
    () => pods.data.filter((p) => p.hostNetwork),
    [pods.data],
  );
  const agedSecrets = useMemo(
    () => secrets.data.filter((s) => s.ageDays > 90),
    [secrets.data],
  );

  const namespacesWithoutNetPol = useMemo(() => {
    const covered = new Set(netPols.data.map((np) => np.namespace));
    return namespaces.data.filter((ns) => !covered.has(ns.name));
  }, [netPols.data, namespaces.data]);

  const loading = pods.loading || secrets.loading || netPols.loading || namespaces.loading;

  return (
    <>
      <PageSection variant="default">
        <Title headingLevel="h1" size="2xl">Security Overview</Title>
        <p className="os-list__description">
          Cluster security posture dashboard showing potential risks and policy gaps.
        </p>
      </PageSection>

      <PageSection>
        {loading ? (
          <p className="os-text-muted">Loading security data...</p>
        ) : (
          <Grid hasGutter>
            {/* Card 1: Privileged Pods */}
            <GridItem md={6} lg={4}>
              <Card className="os-detail__card--spaced">
                <CardTitle>
                  <ShieldAltIcon className="os-overview__card-icon" />{' '}
                  Privileged Pods
                </CardTitle>
                <CardBody>
                  <p className="os-detail__section-title">
                    {privilegedPods.length} pod{privilegedPods.length !== 1 ? 's' : ''} running as root
                  </p>
                  {privilegedPods.length === 0 ? (
                    <p className="os-text-muted">No privileged pods detected.</p>
                  ) : (
                    <List isPlain>
                      {privilegedPods.slice(0, 20).map((p) => (
                        <ListItem key={`${p.namespace}/${p.name}`}>
                          <Label color="red">{p.namespace}</Label>{' '}
                          <code className="os-detail__label-code">{p.name}</code>
                        </ListItem>
                      ))}
                      {privilegedPods.length > 20 && (
                        <ListItem>
                          <span className="os-text-muted">
                            ...and {privilegedPods.length - 20} more
                          </span>
                        </ListItem>
                      )}
                    </List>
                  )}
                </CardBody>
              </Card>
            </GridItem>

            {/* Card 2: Pods Without Resource Limits */}
            <GridItem md={6} lg={4}>
              <Card className="os-detail__card--spaced">
                <CardTitle>
                  <ExclamationTriangleIcon className="os-overview__card-icon" />{' '}
                  Pods Without Resource Limits
                </CardTitle>
                <CardBody>
                  <p className="os-detail__section-title">
                    {noLimitsPods.length} pod{noLimitsPods.length !== 1 ? 's' : ''} missing limits
                  </p>
                  {noLimitsPods.length === 0 ? (
                    <p className="os-text-muted">All pods have resource limits configured.</p>
                  ) : (
                    <List isPlain>
                      {noLimitsPods.slice(0, 20).map((p) => (
                        <ListItem key={`${p.namespace}/${p.name}`}>
                          <Label color="orange">{p.namespace}</Label>{' '}
                          <code className="os-detail__label-code">{p.name}</code>
                        </ListItem>
                      ))}
                      {noLimitsPods.length > 20 && (
                        <ListItem>
                          <span className="os-text-muted">
                            ...and {noLimitsPods.length - 20} more
                          </span>
                        </ListItem>
                      )}
                    </List>
                  )}
                </CardBody>
              </Card>
            </GridItem>

            {/* Card 3: Host Network Pods */}
            <GridItem md={6} lg={4}>
              <Card className="os-detail__card--spaced">
                <CardTitle>
                  <NetworkIcon className="os-overview__card-icon" />{' '}
                  Host Network Pods
                </CardTitle>
                <CardBody>
                  <p className="os-detail__section-title">
                    {hostNetPods.length} pod{hostNetPods.length !== 1 ? 's' : ''} using host network
                  </p>
                  {hostNetPods.length === 0 ? (
                    <p className="os-text-muted">No pods using host network.</p>
                  ) : (
                    <List isPlain>
                      {hostNetPods.slice(0, 20).map((p) => (
                        <ListItem key={`${p.namespace}/${p.name}`}>
                          <Label color="purple">{p.namespace}</Label>{' '}
                          <code className="os-detail__label-code">{p.name}</code>
                        </ListItem>
                      ))}
                      {hostNetPods.length > 20 && (
                        <ListItem>
                          <span className="os-text-muted">
                            ...and {hostNetPods.length - 20} more
                          </span>
                        </ListItem>
                      )}
                    </List>
                  )}
                </CardBody>
              </Card>
            </GridItem>

            {/* Card 4: Aged Secrets */}
            <GridItem md={6} lg={6}>
              <Card className="os-detail__card--spaced">
                <CardTitle>
                  <LockIcon className="os-overview__card-icon" />{' '}
                  Aged Secrets (&gt;90 days)
                </CardTitle>
                <CardBody>
                  <p className="os-detail__section-title">
                    {agedSecrets.length} secret{agedSecrets.length !== 1 ? 's' : ''} older than 90 days
                  </p>
                  {agedSecrets.length === 0 ? (
                    <p className="os-text-muted">No stale secrets detected.</p>
                  ) : (
                    <List isPlain>
                      {agedSecrets.slice(0, 20).map((s) => (
                        <ListItem key={`${s.namespace}/${s.name}`}>
                          <Label color="orange">{s.namespace}</Label>{' '}
                          <code className="os-detail__label-code">{s.name}</code>{' '}
                          <span className="os-text-muted">({s.ageLabel})</span>
                        </ListItem>
                      ))}
                      {agedSecrets.length > 20 && (
                        <ListItem>
                          <span className="os-text-muted">
                            ...and {agedSecrets.length - 20} more
                          </span>
                        </ListItem>
                      )}
                    </List>
                  )}
                </CardBody>
              </Card>
            </GridItem>

            {/* Card 5: Namespaces Without Network Policies */}
            <GridItem md={6} lg={6}>
              <Card className="os-detail__card--spaced">
                <CardTitle>
                  <NetworkIcon className="os-overview__card-icon" />{' '}
                  Namespaces Without Network Policies
                </CardTitle>
                <CardBody>
                  <p className="os-detail__section-title">
                    {namespacesWithoutNetPol.length} namespace{namespacesWithoutNetPol.length !== 1 ? 's' : ''} unprotected
                  </p>
                  {namespacesWithoutNetPol.length === 0 ? (
                    <p className="os-text-muted">All namespaces have network policies.</p>
                  ) : (
                    <div className="os-detail__labels-wrap">
                      {namespacesWithoutNetPol.slice(0, 30).map((ns) => (
                        <Label key={ns.name} color="yellow">
                          {ns.name}
                        </Label>
                      ))}
                      {namespacesWithoutNetPol.length > 30 && (
                        <span className="os-text-muted">
                          ...and {namespacesWithoutNetPol.length - 30} more
                        </span>
                      )}
                    </div>
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
