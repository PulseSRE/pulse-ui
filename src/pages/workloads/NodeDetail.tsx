import { useState, useEffect } from 'react';
import { Card, CardBody, Grid, GridItem, DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription, Label, Title, Select, SelectOption, MenuToggle, ToggleGroup, ToggleGroupItem } from '@patternfly/react-core';
import { useParams } from 'react-router-dom';
import ResourceDetailPage from '@/components/ResourceDetailPage';
import StatusIndicator from '@/components/StatusIndicator';
import LogViewer from '@/components/LogViewer';
import '@/openshift-components.css';

const BASE = '/api/kubernetes';

interface NodePod {
  name: string;
  namespace: string;
  containers: string[];
}

type LogMode = 'journal' | 'pod';

const JOURNAL_UNITS = ['kubelet', 'crio', 'kernel'] as const;

export default function NodeDetail() {
  const { name } = useParams();
  const [node, setNode] = useState<Record<string, unknown> | null>(null);
  const [yaml, setYaml] = useState('');
  const [loading, setLoading] = useState(true);
  const [nodePods, setNodePods] = useState<NodePod[]>([]);
  const [selectedPod, setSelectedPod] = useState<NodePod | null>(null);
  const [podSelectOpen, setPodSelectOpen] = useState(false);
  const [logMode, setLogMode] = useState<LogMode>('journal');
  const [journalLogs, setJournalLogs] = useState('');
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalUnit, setJournalUnit] = useState<string>(JOURNAL_UNITS[0]);
  const [unitSelectOpen, setUnitSelectOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${BASE}/api/v1/nodes/${name}`);
        if (res.ok) {
          const raw = await res.json() as Record<string, unknown>;
          setNode(raw);
          setYaml(JSON.stringify(raw, null, 2));
        }
      } catch {
        // API may not be available
      }
      setLoading(false);
    }
    load();
  }, [name]);

  useEffect(() => {
    if (!name) return;
    async function loadPods() {
      try {
        const res = await fetch(`${BASE}/api/v1/pods?fieldSelector=spec.nodeName=${encodeURIComponent(name!)}`);
        if (!res.ok) return;
        const data = await res.json() as { items?: Record<string, unknown>[] };
        const pods: NodePod[] = (data.items ?? []).map((item) => {
          const meta = item['metadata'] as Record<string, unknown>;
          const spec = item['spec'] as Record<string, unknown>;
          const containers = ((spec?.['containers'] ?? []) as Record<string, unknown>[]).map((c) => String(c['name'] ?? ''));
          return { name: String(meta?.['name'] ?? ''), namespace: String(meta?.['namespace'] ?? ''), containers };
        });
        setNodePods(pods);
        if (pods.length > 0) setSelectedPod(pods[0]);
      } catch {
        // ignore
      }
    }
    loadPods();
  }, [name]);

  // Fetch node journal logs
  useEffect(() => {
    if (!name || logMode !== 'journal') return;
    let cancelled = false;
    async function fetchJournal() {
      setJournalLoading(true);
      setJournalLogs('');
      try {
        const query = journalUnit === 'kernel'
          ? 'boot=0&grep=kernel'
          : `unit=${journalUnit}`;
        const res = await fetch(`${BASE}/api/v1/nodes/${encodeURIComponent(name!)}/proxy/logs/journal?${query}&tailLines=500`);
        if (!res.ok) {
          // Fallback: try the simpler logs endpoint
          const fallbackRes = await fetch(`${BASE}/api/v1/nodes/${encodeURIComponent(name!)}/proxy/logs/messages`);
          if (!fallbackRes.ok) throw new Error(`${res.status} ${res.statusText}`);
          const text = await fallbackRes.text();
          if (!cancelled) setJournalLogs(text);
        } else {
          const text = await res.text();
          if (!cancelled) setJournalLogs(text);
        }
      } catch (err) {
        if (!cancelled) {
          setJournalLogs(`Failed to fetch node logs: ${err instanceof Error ? err.message : String(err)}\n\nNode journal logs require the node proxy API to be accessible.`);
        }
      }
      if (!cancelled) setJournalLoading(false);
    }
    fetchJournal();
    return () => { cancelled = true; };
  }, [name, logMode, journalUnit]);

  if (loading) return <div className="os-text-muted" role="status">Loading...</div>;
  if (!node) return <div className="os-text-muted">Node not found</div>;

  const meta = node['metadata'] as Record<string, unknown>;
  const status = node['status'] as Record<string, unknown>;
  const nodeInfo = (status?.['nodeInfo'] ?? {}) as Record<string, unknown>;
  const conditions = ((status?.['conditions'] ?? []) as Record<string, unknown>[]);
  const capacity = (status?.['capacity'] ?? {}) as Record<string, string>;
  const allocatable = (status?.['allocatable'] ?? {}) as Record<string, string>;
  const labels = (meta?.['labels'] ?? {}) as Record<string, string>;
  const addresses = ((status?.['addresses'] ?? []) as Record<string, string>[]);
  const readyCond = conditions.find((c) => c['type'] === 'Ready');
  const nodeStatus = readyCond?.['status'] === 'True' ? 'Ready' : 'NotReady';
  const roles = Object.keys(labels).filter((l) => l.startsWith('node-role.kubernetes.io/')).map((l) => l.replace('node-role.kubernetes.io/', '')).join(', ') || 'worker';
  const internalIP = addresses.find((a) => a['type'] === 'InternalIP')?.['address'] ?? '-';
  const hostname = addresses.find((a) => a['type'] === 'Hostname')?.['address'] ?? '-';

  const detailsTab = (
    <Grid hasGutter>
      <GridItem md={6}>
        <Card>
          <CardBody>
            <Title headingLevel="h3" size="lg" className="os-detail__section-title">Node Information</Title>
            <DescriptionList>
              <DescriptionListGroup><DescriptionListTerm>Name</DescriptionListTerm><DescriptionListDescription><strong>{String(meta?.['name'] ?? '')}</strong></DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>Status</DescriptionListTerm><DescriptionListDescription><StatusIndicator status={nodeStatus} /></DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>Role</DescriptionListTerm><DescriptionListDescription><Label color="blue">{roles}</Label></DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>Kubelet Version</DescriptionListTerm><DescriptionListDescription><code>{String(nodeInfo['kubeletVersion'] ?? '-')}</code></DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>OS Image</DescriptionListTerm><DescriptionListDescription>{String(nodeInfo['osImage'] ?? '-')}</DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>Container Runtime</DescriptionListTerm><DescriptionListDescription><code>{String(nodeInfo['containerRuntimeVersion'] ?? '-')}</code></DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>Internal IP</DescriptionListTerm><DescriptionListDescription><code>{internalIP}</code></DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>Hostname</DescriptionListTerm><DescriptionListDescription>{hostname}</DescriptionListDescription></DescriptionListGroup>
            </DescriptionList>
          </CardBody>
        </Card>
      </GridItem>
      <GridItem md={6}>
        <Card>
          <CardBody>
            <Title headingLevel="h3" size="lg" className="os-detail__section-title">Capacity</Title>
            <DescriptionList>
              <DescriptionListGroup><DescriptionListTerm>CPU</DescriptionListTerm><DescriptionListDescription>{capacity['cpu'] ?? '-'} (allocatable: {allocatable['cpu'] ?? '-'})</DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>Memory</DescriptionListTerm><DescriptionListDescription>{capacity['memory'] ?? '-'} (allocatable: {allocatable['memory'] ?? '-'})</DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>Pods</DescriptionListTerm><DescriptionListDescription>{capacity['pods'] ?? '-'} (allocatable: {allocatable['pods'] ?? '-'})</DescriptionListDescription></DescriptionListGroup>
            </DescriptionList>
          </CardBody>
        </Card>
        <Card className="os-detail__card--spaced">
          <CardBody>
            <Title headingLevel="h3" size="lg" className="os-detail__section-title">Conditions</Title>
            {conditions.map((c) => (
              <div key={String(c['type'])} className="os-node__condition">
                <div className="os-node__condition-header">
                  <strong>{String(c['type'] ?? '')}</strong>
                  <StatusIndicator status={String(c['status'] ?? '')} />
                </div>
                <div className="os-node__condition-message">{String(c['message'] ?? '')}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      </GridItem>
    </Grid>
  );

  const logsTab = (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <ToggleGroup aria-label="Log source">
          <ToggleGroupItem
            text="Node Journal"
            isSelected={logMode === 'journal'}
            onChange={() => setLogMode('journal')}
          />
          <ToggleGroupItem
            text="Pod Logs"
            isSelected={logMode === 'pod'}
            onChange={() => setLogMode('pod')}
          />
        </ToggleGroup>

        {logMode === 'journal' && (
          <>
            <span className="os-text-muted">Unit:</span>
            <Select
              isOpen={unitSelectOpen}
              selected={journalUnit}
              onSelect={(_event, selection) => {
                setJournalUnit(selection as string);
                setUnitSelectOpen(false);
              }}
              onOpenChange={(isOpen) => setUnitSelectOpen(isOpen)}
              toggle={(toggleRef) => (
                <MenuToggle ref={toggleRef} onClick={() => setUnitSelectOpen(!unitSelectOpen)}>
                  {journalUnit}
                </MenuToggle>
              )}
            >
              {JOURNAL_UNITS.map((unit) => (
                <SelectOption key={unit} value={unit}>{unit}</SelectOption>
              ))}
            </Select>
          </>
        )}

        {logMode === 'pod' && (
          <>
            <span className="os-text-muted">Pod:</span>
            <Select
              isOpen={podSelectOpen}
              selected={selectedPod?.name}
              onSelect={(_event, selection) => {
                const pod = nodePods.find((p) => p.name === selection);
                if (pod) setSelectedPod(pod);
                setPodSelectOpen(false);
              }}
              onOpenChange={(isOpen) => setPodSelectOpen(isOpen)}
              toggle={(toggleRef) => (
                <MenuToggle ref={toggleRef} onClick={() => setPodSelectOpen(!podSelectOpen)}>
                  {selectedPod ? `${selectedPod.namespace}/${selectedPod.name}` : 'Select a pod'}
                </MenuToggle>
              )}
            >
              {nodePods.map((p) => (
                <SelectOption key={`${p.namespace}/${p.name}`} value={p.name}>
                  {p.namespace}/{p.name}
                </SelectOption>
              ))}
            </Select>
          </>
        )}
      </div>

      {logMode === 'journal' && (
        <LogViewer
          podName={name ?? ''}
          namespace=""
          containers={[]}
          rawText={journalLogs}
          rawLoading={journalLoading}
        />
      )}

      {logMode === 'pod' && (
        nodePods.length === 0 ? (
          <div className="os-text-muted">No pods found on this node.</div>
        ) : selectedPod ? (
          <LogViewer
            podName={selectedPod.name}
            namespace={selectedPod.namespace}
            containers={selectedPod.containers}
          />
        ) : null
      )}
    </div>
  );

  return (
    <ResourceDetailPage
      kind="Node"
      name={String(meta?.['name'] ?? '')}
      status={nodeStatus}
      statusExtra={<Label color="blue">{roles}</Label>}
      backPath="/compute/nodes"
      backLabel="Nodes"
      yaml={yaml}
      tabs={[
        { title: 'Details', content: detailsTab },
        { title: 'Logs', content: logsTab },
      ]}
    />
  );
}
