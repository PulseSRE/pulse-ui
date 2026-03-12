import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageSection,
  Title,
  Card,
  CardBody,
  Grid,
  GridItem,
  Label,
  Button,
  Flex,
  FlexItem,
  Progress,
  ProgressVariant,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  PlusCircleIcon,
} from '@patternfly/react-icons';
import { useClusterStore } from '@/store/useClusterStore';
import { useUIStore } from '@/store/useUIStore';
import QuickDeployDialog from '@/components/QuickDeployDialog';
import '@/openshift-components.css';

const PROM_BASE = '/api/prometheus';
const AM_BASE = '/api/alertmanager';

interface FiringAlert {
  name: string;
  severity: string;
  state: string;
  namespace: string;
  message: string;
  labels: Record<string, string>;
}

function HealthScore({ score, label }: { score: number; label: string }) {
  const variant = score >= 90 ? ProgressVariant.success : score >= 70 ? ProgressVariant.warning : ProgressVariant.danger;
  return (
    <div className="os-dashboard__health-item">
      <div className="os-dashboard__health-label">{label}</div>
      <Progress value={score} title="" size="sm" variant={variant} />
      <div className="os-dashboard__health-score">{score}%</div>
    </div>
  );
}

function Sparkline({ data, color = '#0066cc' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  let min = data[0], max = data[0];
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min || 1;
  const w = 180;
  const h = 32;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h * 0.85 - h * 0.075;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="os-sparkline">
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const addToast = useUIStore((s) => s.addToast);
  const { nodes, pods, events, metrics, clusterInfo, fetchClusterData, startPolling, stopPolling } = useClusterStore();

  const [deployOpen, setDeployOpen] = useState(false);
  const [firingAlerts, setFiringAlerts] = useState<FiringAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);

  useEffect(() => {
    fetchClusterData();
    startPolling();
    return () => stopPolling();
  }, [fetchClusterData, startPolling, stopPolling]);

  // Fetch real firing alerts
  useEffect(() => {
    async function loadAlerts() {
      try {
        const res = await fetch(`${PROM_BASE}/api/v1/alerts`);
        if (!res.ok) return;
        const json = await res.json() as { data?: { alerts?: { labels: Record<string, string>; annotations?: Record<string, string>; state: string }[] } };
        const alerts = (json.data?.alerts ?? [])
          .filter((a) => a.state === 'firing' || a.state === 'pending')
          .map((a) => ({
            name: a.labels['alertname'] ?? 'Unknown',
            severity: a.labels['severity'] ?? 'none',
            state: a.state,
            namespace: a.labels['namespace'] ?? '-',
            message: a.annotations?.summary ?? a.annotations?.description ?? '',
            labels: a.labels,
          }));
        // Sort critical first
        const order: Record<string, number> = { critical: 0, warning: 1, info: 2, none: 3 };
        alerts.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
        setFiringAlerts(alerts);
      } catch { /* ignore */ }
      setAlertsLoading(false);
    }
    loadAlerts();
    const interval = setInterval(loadAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSilence = useCallback(async (alert: FiringAlert) => {
    const now = new Date();
    const matchers = Object.entries(alert.labels).map(([name, value]) => ({
      name, value, isRegex: false, isEqual: true,
    }));
    try {
      const res = await fetch(`${AM_BASE}/api/v2/silences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchers,
          startsAt: now.toISOString(),
          endsAt: new Date(now.getTime() + 2 * 3600000).toISOString(),
          createdBy: 'openshift-console',
          comment: `Silenced from dashboard`,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      addToast({ type: 'success', title: `${alert.name} silenced for 2h` });
      setFiringAlerts((prev) => prev.filter((a) => a !== alert));
    } catch (err) {
      addToast({ type: 'error', title: 'Silence failed', description: err instanceof Error ? err.message : String(err) });
    }
  }, [addToast]);

  // Compute health scores
  const readyNodes = nodes.filter((n) => n.status === 'Ready').length;
  const nodeHealth = nodes.length > 0 ? Math.round((readyNodes / nodes.length) * 100) : 100;
  const runningPods = pods.filter((p) => p.status === 'Running').length;
  const podHealth = pods.length > 0 ? Math.round((runningPods / pods.length) * 100) : 100;
  const criticalAlerts = firingAlerts.filter((a) => a.severity === 'critical').length;
  const alertHealth = criticalAlerts === 0 ? 100 : criticalAlerts <= 2 ? 70 : 40;
  const overallHealth = Math.round((nodeHealth + podHealth + alertHealth) / 3);

  const avgCpu = nodes.length > 0 ? Math.round(nodes.reduce((s, n) => s + n.cpu, 0) / nodes.length) : 0;
  const avgMem = nodes.length > 0 ? Math.round(nodes.reduce((s, n) => s + n.memory, 0) / nodes.length) : 0;

  const warningEvents = events.filter((e) => e.type === 'Warning' || e.type === 'Error');

  return (
    <>
      {/* Header with Quick Actions */}
      <PageSection className="os-dashboard__header">
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1" size="2xl">Dashboard</Title>
            <p className="os-text-muted">{clusterInfo?.version ?? 'OpenShift'} &middot; {nodes.length} nodes &middot; {pods.length} pods</p>
          </FlexItem>
          <FlexItem>
            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
              <FlexItem>
                <Button variant="primary" icon={<PlusCircleIcon />} onClick={() => setDeployOpen(true)}>
                  Deploy
                </Button>
              </FlexItem>
              <FlexItem>
                <Button variant="secondary" onClick={() => navigate('/developer/add')}>
                  + Add
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>

      <PageSection>
        <Grid hasGutter>
          {/* Row 1: Health Score + Alerts */}
          <GridItem md={4}>
            <Card className="os-dashboard__card">
              <CardBody>
                <strong className="os-dashboard__card-title">Cluster Health</strong>
                <div className="os-dashboard__health-overall">
                  <div className="os-dashboard__health-big" style={{
                    color: overallHealth >= 90 ? 'var(--pf-t--global--color--status--success--default, #3e8635)' :
                           overallHealth >= 70 ? 'var(--pf-t--global--color--status--warning--default, #f0ab00)' :
                           'var(--pf-t--global--color--status--danger--default, #c9190b)'
                  }}>
                    {overallHealth}%
                  </div>
                </div>
                <HealthScore score={nodeHealth} label="Nodes" />
                <HealthScore score={podHealth} label="Pods" />
                <HealthScore score={alertHealth} label="Alerts" />
              </CardBody>
            </Card>
          </GridItem>

          <GridItem md={8}>
            <Card className="os-dashboard__card">
              <CardBody>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem><strong className="os-dashboard__card-title">
                    Firing Alerts
                    {firingAlerts.length > 0 && <Label color="red" className="pf-v5-u-ml-sm">{firingAlerts.length}</Label>}
                  </strong></FlexItem>
                  <FlexItem>
                    <Button variant="link" isInline onClick={() => navigate('/observe/alerts')}>View all</Button>
                  </FlexItem>
                </Flex>
                {alertsLoading ? (
                  <p className="os-text-muted">Loading alerts...</p>
                ) : firingAlerts.length === 0 ? (
                  <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }} className="os-dashboard__no-alerts">
                    <FlexItem><CheckCircleIcon color="var(--pf-t--global--color--status--success--default, #3e8635)" /></FlexItem>
                    <FlexItem>No firing alerts</FlexItem>
                  </Flex>
                ) : (
                  <div className="os-dashboard__alert-list">
                    {firingAlerts.slice(0, 5).map((alert, i) => (
                      <div key={`${alert.name}-${i}`} className="os-dashboard__alert-row">
                        <span className="os-dashboard__alert-icon">
                          {alert.severity === 'critical'
                            ? <ExclamationCircleIcon color="var(--pf-t--global--color--status--danger--default, #c9190b)" />
                            : <ExclamationTriangleIcon color="var(--pf-t--global--color--status--warning--default, #f0ab00)" />
                          }
                        </span>
                        <div className="os-dashboard__alert-body">
                          <div className="os-dashboard__alert-name">
                            {alert.name}
                            <Label color={alert.severity === 'critical' ? 'red' : 'orange'} className="pf-v5-u-ml-sm">
                              {alert.severity}
                            </Label>
                          </div>
                          <div className="os-dashboard__alert-msg">{alert.message}</div>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => handleSilence(alert)}>
                          Silence
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </GridItem>

          {/* Row 2: Utilization + Nodes + Activity */}
          <GridItem md={4}>
            <Card className="os-dashboard__card">
              <CardBody>
                <strong className="os-dashboard__card-title">Utilization</strong>
                <div className="os-dashboard__util-row">
                  <div>
                    <div className="os-dashboard__util-label">CPU</div>
                    <Progress value={avgCpu} title="" size="sm" variant={avgCpu > 80 ? ProgressVariant.danger : avgCpu > 60 ? ProgressVariant.warning : undefined} />
                  </div>
                  <div className="os-dashboard__util-value">{avgCpu}%</div>
                  <Sparkline data={metrics.map((m) => m.cpu)} color="#0066cc" />
                </div>
                <div className="os-dashboard__util-row">
                  <div>
                    <div className="os-dashboard__util-label">Memory</div>
                    <Progress value={avgMem} title="" size="sm" variant={avgMem > 80 ? ProgressVariant.danger : avgMem > 60 ? ProgressVariant.warning : undefined} />
                  </div>
                  <div className="os-dashboard__util-value">{avgMem}%</div>
                  <Sparkline data={metrics.map((m) => m.memory)} color="#009596" />
                </div>
                <div className="os-dashboard__util-row">
                  <div>
                    <div className="os-dashboard__util-label">Pods</div>
                    <div className="os-text-muted">{pods.length} running</div>
                  </div>
                  <div className="os-dashboard__util-value">{pods.length}</div>
                  <Sparkline data={metrics.map((m) => m.pods)} color="#5752d1" />
                </div>
              </CardBody>
            </Card>
          </GridItem>

          <GridItem md={4}>
            <Card className="os-dashboard__card">
              <CardBody>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem><strong className="os-dashboard__card-title">Nodes</strong></FlexItem>
                  <FlexItem>
                    <Button variant="link" isInline onClick={() => navigate('/compute/nodes')}>View all</Button>
                  </FlexItem>
                </Flex>
                {nodes.length === 0 ? (
                  <p className="os-text-muted">No nodes found</p>
                ) : (
                  nodes.slice(0, 6).map((node) => (
                    <div key={node.name} className="os-dashboard__node-row" onClick={() => navigate(`/compute/nodes/${node.name}`)}>
                      <span className={`os-dashboard__node-dot os-dashboard__node-dot--${node.status === 'Ready' ? 'ok' : 'err'}`} />
                      <span className="os-dashboard__node-name">{node.name}</span>
                      <Label color="blue" className="os-dashboard__node-role">{node.role}</Label>
                      <span className="os-text-muted">{node.cpu}% CPU</span>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          </GridItem>

          <GridItem md={4}>
            <Card className="os-dashboard__card">
              <CardBody>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem><strong className="os-dashboard__card-title">Recent Events</strong></FlexItem>
                  <FlexItem>
                    <Button variant="link" isInline onClick={() => navigate('/home/events')}>View all</Button>
                  </FlexItem>
                </Flex>
                {events.length === 0 ? (
                  <p className="os-text-muted">No recent events</p>
                ) : (
                  <div className="os-dashboard__event-list">
                    {events.slice(0, 8).map((event, i) => (
                      <div key={`${event.timestamp}-${i}`} className="os-dashboard__event-row">
                        <span className={`os-dashboard__event-dot os-dashboard__event-dot--${event.type === 'Warning' ? 'warn' : event.type === 'Error' ? 'err' : 'ok'}`} />
                        <div className="os-dashboard__event-body">
                          <span className="os-dashboard__event-reason">{event.reason}</span>
                          <span className="os-dashboard__event-msg">{event.message}</span>
                        </div>
                        <span className="os-dashboard__event-time">
                          {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </GridItem>

          {/* Row 3: Workload Health */}
          <GridItem md={6}>
            <Card className="os-dashboard__card">
              <CardBody>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem><strong className="os-dashboard__card-title">Workload Health</strong></FlexItem>
                  <FlexItem>
                    <Button variant="link" isInline onClick={() => navigate('/workloads/deployments')}>View all</Button>
                  </FlexItem>
                </Flex>
                {(() => {
                  // Compute from pods: count by status
                  const running = pods.filter((p) => p.status === 'Running').length;
                  const pending = pods.filter((p) => p.status === 'Pending').length;
                  const failed = pods.filter((p) => p.status === 'Failed').length;
                  const singleReplica = pods.length > 0 ? Math.round((running / pods.length) * 100) : 100;
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                        <div><Label color="green">{running}</Label> Running</div>
                        {pending > 0 && <div><Label color="orange">{pending}</Label> Pending</div>}
                        {failed > 0 && <div><Label color="red">{failed}</Label> Failed</div>}
                      </div>
                      <Progress value={singleReplica} title="" size="sm" variant={singleReplica >= 90 ? ProgressVariant.success : singleReplica >= 70 ? ProgressVariant.warning : ProgressVariant.danger} />
                      <div className="os-text-muted" style={{ marginTop: 4, fontSize: 12 }}>{singleReplica}% of pods running</div>
                    </>
                  );
                })()}
              </CardBody>
            </Card>
          </GridItem>

          {/* Cluster Info */}
          <GridItem md={6}>
            <Card className="os-dashboard__card">
              <CardBody>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem><strong className="os-dashboard__card-title">Cluster Details</strong></FlexItem>
                  <FlexItem>
                    <Button variant="link" isInline onClick={() => navigate('/administration/cluster-settings')}>Settings</Button>
                  </FlexItem>
                </Flex>
                <DescriptionList isHorizontal isCompact>
                  <DescriptionListGroup><DescriptionListTerm>Version</DescriptionListTerm><DescriptionListDescription>{clusterInfo?.version ?? '-'}</DescriptionListDescription></DescriptionListGroup>
                  <DescriptionListGroup><DescriptionListTerm>Platform</DescriptionListTerm><DescriptionListDescription>{clusterInfo?.platform ?? '-'}</DescriptionListDescription></DescriptionListGroup>
                  <DescriptionListGroup><DescriptionListTerm>API Server</DescriptionListTerm><DescriptionListDescription><code>{clusterInfo?.apiURL ?? '-'}</code></DescriptionListDescription></DescriptionListGroup>
                  <DescriptionListGroup><DescriptionListTerm>Channel</DescriptionListTerm><DescriptionListDescription>{clusterInfo?.updateChannel ?? '-'}</DescriptionListDescription></DescriptionListGroup>
                </DescriptionList>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>

      <QuickDeployDialog open={deployOpen} onClose={() => setDeployOpen(false)} />

      <style>{`
        .os-dashboard__header { padding-bottom: 0; }
        .os-dashboard__card { height: 100%; }
        .os-dashboard__card-title { font-size: 16px; display: block; margin-bottom: 12px; }
        .os-dashboard__health-overall { text-align: center; margin: 8px 0 16px; }
        .os-dashboard__health-big { font-size: 48px; font-weight: 800; line-height: 1; }
        .os-dashboard__health-item { margin-bottom: 10px; }
        .os-dashboard__health-item .pf-v6-c-progress { margin: 4px 0 2px; }
        .os-dashboard__health-label { font-size: 13px; font-weight: 500; }
        .os-dashboard__health-score { font-size: 12px; color: var(--pf-t--global--color--disabled--default, #6a6e73); }
        .os-dashboard__no-alerts { padding: 24px 0; color: var(--pf-t--global--color--status--success--default, #3e8635); font-weight: 500; }
        .os-dashboard__alert-list { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
        .os-dashboard__alert-row { display: flex; align-items: flex-start; gap: 10px; padding: 8px; border-radius: 6px; border: 1px solid var(--pf-t--global--border--color--default, #d2d2d2); }
        .os-dashboard__alert-icon { flex-shrink: 0; padding-top: 2px; }
        .os-dashboard__alert-body { flex: 1; min-width: 0; }
        .os-dashboard__alert-name { font-weight: 600; font-size: 14px; }
        .os-dashboard__alert-msg { font-size: 12px; color: var(--pf-t--global--color--disabled--default, #6a6e73); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .os-dashboard__util-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; margin-bottom: 14px; }
        .os-dashboard__util-label { font-weight: 500; font-size: 14px; margin-bottom: 4px; }
        .os-dashboard__util-value { font-weight: 700; font-size: 16px; min-width: 40px; text-align: right; }
        .os-dashboard__node-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; border-bottom: 1px solid var(--pf-t--global--border--color--default, #d2d2d2); }
        .os-dashboard__node-row:last-child { border-bottom: none; }
        .os-dashboard__node-row:hover { opacity: 0.8; }
        .os-dashboard__node-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .os-dashboard__node-dot--ok { background: var(--pf-t--global--color--status--success--default, #3e8635); }
        .os-dashboard__node-dot--err { background: var(--pf-t--global--color--status--danger--default, #c9190b); }
        .os-dashboard__node-name { flex: 1; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .os-dashboard__node-role { font-size: 11px !important; }
        .os-dashboard__event-list { display: flex; flex-direction: column; }
        .os-dashboard__event-row { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--pf-t--global--border--color--default, #d2d2d2); }
        .os-dashboard__event-row:last-child { border-bottom: none; }
        .os-dashboard__event-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }
        .os-dashboard__event-dot--ok { background: var(--pf-t--global--color--status--success--default, #3e8635); }
        .os-dashboard__event-dot--warn { background: var(--pf-t--global--color--status--warning--default, #f0ab00); }
        .os-dashboard__event-dot--err { background: var(--pf-t--global--color--status--danger--default, #c9190b); }
        .os-dashboard__event-body { flex: 1; min-width: 0; }
        .os-dashboard__event-reason { font-size: 13px; font-weight: 500; display: block; }
        .os-dashboard__event-msg { font-size: 12px; color: var(--pf-t--global--color--disabled--default, #6a6e73); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
        .os-dashboard__event-time { font-size: 11px; color: var(--pf-t--global--color--disabled--default, #6a6e73); flex-shrink: 0; white-space: nowrap; }
      `}</style>
    </>
  );
}
