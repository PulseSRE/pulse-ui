import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageSection, Title, Card, CardBody, Grid, GridItem, Label, Button,
  Progress, ProgressVariant,
} from '@patternfly/react-core';
import {
  ShieldAltIcon, ExclamationTriangleIcon, LockIcon, NetworkIcon, CheckCircleIcon,
} from '@patternfly/react-icons';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface RawPod extends K8sMeta {
  spec: {
    containers: { name: string; securityContext?: { runAsUser?: number; runAsNonRoot?: boolean }; resources?: { limits?: Record<string, string> } }[];
    securityContext?: { runAsNonRoot?: boolean; runAsUser?: number };
    hostNetwork?: boolean;
  };
}
interface RawSecret extends K8sMeta { type: string; }
interface RawNetworkPolicy extends K8sMeta { spec: { podSelector?: unknown }; }
interface RawNamespace extends K8sMeta {}

interface Finding {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  name: string;
  namespace: string;
  detail: string;
}

function daysSince(ts: string | undefined): number {
  if (!ts) return 0;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

export default function SecurityOverview() {
  const navigate = useNavigate();
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const pods = useK8sResource<RawPod, RawPod>('/api/v1/pods', (item) => item);
  const secrets = useK8sResource<RawSecret, RawSecret>('/api/v1/secrets', (item) => item);
  const netPols = useK8sResource<RawNetworkPolicy, RawNetworkPolicy>('/apis/networking.k8s.io/v1/networkpolicies', (item) => item);
  const namespaces = useK8sResource<RawNamespace, RawNamespace>('/api/v1/namespaces', (item) => item);

  const findings = useMemo(() => {
    const results: Finding[] = [];

    for (const pod of pods.data) {
      const ns = pod.metadata.namespace ?? '';
      const name = pod.metadata.name;
      // Skip system namespaces for noise reduction
      if (ns.startsWith('openshift-') || ns.startsWith('kube-')) continue;

      const podCtx = pod.spec.securityContext;
      const isRoot = podCtx?.runAsUser === 0 || podCtx?.runAsNonRoot === false ||
        pod.spec.containers.some((c) => c.securityContext?.runAsUser === 0);
      if (isRoot) {
        results.push({ severity: 'critical', category: 'Privileged', name, namespace: ns, detail: 'Running as root (UID 0)' });
      }

      if (pod.spec.hostNetwork) {
        results.push({ severity: 'critical', category: 'Host Network', name, namespace: ns, detail: 'Using host network' });
      }

      const missingLimits = pod.spec.containers.some((c) => !c.resources?.limits || Object.keys(c.resources.limits).length === 0);
      if (missingLimits) {
        results.push({ severity: 'warning', category: 'No Limits', name, namespace: ns, detail: 'Missing resource limits' });
      }
    }

    for (const secret of secrets.data) {
      const ns = secret.metadata.namespace ?? '';
      if (ns.startsWith('openshift-') || ns.startsWith('kube-')) continue;
      const age = daysSince(secret.metadata.creationTimestamp);
      if (age > 180) {
        results.push({ severity: 'warning', category: 'Stale Secret', name: secret.metadata.name, namespace: ns, detail: `${age} days old` });
      }
    }

    const coveredNs = new Set(netPols.data.map((np) => np.metadata.namespace ?? ''));
    for (const ns of namespaces.data) {
      if (ns.metadata.name.startsWith('openshift-') || ns.metadata.name.startsWith('kube-') || ns.metadata.name === 'default') continue;
      if (!coveredNs.has(ns.metadata.name)) {
        results.push({ severity: 'info', category: 'No NetPol', name: ns.metadata.name, namespace: ns.metadata.name, detail: 'No network policies' });
      }
    }

    return results;
  }, [pods.data, secrets.data, netPols.data, namespaces.data]);

  const critical = findings.filter((f) => f.severity === 'critical');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const infos = findings.filter((f) => f.severity === 'info');

  const totalPods = pods.data.filter((p) => !(p.metadata.namespace ?? '').startsWith('openshift-') && !(p.metadata.namespace ?? '').startsWith('kube-')).length;
  const score = totalPods > 0
    ? Math.max(0, Math.round(100 - (critical.length * 10 + warnings.length * 2 + infos.length * 0.5)))
    : 100;

  const loading = pods.loading || secrets.loading || netPols.loading || namespaces.loading;

  const categories = useMemo(() => {
    const map = new Map<string, { findings: Finding[]; icon: React.ReactNode; color: 'red' | 'orange' | 'blue' }>();
    map.set('Privileged', { findings: critical.filter((f) => f.category === 'Privileged'), icon: <ShieldAltIcon />, color: 'red' });
    map.set('Host Network', { findings: critical.filter((f) => f.category === 'Host Network'), icon: <NetworkIcon />, color: 'red' });
    map.set('No Limits', { findings: warnings.filter((f) => f.category === 'No Limits'), icon: <ExclamationTriangleIcon />, color: 'orange' });
    map.set('Stale Secret', { findings: warnings.filter((f) => f.category === 'Stale Secret'), icon: <LockIcon />, color: 'orange' });
    map.set('No NetPol', { findings: infos, icon: <NetworkIcon />, color: 'blue' });
    return map;
  }, [critical, warnings, infos]);

  const toggleCard = (cat: string) => setExpandedCard(expandedCard === cat ? null : cat);

  return (
    <>
      <PageSection variant="default">
        <Title headingLevel="h1" size="2xl">Security Overview</Title>
        <p className="os-text-muted">Cluster security posture — identifies risks across user workloads (excludes system namespaces)</p>
      </PageSection>

      <PageSection>
        {loading ? (
          <p className="os-text-muted">Scanning cluster security...</p>
        ) : (
          <Grid hasGutter>
            {/* Score Card */}
            <GridItem md={4}>
              <Card>
                <CardBody>
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{
                      fontSize: 56, fontWeight: 800, lineHeight: 1,
                      color: score >= 80 ? '#3e8635' : score >= 50 ? '#f0ab00' : '#c9190b',
                    }}>
                      {score}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>Security Score</div>
                  </div>
                  <Progress value={score} title="" variant={score >= 80 ? ProgressVariant.success : score >= 50 ? ProgressVariant.warning : ProgressVariant.danger} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 13 }}>
                    <span><Label color="red">{critical.length}</Label> Critical</span>
                    <span><Label color="orange">{warnings.length}</Label> Warnings</span>
                    <span><Label color="blue">{infos.length}</Label> Info</span>
                  </div>
                </CardBody>
              </Card>
            </GridItem>

            {/* Summary Cards */}
            <GridItem md={8}>
              <Card>
                <CardBody>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Findings Summary</div>
                  {findings.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, color: '#3e8635' }}>
                      <CheckCircleIcon /> No security issues found
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {Array.from(categories.entries()).map(([cat, { findings: catFindings, icon, color }]) => {
                        if (catFindings.length === 0) return null;
                        const isExpanded = expandedCard === cat;
                        return (
                          <div key={cat}>
                            <div
                              onClick={() => toggleCard(cat)}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid var(--glass-border)', borderRadius: 6, cursor: 'pointer' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {icon}
                                <strong>{cat}</strong>
                                <Label color={color}>{catFindings.length}</Label>
                              </div>
                              <span style={{ fontSize: 12, color: '#6a6e73' }}>{isExpanded ? '▲ collapse' : '▼ expand'}</span>
                            </div>
                            {isExpanded && (
                              <div style={{ padding: '8px 12px', maxHeight: 250, overflowY: 'auto' }}>
                                {catFindings.slice(0, 30).map((f, i) => (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--glass-border)' }}>
                                    <Label color={color === 'red' ? 'red' : color === 'orange' ? 'orange' : 'blue'} style={{ minWidth: 80, textAlign: 'center' }}>{f.namespace}</Label>
                                    <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</code>
                                    <span style={{ color: '#6a6e73', flexShrink: 0 }}>{f.detail}</span>
                                  </div>
                                ))}
                                {catFindings.length > 30 && <div style={{ padding: 8, color: '#6a6e73', fontSize: 12 }}>+{catFindings.length - 30} more</div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardBody>
              </Card>
            </GridItem>

            {/* Quick Links */}
            <GridItem md={12}>
              <Card>
                <CardBody>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Security Tools</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={() => navigate('/security/rbac-audit')}>RBAC Audit</Button>
                    <Button variant="secondary" onClick={() => navigate('/security/network-policies')}>Network Policies</Button>
                    <Button variant="secondary" onClick={() => navigate('/security/pod-security')}>Pod Security Standards</Button>
                    <Button variant="secondary" onClick={() => navigate('/security/secret-rotation')}>Secret Rotation</Button>
                    <Button variant="secondary" onClick={() => navigate('/operations/certificates')}>Certificates</Button>
                  </div>
                </CardBody>
              </Card>
            </GridItem>
          </Grid>
        )}
      </PageSection>
    </>
  );
}
